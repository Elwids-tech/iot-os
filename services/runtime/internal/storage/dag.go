package storage

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"
	"time"

	"github.com/Elwids-tech/iot-os/services/runtime/internal/dag"
	"github.com/Elwids-tech/iot-os/services/runtime/internal/devices"
	"github.com/jackc/pgx/v5"
)

type DAGDeployment struct {
	Operation    string        `json:"operation_uuid"`
	Workflow     string        `json:"rule_uuid"`
	Organization string        `json:"organization_uuid"`
	Generation   int           `json:"generation"`
	Target       string        `json:"target"`
	Definition   *dag.Workflow `json:"definition"`
}

var dagCache = struct {
	sync.Mutex
	plans map[string]*dag.Plan
}{plans: map[string]*dag.Plan{}}

func dagPlan(w dag.Workflow) (*dag.Plan, error) {
	key := dag.Hash(w)
	dagCache.Lock()
	defer dagCache.Unlock()
	if p := dagCache.plans[key]; p != nil {
		return p, nil
	}
	p, d := dag.Compile(w)
	if len(d) > 0 {
		return nil, fmt.Errorf("invalid DAG: %v", d)
	}
	if len(dagCache.plans) >= 256 {
		dagCache.plans = map[string]*dag.Plan{}
	}
	dagCache.plans[key] = p
	return p, nil
}

func checkDAGBindings(ctx context.Context, tx pgx.Tx, w dag.Workflow) error {
	for _, b := range w.Bindings {
		var raw []byte
		var generation int
		var review bool
		if err := tx.QueryRow(ctx, `SELECT definition,generation,review_required FROM device_runtime.devices WHERE device_uuid=$1 AND organization_uuid=$2 FOR SHARE`, b.Device, w.Organization).Scan(&raw, &generation, &review); err != nil {
			return fmt.Errorf("binding unavailable: %s", b.Role)
		}
		var d devices.Definition
		if json.Unmarshal(raw, &d) != nil || generation != b.Generation || review || d.ConfigurationUUID != b.Configuration {
			return fmt.Errorf("binding_changed: %s", b.Role)
		}
		var profile devices.Profile
		if json.Unmarshal([]byte(d.ProfileCanonicalJSON), &profile) != nil {
			return fmt.Errorf("invalid profile")
		}
		found := false
		for _, p := range profile.Parameters {
			kind := p.DataType
			if kind == "integer" {
				kind = "number"
			}
			if kind == "enum" {
				kind = "string"
			}
			unit := ""
			if p.Unit != nil {
				unit = *p.Unit
			}
			if p.UUID == b.Parameter && kind == b.DataType && unit == b.Unit {
				for _, m := range d.Mappings {
					if m.ParameterUUID == p.UUID {
						found = true
					}
				}
			}
		}
		if !found {
			return fmt.Errorf("unmapped or incompatible binding: %s", b.Role)
		}
	}
	return nil
}

