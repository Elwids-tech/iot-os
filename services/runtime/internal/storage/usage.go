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
		return since, nil
	}
	for start := 0; start == 0 || start < len(buckets); start += usageBatch {
		batch := buckets[start:min(start+usageBatch, len(buckets))]
		if e = writeUsageEvent(ctx, tx, now, finalThrough, batch); e != nil {
			return since, e
		}
		for _, b := range batch {
			if _, e = tx.Exec(ctx, `UPDATE device_runtime.usage_data_points SET reported_count=GREATEST(reported_count,$3), reported_final=reported_final OR $4
 WHERE organization_uuid=$1 AND hour=$2`, b.OrganizationUUID, b.Hour, b.Count, b.Final); e != nil {
				return since, e
			}
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
	_, e = tx.Exec(ctx, "INSERT INTO device_runtime.outbox(uuid,event) VALUES($1,$2) ON CONFLICT (uuid) DO NOTHING", id, event)
	return e
}

// lastUsageWatermark is the final_through of the newest usage event still in the outbox.
func lastUsageWatermark(ctx context.Context, tx pgx.Tx) (time.Time, error) {
	var raw string
	e := tx.QueryRow(ctx, `SELECT event->'payload'->>'final_through' FROM device_runtime.outbox WHERE event->>'type'=$1 ORDER BY created_at DESC LIMIT 1`, UsageEventType).Scan(&raw)
	if errors.Is(e, pgx.ErrNoRows) {
		return time.Time{}, nil
	}
	if e != nil {
		return time.Time{}, e
	}
	return time.Parse(time.RFC3339, raw)
}
