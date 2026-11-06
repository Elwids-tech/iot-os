package storage

import (
	"context"
	"crypto/sha1"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"slices"
	"strings"
	"time"

	"github.com/Elwids-tech/iot-os/services/runtime/internal/devices"
	"github.com/jackc/pgx/v5"
)

// ConnectivityRow is a monitored subject's stored state (spec 018): written when
// monitoring starts, a subject is first heard, or an episode opens, clears or stops;
// never per packet.
type ConnectivityRow struct {
	SubjectKey           string
	OrganizationUUID     string
	Kind                 string
	MonitoringSince      time.Time
	HeardSinceMonitoring bool
	SettingsGeneration   int64
	Episode              int
	Open                 bool
	OfflineSince         *time.Time
	OpenedAt             *time.Time
	Cause                string
	// AffectedDeviceUUIDs are the devices the open episode concerns, so it can be
	// stopped after its subject is gone.
	AffectedDeviceUUIDs []string
}

// connectivityNamespace derives connectivity event ids (UUID v5).
const connectivityNamespace = "4b0b7a9e-5d1f-4c55-9a0e-7f2d3c018e01"

// UUIDv5 is the name-based UUID of name under namespace (RFC 9562).
func UUIDv5(namespace, name string) string {
	space, e := hex.DecodeString(strings.ReplaceAll(namespace, "-", ""))
	if e != nil || len(space) != 16 {
		panic("invalid UUID namespace " + namespace)
	}
	sum := sha1.Sum(append(space, name...))
	b := sum[:16]
	b[6] = (b[6] & 0x0f) | 0x50
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

// ConnectivityEventUUID is the id of one episode transition, so a re-emitted one
// deduplicates in the control plane's inbox.
func ConnectivityEventUUID(subjectKey string, episode int, transition string) string {
	return UUIDv5(connectivityNamespace, fmt.Sprintf("%s#%d#%s", subjectKey, episode, transition))
}

const upsertConnectivity = `INSERT INTO device_runtime.connectivity(subject_key,organization_uuid,kind,monitoring_since,heard_since_monitoring,settings_generation,episode,open,offline_since,opened_at,cause,affected_device_uuids,updated_at)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NULLIF($11,''),$12,now())
 ON CONFLICT (subject_key) DO UPDATE SET organization_uuid=EXCLUDED.organization_uuid, kind=EXCLUDED.kind, monitoring_since=EXCLUDED.monitoring_since,
 heard_since_monitoring=EXCLUDED.heard_since_monitoring, settings_generation=EXCLUDED.settings_generation, episode=EXCLUDED.episode, open=EXCLUDED.open,
 offline_since=EXCLUDED.offline_since, opened_at=EXCLUDED.opened_at, cause=EXCLUDED.cause, affected_device_uuids=EXCLUDED.affected_device_uuids, updated_at=now()`

func connectivityArguments(row ConnectivityRow) ([]any, error) {
	affected := row.AffectedDeviceUUIDs
	if affected == nil {
		affected = []string{}
	}
	raw, e := json.Marshal(affected)
	if e != nil {
		return nil, e
	}
	return []any{row.SubjectKey, row.OrganizationUUID, row.Kind, row.MonitoringSince, row.HeardSinceMonitoring, row.SettingsGeneration, row.Episode, row.Open, row.OfflineSince, row.OpenedAt, row.Cause, raw}, nil
}

// TransitionConnectivity stores a subject's row and its device.connectivity.v1 event in
// one transaction. The event keeps its own id, so storing a transition again adds no
// second event; inserted reports whether this call added it.
func (s *Store) TransitionConnectivity(ctx context.Context, row ConnectivityRow, ev devices.Event) (bool, error) {
	arguments, e := connectivityArguments(row)
	if e != nil {
		return false, e
	}
	data, e := json.Marshal(ev)
	if e != nil {
		return false, e
	}
	tx, e := s.Pool.Begin(ctx)
	if e != nil {
		return false, e
	}
	defer tx.Rollback(ctx)
	if _, e = tx.Exec(ctx, upsertConnectivity, arguments...); e != nil {
		return false, e
	}
	tag, e := tx.Exec(ctx, "INSERT INTO device_runtime.outbox(uuid,event) VALUES($1,$2) ON CONFLICT (uuid) DO NOTHING", ev.UUID, data)
	if e != nil {
		return false, e
	}
	return tag.RowsAffected() == 1, tx.Commit(ctx)
}

// SaveConnectivity stores rows whose monitoring changed without a transition.
func (s *Store) SaveConnectivity(ctx context.Context, rows []ConnectivityRow) error {
	if len(rows) == 0 {
		return nil
	}
	batch := &pgx.Batch{}
	for _, row := range rows {
		arguments, e := connectivityArguments(row)
		if e != nil {
			return e
		}
		batch.Queue(upsertConnectivity, arguments...)
	}
	return s.Pool.SendBatch(ctx, batch).Close()
}

// LoadConnectivity returns every stored subject, for the tracker to resume from.
func (s *Store) LoadConnectivity(ctx context.Context) ([]ConnectivityRow, error) {
	rows, e := s.Pool.Query(ctx, `SELECT subject_key, organization_uuid::text, kind, monitoring_since, heard_since_monitoring, settings_generation, episode, open, offline_since, opened_at, COALESCE(cause,''), affected_device_uuids FROM device_runtime.connectivity`)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	result := []ConnectivityRow{}
	for rows.Next() {
		var row ConnectivityRow
		var affected []byte
		if e = rows.Scan(&row.SubjectKey, &row.OrganizationUUID, &row.Kind, &row.MonitoringSince, &row.HeardSinceMonitoring, &row.SettingsGeneration, &row.Episode, &row.Open, &row.OfflineSince, &row.OpenedAt, &row.Cause, &affected); e != nil {
			return nil, e
		}
		if e = json.Unmarshal(affected, &row.AffectedDeviceUUIDs); e != nil {
			return nil, e
		}
		row.MonitoringSince = row.MonitoringSince.UTC()
		for _, t := range []**time.Time{&row.OfflineSince, &row.OpenedAt} {
			if *t != nil {
				utc := (*t).UTC()
				*t = &utc
			}
		}
		result = append(result, row)
	}
	return result, rows.Err()
}

// PruneConnectivity deletes the rows of subjects that are no longer monitored and
// have no open episode; active lists the subjects that are.
func (s *Store) PruneConnectivity(ctx context.Context, active []string) (int64, error) {
	tag, e := s.Pool.Exec(ctx, "DELETE FROM device_runtime.connectivity WHERE NOT open AND NOT (subject_key = ANY($1::text[]))", active)
	if e != nil {
		return 0, e
	}
	return tag.RowsAffected(), nil
}

// SeedDevice names a device whose reporting interval is seeded from its readings.
type SeedDevice struct{ OrganizationUUID, DeviceUUID string }

// SeedLimit is how many distinct observed times ReportingSeed returns per device:
// enough for the tracker's 64 gaps.
const SeedLimit = 65

// SeedHistory is what a device's stored readings tell the tracker at start.
type SeedHistory struct {
	// Observed are distinct observed times, oldest first.
	Observed []time.Time
	// LastReceived is when the newest of them was received.
	LastReceived time.Time
}

// ReportingSeed returns, per device, the distinct observed times of its readings
// received since since that are not marked historical, oldest first, at most
// SeedLimit of the newest, and when the newest of them was received. Older chunks may
// be compressed, so it allows longer than the pool's statement limit.
func (s *Store) ReportingSeed(ctx context.Context, batch []SeedDevice, since time.Time) (map[string]SeedHistory, error) {
	result := map[string]SeedHistory{}
	if len(batch) == 0 {
		return result, nil
	}
	organizations, deviceUUIDs := make([]string, len(batch)), make([]string, len(batch))
	for i, d := range batch {
		organizations[i], deviceUUIDs[i] = d.OrganizationUUID, d.DeviceUUID
	}
	tx, e := s.Pool.BeginTx(ctx, pgx.TxOptions{AccessMode: pgx.ReadOnly})
	if e != nil {
		return nil, e
	}
	defer tx.Rollback(ctx)
	if _, e = tx.Exec(ctx, "SET LOCAL statement_timeout = '60s'"); e != nil {
		return nil, e
	}
	rows, e := tx.Query(ctx, `SELECT d.device::text, t.observed_at, t.received_at FROM unnest($1::uuid[], $2::uuid[]) AS d(organization, device)
 CROSS JOIN LATERAL (SELECT o.observed_at, max(o.received_at) AS received_at FROM device_runtime.observations o
  WHERE o.organization_uuid=d.organization AND o.device_uuid=d.device AND o.received_at >= $3 AND o.observed_at >= $3
   AND NOT COALESCE((o.reading->>'historical')::boolean, false)
  GROUP BY o.observed_at ORDER BY o.observed_at DESC LIMIT $4) t`, organizations, deviceUUIDs, since, SeedLimit)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	for rows.Next() {
		var device string
		var observed, received time.Time
		if e = rows.Scan(&device, &observed, &received); e != nil {
			return nil, e
		}
		history := result[device]
		history.Observed = append(history.Observed, observed.UTC())
		if received.After(history.LastReceived) {
			history.LastReceived = received.UTC()
		}
		result[device] = history
	}
	if e = rows.Err(); e != nil {
		return nil, e
	}
	for _, history := range result {
		slices.Reverse(history.Observed)
	}
	return result, nil
}