func (s *Store) DeployDAG(ctx context.Context, r DAGDeployment, at time.Time) error {
	if r.Target != "active" && r.Target != "inactive" || r.Generation < 1 {
		return fmt.Errorf("invalid deployment")
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, `INSERT INTO device_runtime.rule_heads(rule_uuid,organization_uuid) VALUES($1,$2) ON CONFLICT DO NOTHING`, r.Workflow, r.Organization); err != nil {
		return err
	}
	var generation int
	var org string
	var operation *string
	if err = tx.QueryRow(ctx, `SELECT generation,organization_uuid,operation_uuid::text FROM device_runtime.rule_heads WHERE rule_uuid=$1 FOR UPDATE`, r.Workflow).Scan(&generation, &org, &operation); err != nil {
		return err
	}
	if org != r.Organization {
		return fmt.Errorf("tenant mismatch")
	}
	if r.Generation <= generation {
		if r.Generation == generation && (operation == nil || *operation != r.Operation) {
			return fmt.Errorf("generation conflict")
		}
		return tx.Commit(ctx)
	}
	var p *dag.Plan
	diagnostic := ""
	if r.Target == "active" {
		if r.Definition == nil || r.Definition.UUID != r.Workflow || r.Definition.Version != r.Operation || r.Definition.Organization != r.Organization {
			return fmt.Errorf("snapshot identity mismatch")
		}
		p, err = dagPlan(*r.Definition)
		if err == nil {
			err = checkDAGBindings(ctx, tx, *r.Definition)
		}
		if err != nil {
			diagnostic = err.Error()
		}
	}
	status := "succeeded"
	if diagnostic != "" {
		status = "failed"
	} else {
		reason := "superseded"
		if r.Target == "inactive" {
			reason = "disabled"
		}
		if _, err = tx.Exec(ctx, `UPDATE device_runtime.dag_executions SET enabled=false,stopped_reason=$2,updated_at=$3 WHERE workflow_uuid=$1 AND enabled`, r.Workflow, reason, at); err != nil {
			return err
		}
		if _, err = tx.Exec(ctx, `UPDATE device_runtime.rule_executions SET enabled=false,stopped_reason=$2,updated_at=$3 WHERE rule_uuid=$1 AND enabled`, r.Workflow, reason, at); err != nil {
			return err
		}
		if p != nil {
			definition, _ := json.Marshal(r.Definition)
			state, _ := json.Marshal(p.Initial(at))
			if _, err = tx.Exec(ctx, `INSERT INTO device_runtime.dag_executions(operation_uuid,workflow_uuid,organization_uuid,definition,definition_hash,state,started_at,updated_at,next_timer) VALUES($1,$2,$3,$4,$5,$6,$7,$7,$7)`, r.Operation, r.Workflow, r.Organization, definition, p.Hash, state, at); err != nil {
				return err
			}
		}
	}
	outcome := map[string]any{"operation_uuid": r.Operation, "rule_uuid": r.Workflow, "organization_uuid": r.Organization, "generation": r.Generation, "target": r.Target, "status": status, "diagnostic": diagnostic}
	raw, _ := json.Marshal(outcome)
	if _, err = tx.Exec(ctx, `UPDATE device_runtime.rule_heads SET generation=$2,operation_uuid=$3,outcome=$4 WHERE rule_uuid=$1`, r.Workflow, r.Generation, r.Operation, raw); err != nil {
		return err
	}
	if err = event(ctx, tx, "workflow.deployment.v1", outcome); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func evaluateDAGs(ctx context.Context, tx pgx.Tx, input *devices.CommittedTelemetry, at, finalizedThrough time.Time) error {
	org := ""
	if input != nil {
		org = input.OrganizationUUID
	}
	rows, err := tx.Query(ctx, `SELECT operation_uuid,definition,state FROM device_runtime.dag_executions WHERE enabled AND ($1='' OR organization_uuid::text=$1) ORDER BY operation_uuid FOR UPDATE`, org)
	if err != nil {
		return err
	}
	type execution struct {
		operation  string
		definition dag.Workflow
		state      dag.State
	}
	executions := []execution{}
	for rows.Next() {
		var x execution
		var raw, state []byte
		if err = rows.Scan(&x.operation, &raw, &state); err != nil {
			rows.Close()
			return err
		}
		if err = json.Unmarshal(raw, &x.definition); err != nil {
			rows.Close()
			return err
		}
		if err = json.Unmarshal(state, &x.state); err != nil {
			rows.Close()
			return err
		}
		executions = append(executions, x)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	for _, x := range executions {
		if input != nil {
			matched := false
			for _, b := range x.definition.Bindings {
				matched = matched || b.Device == input.DeviceUUID
			}
			if !matched {
				continue
			}
		}
		p, e := dagPlan(x.definition)
		if e == nil {
			e = checkDAGBindings(ctx, tx, x.definition)
		}
		var result dag.Result
		if e == nil {
			clock := at
			if clock.Before(x.state.At) {
				clock = x.state.At
			}
			result, e = p.StepThrough(x.state, input, clock, finalizedThrough)
		}
		if e != nil {
			if _, err = tx.Exec(ctx, `UPDATE device_runtime.dag_executions SET enabled=false,stopped_reason=$2,updated_at=$3 WHERE operation_uuid=$1`, x.operation, e.Error(), at); err != nil {
				return err
			}
			if err = event(ctx, tx, "workflow.suspended.v1", map[string]any{"operation_uuid": x.operation, "rule_uuid": x.definition.UUID, "organization_uuid": x.definition.Organization, "reason": e.Error()}); err != nil {
				return err
			}
			continue
		}
		state, _ := json.Marshal(result.State)
		trace, _ := json.Marshal(result.Trace)
		if _, err = tx.Exec(ctx, `UPDATE device_runtime.dag_executions SET state=$2,next_timer=$3,updated_at=$4,last_trace=$5 WHERE operation_uuid=$1`, x.operation, state, result.NextTimer, at, trace); err != nil {
			return err
		}
		for _, intent := range result.Intents {
			raw, _ := json.Marshal(intent)
			insert, e := tx.Exec(ctx, `INSERT INTO device_runtime.dag_intents(id,operation_uuid,payload,created_at) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING`, intent.ID, x.operation, raw, at)
			if e != nil {
				return e
			}
			if insert.RowsAffected() > 0 {
				if err = event(ctx, tx, "automation.intent.v1", intent); err != nil {
					return err
				}
			}
		}
	}
	return nil
}

// Timer cutoff survives restarts. Continuous traffic cannot starve finalization:
// the target sequence is fixed until consumed, then all due timers run atomically.
func (s *Store) TickDAGs(ctx context.Context, at time.Time, lastSequence uint64) error {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var sequence uint64
	if err = tx.QueryRow(ctx, `SELECT sequence FROM device_runtime.rule_checkpoint WHERE singleton FOR UPDATE`).Scan(&sequence); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO device_runtime.dag_clock(singleton,cutoff,due_at) SELECT true,$1,$2 WHERE EXISTS(SELECT 1 FROM device_runtime.dag_executions WHERE enabled AND next_timer <= $2) ON CONFLICT DO NOTHING`, lastSequence, at); err != nil {
		return err
	}
	var cutoff uint64
	var due time.Time
	err = tx.QueryRow(ctx, `SELECT cutoff,due_at FROM device_runtime.dag_clock WHERE singleton`).Scan(&cutoff, &due)
	if err == pgx.ErrNoRows {
		return tx.Commit(ctx)
	}
	if err != nil {
		return err
	}
	if sequence >= cutoff {
		if err = evaluateDAGs(ctx, tx, nil, at, due); err != nil {
			return err
		}
		if _, err = tx.Exec(ctx, `DELETE FROM device_runtime.dag_clock WHERE singleton`); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}
