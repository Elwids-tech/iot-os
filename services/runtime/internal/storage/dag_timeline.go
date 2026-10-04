package storage

import (
	"context"
	"encoding/json"
	"time"

	"github.com/Elwids-tech/iot-os/services/runtime/internal/dag"
	"github.com/Elwids-tech/iot-os/services/runtime/internal/devices"
	"github.com/jackc/pgx/v5"
)

const DAGTimelineLimit = 1000

func recordDAGEvaluation(ctx context.Context, tx pgx.Tx, w dag.Workflow, input *devices.CommittedTelemetry, at time.Time, result *dag.Result, diagnostic string) error {
	trigger, outcome := "timer", "evaluated"
	var source any
	if input != nil {
		trigger = "telemetry"
		source = map[string]any{"event_id": input.EventID, "device_uuid": input.DeviceUUID, "configuration_uuid": input.ConfigurationUUID, "generation": input.Generation}
	}
	trace, ids, truncated := []dag.Trace{}, []string{}, false
	if result != nil {
		trace, truncated = result.Trace, result.TraceTruncated
		for _, intent := range result.Intents {
			ids = append(ids, intent.ID)
		}
		if len(ids) > 0 {
			outcome = "triggered"
		} else {
			for _, step := range trace {
				if step.Status == "waiting" {
					outcome = "waiting"
					break
				}
			}
		}
	}
	if diagnostic != "" {
		outcome = "suspended"
	}
	rawTrace, _ := json.Marshal(trace)
	rawIDs, _ := json.Marshal(ids)
	rawSource, _ := json.Marshal(source)
	if _, err := tx.Exec(ctx, `INSERT INTO device_runtime.dag_evaluations(operation_uuid,workflow_uuid,organization_uuid,received_at,trigger,outcome,source,diagnostic,trace,intent_ids,trace_truncated) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, w.Version, w.UUID, w.Organization, at, trigger, outcome, rawSource, diagnostic, rawTrace, rawIDs, truncated); err != nil {
		return err
	}
	// Cap history across all deployments of a workflow. Time-based organization
	// retention can remove it earlier through the existing cleanup service.
	_, err := tx.Exec(ctx, `DELETE FROM device_runtime.dag_evaluations WHERE workflow_uuid=$1 AND id < (SELECT id FROM device_runtime.dag_evaluations WHERE workflow_uuid=$1 ORDER BY id DESC OFFSET $2 LIMIT 1)`, w.UUID, DAGTimelineLimit-1)
	return err
}

type DAGEvaluation struct {
	ID             string          `json:"id"`
	Operation      string          `json:"operation_uuid"`
	At             time.Time       `json:"at"`
	Trigger        string          `json:"trigger"`
	Outcome        string          `json:"outcome"`
	Source         json.RawMessage `json:"source"`
	Diagnostic     *string         `json:"diagnostic"`
	IntentIDs      []string        `json:"intent_ids"`
	NodeCount      int             `json:"node_count"`
	TraceTruncated bool            `json:"trace_truncated"`
	Trace          json.RawMessage `json:"trace,omitempty"`
}

func (s *Store) DAGTimeline(ctx context.Context, org, workflow string, before, evaluation int64) ([]DAGEvaluation, error) {
	rows, err := s.Pool.Query(ctx, `SELECT id::text,operation_uuid::text,received_at,trigger,outcome,source,diagnostic,intent_ids,jsonb_array_length(trace),trace_truncated,CASE WHEN $4::bigint>0 THEN trace ELSE NULL END FROM device_runtime.dag_evaluations WHERE organization_uuid=$1::uuid AND workflow_uuid=$2::uuid AND ($3::bigint=0 OR id<$3) AND ($4::bigint=0 OR id=$4) ORDER BY device_runtime.dag_evaluations.id DESC LIMIT 21`, org, workflow, before, evaluation)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []DAGEvaluation{}
	for rows.Next() {
		var item DAGEvaluation
		var ids []byte
		if err = rows.Scan(&item.ID, &item.Operation, &item.At, &item.Trigger, &item.Outcome, &item.Source, &item.Diagnostic, &ids, &item.NodeCount, &item.TraceTruncated, &item.Trace); err != nil {
			return nil, err
		}
		if err = json.Unmarshal(ids, &item.IntentIDs); err != nil {
			return nil, err
		}
		result = append(result, item)
	}
	return result, rows.Err()
}
