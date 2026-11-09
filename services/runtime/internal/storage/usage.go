package storage

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/Elwids-tech/iot-os/services/runtime/internal/devices"
	"github.com/jackc/pgx/v5"
)

// UsageEventType reports stored readings to the control plane (spec 029 US3, ADR-036).
const UsageEventType = "usage.data_points.v1"

// usageNamespace derives usage event ids (UUID v5).
const usageNamespace = "7d3a2c10-9e4b-4f61-8a5d-0c6b1e2f3a91"

// usageBatch is the most buckets one event carries.
const usageBatch = 500

// usageRetention is how long buckets are kept; the control plane keeps its own totals.
const usageRetention = 40 * 24 * time.Hour

// usageHeartbeat is the longest the reporter stays silent: with nothing to report it
// still writes an empty event this often, so a quiet deployment's counts do not read as
// late (spec 029 FR-014; the control plane calls them stale after five minutes).
const usageHeartbeat = 2 * time.Minute

// ReportUsage writes usage.data_points.v1 events for every bucket whose count grew
// since it was last reported, or whose hour has closed since, in one transaction that
// also records what was reported. Counts are cumulative and event ids derive from the
// content, so a replay or a lost acknowledgement is harmless. A bucket is final once
// its hour ended more than a minute ago, and final_through says every earlier hour is.
// With nothing to report it writes an empty event only when final_through moved past
// since, the final_through of the last event written; a zero since is read from the
// outbox. It returns the final_through now covered.
func (s *Store) ReportUsage(ctx context.Context, now, since time.Time) (time.Time, error) {
	now = now.UTC()
	finalThrough := now.Add(-time.Minute).Truncate(time.Hour)
	tx, e := s.Pool.Begin(ctx)
	if e != nil {
		return since, e
	}
	defer tx.Rollback(ctx)
	// The commit does not wait for its WAL flush, so the row locks below end with it even
	// while a checkpoint slows fsync, and storing never waits for them (spec 029 FR-015,
	// SC-004). A crash can lose this transaction whole: its counts are cumulative, so the
	// next pass reports them again.
	if _, e = tx.Exec(ctx, "SET LOCAL synchronous_commit TO OFF"); e != nil {
		return since, e
	}
	if since.IsZero() {
		if since, e = lastUsageWatermark(ctx, tx); e != nil {
			return since, e
		}
	}
	rows, e := tx.Query(ctx, `SELECT organization_uuid::text, hour, count FROM device_runtime.usage_data_points
 WHERE count>reported_count OR (NOT reported_final AND hour<$1)
 ORDER BY hour, organization_uuid`, finalThrough)
	if e != nil {
		return since, e
	}
	buckets, e := pgx.CollectRows(rows, func(row pgx.CollectableRow) (devices.UsageBucket, error) {
		var b devices.UsageBucket
		e := row.Scan(&b.OrganizationUUID, &b.Hour, &b.Count)
		b.Hour = b.Hour.UTC()
		b.Final = b.Hour.Before(finalThrough)
		return b, e
	})
	if e != nil {
		return since, e
	}
	if len(buckets) == 0 && !finalThrough.After(since) {
		last, e := lastUsageEventAt(ctx, tx)
		if e != nil || (!last.IsZero() && now.Sub(last) < usageHeartbeat) {
			return since, e
		}
		if e = writeUsageHeartbeat(ctx, tx, now, since); e != nil {
			return since, e
		}
		return since, tx.Commit(ctx)
	}
	// Only the pass's last event moves the watermark; the ones before it keep the previous
	// one, so the control plane never reads a month as final while some of its buckets
	// are still in a later event (ADR-036). Without a previous one, the earliest bucket's
	// hour claims nothing new.
	held := since
	if held.IsZero() && len(buckets) > 0 {
		held = buckets[0].Hour
	}
	if held.After(finalThrough) {
		held = finalThrough
	}
	for start := 0; start == 0 || start < len(buckets); start += usageBatch {
		end := min(start+usageBatch, len(buckets))
		through := finalThrough
		if end < len(buckets) {
			through = held
		}
		if e = writeUsageEvent(ctx, tx, now, through, buckets[start:end]); e != nil {
			return since, e
		}
	}
	// Recorded last, in one statement, just before the commit: storing upserts the same
	// rows, and their locks last until the commit, which does not wait for its flush.
	if len(buckets) > 0 {
		organizations, hours, counts, finals := make([]string, len(buckets)), make([]time.Time, len(buckets)), make([]int64, len(buckets)), make([]bool, len(buckets))
		for i, b := range buckets {
			organizations[i], hours[i], counts[i], finals[i] = b.OrganizationUUID, b.Hour, b.Count, b.Final
		}
		if _, e = tx.Exec(ctx, `UPDATE device_runtime.usage_data_points u SET reported_count=GREATEST(u.reported_count,r.count), reported_final=u.reported_final OR r.final
 FROM unnest($1::uuid[],$2::timestamptz[],$3::bigint[],$4::boolean[]) AS r(organization_uuid,hour,count,final)
 WHERE u.organization_uuid=r.organization_uuid AND u.hour=r.hour`, organizations, hours, counts, finals); e != nil {
			return since, e
		}
	}
	if e = tx.Commit(ctx); e != nil {
		return since, e
	}
	return finalThrough, nil
}

