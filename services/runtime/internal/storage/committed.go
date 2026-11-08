package storage

import (
	"context"
	"errors"
	"github.com/jackc/pgx/v5"
	"strconv"
	"time"

	"github.com/Elwids-tech/iot-os/services/runtime/internal/devices"
)

// Read one persisted event by tenant/device identity. The outbox is not exposed
// as a public stream; retention still bounds reads even while rows are retained.
func (s *Store) CommittedEvent(ctx context.Context, org, device, id string, cutoff, until time.Time) (*devices.CommittedTelemetry, error) {
	var raw []byte
	var sequence int64
	err := s.Pool.QueryRow(ctx, `SELECT sequence,event FROM device_runtime.telemetry_outbox
	 WHERE telemetry_uuid=$1 AND organization_uuid=$2 AND event->>'device_uuid'=$3
	 AND created_at >= $4 AND created_at <= $5`, id, org, device, cutoff, until).Scan(&sequence, &raw)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var event devices.CommittedTelemetry
	if err = Decode(raw, &event); err != nil {
		return nil, err
	}
	event.Sequence = strconv.FormatInt(sequence, 10)
	return &event, nil
}

// Latest persisted device event, including incomplete/invalid fixes. Never
// search backwards for a good point and conceal a newer unknown location.
func (s *Store) LatestCommittedEvent(ctx context.Context, org, device string, cutoff, until time.Time) (*devices.CommittedTelemetry, error) {
	var id string
	err := s.Pool.QueryRow(ctx, `SELECT telemetry_uuid::text FROM device_runtime.telemetry_outbox
	 WHERE organization_uuid=$1 AND event->>'device_uuid'=$2 AND created_at >= $3 AND created_at <= $4
	 ORDER BY sequence DESC LIMIT 1`, org, device, cutoff, until).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return s.CommittedEvent(ctx, org, device, id, cutoff, until)
}

func (s *Store) CommittedPending(ctx context.Context) ([]devices.CommittedTelemetry, error) {
	rows, err := s.Pool.Query(ctx, "SELECT sequence,event FROM device_runtime.telemetry_outbox WHERE published_at IS NULL ORDER BY sequence LIMIT 100")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	events := []devices.CommittedTelemetry{}
	for rows.Next() {
		var sequence int64
		var raw []byte
		var event devices.CommittedTelemetry
		if err = rows.Scan(&sequence, &raw); err != nil {
			return nil, err
		}
		if err = Decode(raw, &event); err != nil {
			return nil, err
		}
		event.Sequence = strconv.FormatInt(sequence, 10)
		events = append(events, event)
	}
	return events, rows.Err()
}

func (s *Store) AckCommitted(ctx context.Context, id string) error {
	_, err := s.Pool.Exec(ctx, "UPDATE device_runtime.telemetry_outbox SET published_at=COALESCE(published_at,now()) WHERE telemetry_uuid=$1", id)
	return err
}

type CommittedBacklog struct {
	Pending          int64   `json:"pending"`
	OldestAgeSeconds float64 `json:"oldest_age_seconds"`
}

func (s *Store) CommittedBacklog(ctx context.Context) (CommittedBacklog, error) {
	var result CommittedBacklog
	err := s.Pool.QueryRow(ctx, `SELECT count(*),COALESCE(GREATEST(0,extract(epoch FROM now()-min(created_at))),0)::double precision
	 FROM device_runtime.telemetry_outbox WHERE published_at IS NULL`).Scan(&result.Pending, &result.OldestAgeSeconds)
	return result, err
}

// CommittedRow is one retained outbox row, read for a telemetry stream's catch-up.
type CommittedRow struct {
	Sequence int64
	Event    devices.CommittedTelemetry
}

// CommittedAfter reads the retained events of the named devices with a sequence
// greater than after, oldest first, at most limit rows (spec 030, research R3). The
// stream handler pages through it with the last sequence it wrote.
func (s *Store) CommittedAfter(ctx context.Context, org string, deviceIDs []string, after int64, limit int) ([]CommittedRow, error) {
	rows, err := s.Pool.Query(ctx, `SELECT sequence,event FROM device_runtime.telemetry_outbox
	 WHERE organization_uuid=$1 AND event->>'device_uuid' = ANY($2) AND sequence > $3
	 ORDER BY sequence LIMIT $4`, org, deviceIDs, after, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []CommittedRow{}
	for rows.Next() {
		var row CommittedRow
		var raw []byte
		if err = rows.Scan(&row.Sequence, &raw); err != nil {
			return nil, err
		}
		if err = Decode(raw, &row.Event); err != nil {
			return nil, err
		}
		row.Event.Sequence = strconv.FormatInt(row.Sequence, 10)
		result = append(result, row)
	}
	return result, rows.Err()
}

// CommittedFloor is the organization's oldest retained sequence. ok is false when the
// organization has no retained event: then there is no floor and a stream opens at 0.
func (s *Store) CommittedFloor(ctx context.Context, org string) (floor int64, ok bool, err error) {
	var value *int64
	err = s.Pool.QueryRow(ctx, "SELECT min(sequence) FROM device_runtime.telemetry_outbox WHERE organization_uuid=$1", org).Scan(&value)
	if err != nil || value == nil {
		return 0, false, err
	}
	return *value, true, nil
}

// CommittedHead is the organization's greatest retained sequence, 0 when it has none:
// where a fresh stream starts.
func (s *Store) CommittedHead(ctx context.Context, org string) (int64, error) {
	var head int64
	err := s.Pool.QueryRow(ctx, "SELECT COALESCE(max(sequence),0) FROM device_runtime.telemetry_outbox WHERE organization_uuid=$1", org).Scan(&head)
	return head, err
}
