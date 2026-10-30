package storage

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/Elwids-tech/iot-os/services/runtime/internal/devices"
	"github.com/Elwids-tech/iot-os/services/runtime/internal/rules"
	"github.com/jackc/pgx/v5"
)

func (s *Store) DeployRule(ctx context.Context, request rules.Deployment, at time.Time) error {
	if err := request.Validate(); err != nil {
		return fmt.Errorf("%w: %v", ErrRejected, err)
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	diagnostic := ""
	if request.Target == "active" {
		var raw []byte
		var generation int
		var review bool
		err = tx.QueryRow(ctx, `SELECT definition,COALESCE(applied_generation,0),review_required FROM device_runtime.devices WHERE device_uuid=$1 AND organization_uuid=$2 FOR SHARE`, request.Definition.Binding.DeviceUUID, request.OrganizationUUID).Scan(&raw, &generation, &review)
		if err != nil && err != pgx.ErrNoRows {
			return err
		}
		var device devices.Definition
		if err == pgx.ErrNoRows || len(raw) == 0 {
			diagnostic = "Bound device is not active."
		} else {
			if err = Decode(raw, &device); err != nil {
				return err
			}
			if err = rules.CheckDevice(*request.Definition, device, generation, review); err != nil {
				diagnostic = err.Error()
			}
		}
	}
	_, err = tx.Exec(ctx, `INSERT INTO device_runtime.rule_heads(rule_uuid,organization_uuid) VALUES($1,$2) ON CONFLICT DO NOTHING`, request.RuleUUID, request.OrganizationUUID)
	if err != nil {
		return err
	}
	var generation int
	var org string
	var operation *string
	if err = tx.QueryRow(ctx, `SELECT generation,organization_uuid,operation_uuid FROM device_runtime.rule_heads WHERE rule_uuid=$1 FOR UPDATE`, request.RuleUUID).Scan(&generation, &org, &operation); err != nil {
		return err
	}
	if org != request.OrganizationUUID {
		return fmt.Errorf("%w: workflow organization mismatch", ErrRejected)
	}
	if request.Generation <= generation {
		if request.Generation == generation && (operation == nil || *operation != request.OperationUUID) {
			return fmt.Errorf("%w: workflow generation conflict", ErrRejected)
		}
		return tx.Commit(ctx) // original outcome is already durably in the outbox
	}
	status := "succeeded"
	if diagnostic != "" {
		status = "failed"
	} else {
		reason := "superseded"
		if request.Target == "inactive" {
			reason = "disabled"
		}
		if _, err = tx.Exec(ctx, `UPDATE device_runtime.rule_executions SET enabled=false,stopped_reason=$2,updated_at=$3 WHERE rule_uuid=$1 AND enabled`, request.RuleUUID, reason, at); err != nil {
			return err
		}
		if request.Target == "active" {
			compiled, err := rules.Compile(*request.Definition)
			if err != nil {
				return err
			}
			raw, _ := json.Marshal(request.Definition)
			state, _ := json.Marshal(compiled.Initial())
			_, err = tx.Exec(ctx, `INSERT INTO device_runtime.rule_executions(operation_uuid,rule_uuid,organization_uuid,device_uuid,definition,definition_hash,state,started_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$8)`, request.OperationUUID, request.RuleUUID, org, request.Definition.Binding.DeviceUUID, raw, compiled.Hash, state, at)
			if err != nil {
				return err
			}
		}
	}
	outcome := map[string]any{"operation_uuid": request.OperationUUID, "rule_uuid": request.RuleUUID, "organization_uuid": org, "generation": request.Generation, "target": request.Target, "status": status, "diagnostic": diagnostic}
	raw, _ := json.Marshal(outcome)
	if _, err = tx.Exec(ctx, `UPDATE device_runtime.rule_heads SET generation=$2,operation_uuid=$3,outcome=$4 WHERE rule_uuid=$1`, request.RuleUUID, request.Generation, request.OperationUUID, raw); err != nil {
		return err
	}
	if err = event(ctx, tx, "workflow.deployment.v1", outcome); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// ErrRuleCheckpointContinuity means the checkpoint no longer matches the retained
// stream. Only an operator may accept the gap (RebaselineRuleCheckpoint).
var ErrRuleCheckpointContinuity = errors.New("workflow telemetry checkpoint lost continuity; recovery required")

// PrepareRuleConsumer binds the durable SQL checkpoint to a particular stream
// incarnation. Retention loss or replacement is an explicit recovery failure.
func (s *Store) PrepareRuleConsumer(ctx context.Context, created time.Time, first, last uint64) (uint64, error) {
	baseline := uint64(0)
	if first > 0 {
		baseline = first - 1
	}
	_, err := s.Pool.Exec(ctx, `INSERT INTO device_runtime.rule_checkpoint(singleton,stream_created,sequence) VALUES(true,$1,$2) ON CONFLICT DO NOTHING`, created, baseline)
	if err != nil {
		return 0, err
	}
	stored, sequence, err := s.RuleCheckpoint(ctx)
	if err != nil {
		return 0, err
	}
	if !stored.Equal(created.Truncate(time.Microsecond)) || sequence < baseline || sequence > last {
		return 0, ErrRuleCheckpointContinuity
	}
	return sequence, nil
}

// RuleCheckpoint returns the stream incarnation and sequence evaluated so far.
func (s *Store) RuleCheckpoint(ctx context.Context) (time.Time, uint64, error) {
	var stored time.Time
	var sequence uint64
	err := s.Pool.QueryRow(ctx, `SELECT stream_created,sequence FROM device_runtime.rule_checkpoint WHERE singleton`).Scan(&stored, &sequence)
	return stored, sequence, err
}

// RebaselineRuleCheckpoint accepts a continuity gap by binding the checkpoint to
// the current stream incarnation at its last sequence. Telemetry before that point
// is never evaluated, so stale readings cannot trigger actions after recovery.
// It refuses to move a checkpoint that is still continuous.
func (s *Store) RebaselineRuleCheckpoint(ctx context.Context, created time.Time, first, last uint64) (previousCreated time.Time, previousSequence uint64, err error) {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return previousCreated, 0, err
	}
	defer tx.Rollback(ctx)
	if err = tx.QueryRow(ctx, `SELECT stream_created,sequence FROM device_runtime.rule_checkpoint WHERE singleton FOR UPDATE`).Scan(&previousCreated, &previousSequence); err != nil {
		return previousCreated, 0, err
	}
	baseline := uint64(0)
	if first > 0 {
		baseline = first - 1
	}
	if previousCreated.Equal(created.Truncate(time.Microsecond)) && previousSequence >= baseline && previousSequence <= last {
		return previousCreated, previousSequence, ErrRuleCheckpointContinuous
	}
	if _, err = tx.Exec(ctx, `UPDATE device_runtime.rule_checkpoint SET stream_created=$1,sequence=$2 WHERE singleton`, created, last); err != nil {
		return previousCreated, previousSequence, err
	}
	return previousCreated, previousSequence, tx.Commit(ctx)
}

// ErrRuleCheckpointContinuous rejects a rebaseline that would skip evaluable telemetry.
var ErrRuleCheckpointContinuous = errors.New("workflow telemetry checkpoint is continuous; nothing to recover")

// ConsumeRuleTelemetry atomically records deduplication, all affected rule states,
// transitions, their outbox records and the broker checkpoint before acknowledgement.
func (s *Store) ConsumeRuleTelemetry(ctx context.Context, sequence uint64, input devices.CommittedTelemetry, at time.Time) error {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var previous uint64
	if err = tx.QueryRow(ctx, `SELECT sequence FROM device_runtime.rule_checkpoint WHERE singleton FOR UPDATE`).Scan(&previous); err != nil {
		return err
	}
	if sequence <= previous {
		return tx.Commit(ctx)
	}
	if sequence != previous+1 {
		return fmt.Errorf("workflow telemetry sequence gap: expected %d, got %d", previous+1, sequence)
	}
	insert, err := tx.Exec(ctx, `INSERT INTO device_runtime.rule_inputs(event_uuid,consumed_at) VALUES($1,$2) ON CONFLICT DO NOTHING`, input.EventID, at)
	if err != nil {
		return err
	}
	if insert.RowsAffected() != 0 {
		if err = evaluateRules(ctx, tx, &input, at); err != nil {
			return err
		}
		if err = evaluateDAGs(ctx, tx, &input, at, at); err != nil {
			return err
		}
	}
	if _, err = tx.Exec(ctx, `UPDATE device_runtime.rule_checkpoint SET sequence=$1 WHERE singleton`, sequence); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// SkipRuleTelemetry advances the checkpoint past exactly one message that was
// dead-lettered instead of evaluated. It is idempotent for a redelivery.
func (s *Store) SkipRuleTelemetry(ctx context.Context, sequence uint64) error {
	if sequence == 0 {
		return fmt.Errorf("workflow telemetry sequence must be positive")
	}
	tag, err := s.Pool.Exec(ctx, `UPDATE device_runtime.rule_checkpoint SET sequence=$1 WHERE singleton AND sequence=$2`, sequence, sequence-1)
	if err != nil || tag.RowsAffected() == 1 {
		return err
	}
	_, current, err := s.RuleCheckpoint(ctx)
	if err != nil {
		return err
	}
	if current >= sequence {
		return nil
	}
	return fmt.Errorf("workflow telemetry sequence gap: expected %d, got %d", current+1, sequence)
}

func (s *Store) TickRules(ctx context.Context, at time.Time) error {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if err = evaluateRules(ctx, tx, nil, at); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func evaluateRules(ctx context.Context, tx pgx.Tx, input *devices.CommittedTelemetry, at time.Time) error {
	device := ""
	if input != nil {
		device = input.DeviceUUID
	}
	// Devices are retained after deactivation, so an inner join also lets us fence
	// old bindings. The device row lock serializes against configuration changes.
	rows, err := tx.Query(ctx, `SELECT r.operation_uuid,r.definition,r.state,r.started_at,d.definition,COALESCE(d.applied_generation,0),d.review_required
 FROM device_runtime.rule_executions r JOIN device_runtime.devices d ON d.device_uuid=r.device_uuid
 WHERE r.enabled AND ($1='' OR r.device_uuid::text=$1) ORDER BY r.operation_uuid FOR UPDATE OF r FOR SHARE OF d`, device)
	if err != nil {
		return err
	}
	type execution struct {
		operation  string
		definition rules.Definition
		state      rules.State
		started    time.Time
		device     devices.Definition
		generation int
		review     bool
	}
	executions := []execution{}
	for rows.Next() {
		var x execution
		var definition, state, device []byte
		if err = rows.Scan(&x.operation, &definition, &state, &x.started, &device, &x.generation, &x.review); err != nil {
			rows.Close()
			return err
		}
		for _, pair := range []struct {
			raw    []byte
			target any
		}{{definition, &x.definition}, {state, &x.state}} {
			if err = Decode(pair.raw, pair.target); err != nil {
				rows.Close()
				return err
			}
		}
		if len(device) > 0 {
			if err = Decode(device, &x.device); err != nil {
				rows.Close()
				return err
			}
		}
		executions = append(executions, x)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	for _, x := range executions {
		if err = rules.CheckDevice(x.definition, x.device, x.generation, x.review); err != nil {
			if _, err = tx.Exec(ctx, `UPDATE device_runtime.rule_executions SET enabled=false,stopped_reason='binding_changed',updated_at=$2 WHERE operation_uuid=$1`, x.operation, at); err != nil {
				return err
			}
			if err = event(ctx, tx, "workflow.suspended.v1", map[string]any{"operation_uuid": x.operation, "rule_uuid": x.definition.UUID, "organization_uuid": x.definition.Binding.OrganizationUUID, "reason": "binding_changed"}); err != nil {
				return err
			}
			continue
		}
		if input != nil {
			if input.OrganizationUUID != x.definition.Binding.OrganizationUUID {
				continue
			}
			before := false
			for _, reading := range input.Readings {
				if reading.ParameterUUID == x.definition.Binding.LatitudeParameterUUID || reading.ParameterUUID == x.definition.Binding.LongitudeParameterUUID {
					before = before || reading.ReceivedAt.Before(x.started) || reading.ObservedAt.Before(x.started)
				}
			}
			if before {
				continue
			} // activation never replays evidence received before it
		}
		compiled, err := rules.Compile(x.definition)
		if err != nil {
			return err
		}
		evaluatedAt := at
		if evaluatedAt.Before(x.state.EvaluatedAt) {
			evaluatedAt = x.state.EvaluatedAt
		}
		result, err := compiled.Step(x.state, input, evaluatedAt)
		if err != nil {
			return err
		}
		raw, _ := json.Marshal(result.State)
		if _, err = tx.Exec(ctx, `UPDATE device_runtime.rule_executions SET state=$2,updated_at=$3 WHERE operation_uuid=$1`, x.operation, raw, evaluatedAt); err != nil {
			return err
		}
		if result.Transition != nil {
			raw, _ := json.Marshal(result.Transition)
			insert, err := tx.Exec(ctx, `INSERT INTO device_runtime.rule_transitions(id,operation_uuid,transition,created_at) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING`, result.Transition.ID, x.operation, raw, evaluatedAt)
			if err != nil {
				return err
			}
			if insert.RowsAffected() > 0 {
				if err = event(ctx, tx, "workflow.transition.v1", map[string]any{"operation_uuid": x.operation, "rule_uuid": x.definition.UUID, "organization_uuid": x.definition.Binding.OrganizationUUID, "transition": result.Transition}); err != nil {
					return err
				}
			}
		}
		if result.MembershipTransition != nil {
			raw, _ := json.Marshal(result.MembershipTransition)
			insert, err := tx.Exec(ctx, `INSERT INTO device_runtime.rule_transitions(id,operation_uuid,transition,created_at) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING`, result.MembershipTransition.ID, x.operation, raw, evaluatedAt)
			if err != nil {
				return err
			}
			if insert.RowsAffected() > 0 {
				if err = event(ctx, tx, "workflow.membership.v1", map[string]any{"operation_uuid": x.operation, "rule_uuid": x.definition.UUID, "organization_uuid": x.definition.Binding.OrganizationUUID, "transition": result.MembershipTransition}); err != nil {
					return err
				}
			}
		}
	}
	return nil
}
