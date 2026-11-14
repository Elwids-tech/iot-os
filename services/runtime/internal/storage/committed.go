package storage

import (
	"context"
	"errors"
	"github.com/jackc/pgx/v5"
	"sort"
	"strconv"
	"time"

	"github.com/Elwids-tech/iot-os/services/runtime/internal/devices"
)

// resentReading names a reading the storing transaction skipped because an earlier
// message already stored the same sample, with what this message said of it that
// the earlier row cannot: when it arrived and whether it was sent as history.
type resentReading struct {
	ParameterUUID string    `json:"parameter_uuid"`
	ObservedAt    time.Time `json:"observed_at"`
	ReceivedAt    time.Time `json:"received_at"`
	Historical    bool      `json:"historical"`
}

const eventColumns = `sequence,telemetry_uuid::text,organization_uuid::text,device_uuid::text,configuration_uuid::text,generation,received_at,resent`

type storedEvent struct {
	event    devices.CommittedTelemetry
	received time.Time
	resent   []resentReading
}

func scanEvents(rows pgx.Rows) ([]storedEvent, error) {
	defer rows.Close()
	result := []storedEvent{}
	for rows.Next() {
		var sequence int64
		var resent []byte
		row := storedEvent{event: devices.CommittedTelemetry{SchemaVersion: devices.CommittedTelemetryVersion, Readings: []devices.CommittedReading{}}}
		e := &row.event
		if err := rows.Scan(&sequence, &e.EventID, &e.OrganizationUUID, &e.DeviceUUID, &e.ConfigurationUUID, &e.Generation, &row.received, &resent); err != nil {
			return nil, err
		}
		row.received = row.received.UTC()
		e.TelemetryID = e.EventID
		e.Sequence = strconv.FormatInt(sequence, 10)
		if resent != nil {
			if err := Decode(resent, &row.resent); err != nil {
				return nil, err
			}
		}
		result = append(result, row)
	}
	return result, rows.Err()
}

// rebuild fills one device's events with their readings (ADR-042). A reading is
// stored once, in observations or diagnostics, under its message's UUID; a re-sent
// sample is read from the earlier row that holds it. An event whose readings have
// all expired is left out.
func (s *Store) rebuild(ctx context.Context, org, device string, events []storedEvent) ([]devices.CommittedTelemetry, error) {
	if len(events) == 0 {
		return []devices.CommittedTelemetry{}, nil
	}
	ids := make([]string, len(events))
	index := make(map[string]int, len(events))
	from, to := events[0].received, events[0].received
	for i, event := range events {
		ids[i] = event.event.EventID
		index[event.event.EventID] = i
		if event.received.Before(from) {
			from = event.received
		}
		if event.received.After(to) {
			to = event.received
		}
	}
	// The received-time bounds let TimescaleDB skip every chunk outside the events.
	// They are a microsecond wide of the events: an event row copied from the outbox
	// at upgrade has its time rounded to the microsecond, the readings' truncated.
	from, to = from.Add(-time.Microsecond), to.Add(time.Microsecond)
	rows, err := s.Pool.Query(ctx, `SELECT event_uuid::text,reading FROM device_runtime.observations
	 WHERE organization_uuid=$1 AND device_uuid=$2 AND event_uuid=ANY($3::uuid[]) AND received_at>=$4 AND received_at<=$5
	 UNION ALL
	 SELECT event_uuid::text,reading FROM device_runtime.diagnostics
	 WHERE organization_uuid=$1 AND device_uuid=$2 AND event_uuid=ANY($3::uuid[])`, org, device, ids, from, to)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		var raw []byte
		var reading devices.Reading
		if err = rows.Scan(&id, &raw); err != nil {
			return nil, err
		}
		if err = Decode(raw, &reading); err != nil {
			return nil, err
		}
		event := &events[index[id]].event
		event.Readings = append(event.Readings, devices.ProjectReading(reading))
	}
	if err = rows.Err(); err != nil {
		return nil, err
	}
	rows.Close()
	result := make([]devices.CommittedTelemetry, 0, len(events))
	for i := range events {
		event := &events[i].event
		for _, skipped := range events[i].resent {
			var raw []byte
			var reading devices.Reading
			// The storing transaction skipped it for matching this row: same parameter,
			// observed time and value.
			err = s.Pool.QueryRow(ctx, `SELECT reading FROM device_runtime.observations
			 WHERE organization_uuid=$1 AND device_uuid=$2 AND parameter_uuid=$3 AND observed_at=$4
			 ORDER BY received_at LIMIT 1`, org, device, skipped.ParameterUUID, skipped.ObservedAt).Scan(&raw)
			if errors.Is(err, pgx.ErrNoRows) {
				continue
			}
			if err != nil {
				return nil, err
			}
			if err = Decode(raw, &reading); err != nil {
				return nil, err
			}
			// The event carried the sample as this message delivered it.
			reading.ReceivedAt, reading.Historical = skipped.ReceivedAt, skipped.Historical
			event.Readings = append(event.Readings, devices.ProjectReading(reading))
		}
		if len(event.Readings) == 0 {
			continue
		}
		sort.Slice(event.Readings, func(a, b int) bool { return event.Readings[a].ParameterUUID < event.Readings[b].ParameterUUID })
		result = append(result, *event)
	}
	return result, nil
}

// Read one stored event by tenant/device identity. Retention bounds the read.
func (s *Store) CommittedEvent(ctx context.Context, org, device, id string, cutoff, until time.Time) (*devices.CommittedTelemetry, error) {
	rows, err := s.Pool.Query(ctx, `SELECT `+eventColumns+` FROM device_runtime.telemetry_events
	 WHERE telemetry_uuid=$1 AND organization_uuid=$2 AND device_uuid=$3 AND received_at >= $4 AND received_at <= $5`, id, org, device, cutoff, until)
	if err != nil {
		return nil, err
	}
	return s.one(ctx, org, device, rows)
}

// Latest stored device event, including incomplete/invalid fixes. Never
// search backwards for a good point and conceal a newer unknown location.
func (s *Store) LatestCommittedEvent(ctx context.Context, org, device string, cutoff, until time.Time) (*devices.CommittedTelemetry, error) {
	rows, err := s.Pool.Query(ctx, `SELECT `+eventColumns+` FROM device_runtime.telemetry_events
	 WHERE organization_uuid=$1 AND device_uuid=$2 AND received_at >= $3 AND received_at <= $4
	 ORDER BY received_at DESC, sequence DESC LIMIT 1`, org, device, cutoff, until)
	if err != nil {
		return nil, err
	}
	return s.one(ctx, org, device, rows)
}

func (s *Store) one(ctx context.Context, org, device string, rows pgx.Rows) (*devices.CommittedTelemetry, error) {
	events, err := scanEvents(rows)
	if err != nil {
		return nil, err
	}
	rebuilt, err := s.rebuild(ctx, org, device, events)
	if err != nil || len(rebuilt) == 0 {
		return nil, err
	}
	return &rebuilt[0], nil
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