// PruneUsage removes buckets older than 40 days.
func (s *Store) PruneUsage(ctx context.Context, now time.Time) (int64, error) {
	tag, e := s.Pool.Exec(ctx, "DELETE FROM device_runtime.usage_data_points WHERE hour<$1", now.Add(-usageRetention))
	return tag.RowsAffected(), e
}

// UsageEventUUID is a usage event's id: the same buckets and watermark give the same id.
func UsageEventUUID(finalThrough time.Time, buckets []devices.UsageBucket) (string, error) {
	raw, e := json.Marshal(buckets)
	if e != nil {
		return "", e
	}
	sum := sha256.Sum256(raw)
	return UUIDv5(usageNamespace, fmt.Sprintf("usage.data_points#%s#%s", finalThrough.UTC().Format(time.RFC3339), hex.EncodeToString(sum[:]))), nil
}

func writeUsageEvent(ctx context.Context, tx pgx.Tx, now, finalThrough time.Time, buckets []devices.UsageBucket) error {
	if buckets == nil {
		buckets = []devices.UsageBucket{}
	}
	id, e := UsageEventUUID(finalThrough, buckets)
	if e != nil {
		return e
	}
	payload, e := json.Marshal(devices.UsageDataPoints{SchemaVersion: 1, GeneratedAt: now, FinalThrough: finalThrough, Buckets: buckets})
	if e != nil {
		return e
	}
	event, e := json.Marshal(devices.Event{UUID: id, Type: UsageEventType, Payload: payload})
	if e != nil {
		return e
	}
	// Each event gets its own time, so the relay, which reads by created_at, sends a
	// pass's events in the order they were written and the watermark arrives last.
	_, e = tx.Exec(ctx, "INSERT INTO device_runtime.outbox(uuid,event,created_at) VALUES($1,$2,clock_timestamp()) ON CONFLICT (uuid) DO NOTHING", id, event)
	return e
}

// writeUsageHeartbeat writes an event with no buckets that only says the runtime is
// reporting. Its id carries its time: identical content would otherwise make every
// heartbeat after the first a duplicate. Replaying one changes nothing.
func writeUsageHeartbeat(ctx context.Context, tx pgx.Tx, now, finalThrough time.Time) error {
	id := UUIDv5(usageNamespace, "usage.data_points#heartbeat#"+now.UTC().Format(time.RFC3339Nano))
	payload, e := json.Marshal(devices.UsageDataPoints{SchemaVersion: 1, GeneratedAt: now, FinalThrough: finalThrough, Buckets: []devices.UsageBucket{}})
	if e != nil {
		return e
	}
	event, e := json.Marshal(devices.Event{UUID: id, Type: UsageEventType, Payload: payload})
	if e != nil {
		return e
	}
	_, e = tx.Exec(ctx, "INSERT INTO device_runtime.outbox(uuid,event) VALUES($1,$2) ON CONFLICT (uuid) DO NOTHING", id, event)
	return e
}

// lastUsageEventAt is when the newest usage event still in the outbox was generated, in
// the reporter's own time.
func lastUsageEventAt(ctx context.Context, tx pgx.Tx) (time.Time, error) {
	var at *time.Time
	if e := tx.QueryRow(ctx, `SELECT max((event->'payload'->>'generated_at')::timestamptz) FROM device_runtime.outbox WHERE event->>'type'=$1`, UsageEventType).Scan(&at); e != nil {
		return time.Time{}, e
	}
	if at == nil {
		return time.Time{}, nil
	}
	return *at, nil
}

// lastUsageWatermark is the furthest final_through of the usage events still in the
// outbox: a pass's earlier events carry the previous one.
func lastUsageWatermark(ctx context.Context, tx pgx.Tx) (time.Time, error) {
	var raw string
	e := tx.QueryRow(ctx, `SELECT event->'payload'->>'final_through' FROM device_runtime.outbox WHERE event->>'type'=$1 ORDER BY (event->'payload'->>'final_through')::timestamptz DESC LIMIT 1`, UsageEventType).Scan(&raw)
	if errors.Is(e, pgx.ErrNoRows) {
		return time.Time{}, nil
	}
	if e != nil {
		return time.Time{}, e
	}
	return time.Parse(time.RFC3339, raw)
}
