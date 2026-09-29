package storage

import (
	"context"
	"crypto/rand"
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/Elwids-tech/iot-os/services/runtime/internal/devices"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

//go:embed schema.sql
var schema string

type Store struct{ Pool *pgxpool.Pool }

func Open(ctx context.Context, url string) (*Store, error) {
	return OpenWithSchema(ctx, url, true)
}

// OpenWithSchema lets release deployments migrate explicitly before starting writers.
func OpenWithSchema(ctx context.Context, url string, migrate bool) (*Store, error) {
	config, e := pgxpool.ParseConfig(url)
	if e != nil {
		return nil, e
	}
	config.ConnConfig.ConnectTimeout = 5 * time.Second
	config.ConnConfig.RuntimeParams["statement_timeout"] = "5000"
	pool, e := pgxpool.NewWithConfig(ctx, config)
	if e != nil {
		return nil, e
	}
	if e = pool.Ping(ctx); e != nil {
		pool.Close()
		return nil, e
	}
	if migrate {
		if _, e = pool.Exec(ctx, schema); e != nil {
			pool.Close()
			return nil, e
		}
	}
	return &Store{Pool: pool}, nil
}

// Devices v1 intentionally supports one active runtime against a deployment.
func (s *Store) ExclusiveRuntime(ctx context.Context) (func(), error) {
	connection, err := s.Pool.Acquire(ctx)
	if err != nil {
		return nil, err
	}
	const key int64 = 528254100482801
	var acquired bool
	if err = connection.QueryRow(ctx, "SELECT pg_try_advisory_lock($1)", key).Scan(&acquired); err != nil || !acquired {
		connection.Release()
		if err == nil {
			err = errors.New("another Devices runtime is already active")
		}
		return nil, err
	}
	var once sync.Once
	return func() {
		once.Do(func() {
			releaseCtx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
			defer cancel()
			_, _ = connection.Exec(releaseCtx, "SELECT pg_advisory_unlock($1)", key)
			connection.Release()
		})
	}, nil
}
func UUID() string {
	var b [16]byte
	if _, e := rand.Read(b[:]); e != nil {
		panic(e)
	}
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}
func Decode(raw []byte, v any) error {
	decoder := json.NewDecoder(strings.NewReader(string(raw)))
	decoder.UseNumber()
	return decoder.Decode(v)
}

// Event insertion is shared with transactions so state and its acknowledgement commit together.
func event(ctx context.Context, tx pgx.Tx, kind string, payload any) error {
	raw, e := json.Marshal(payload)
	if e != nil {
		return e
	}
	ev := devices.Event{UUID: UUID(), Type: kind, Payload: raw}
	data, e := json.Marshal(ev)
	if e != nil {
		return e
	}
	_, e = tx.Exec(ctx, "INSERT INTO device_runtime.outbox(uuid,event) VALUES($1,$2)", ev.UUID, data)
	return e
}
func (s *Store) Emit(ctx context.Context, kind string, payload any) error {
	tx, e := s.Pool.Begin(ctx)
	if e != nil {
		return e
	}
	defer tx.Rollback(ctx)
	if e = event(ctx, tx, kind, payload); e != nil {
		return e
	}
	return tx.Commit(ctx)
}

func (s *Store) RequireReview(ctx context.Context, d devices.Definition) error {
	_, err := s.Pool.Exec(ctx, `UPDATE device_runtime.devices SET review_required=true WHERE device_uuid=$1 AND definition->>'configuration_uuid'=$2`, d.DeviceUUID, d.ConfigurationUUID)
	return err
}
func (s *Store) Outbox(ctx context.Context) ([]devices.Event, error) {
	rows, e := s.Pool.Query(ctx, "SELECT event FROM device_runtime.outbox WHERE published_at IS NULL ORDER BY created_at LIMIT 100")
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	result := []devices.Event{}
	for rows.Next() {
		var raw []byte
		var ev devices.Event
		if e = rows.Scan(&raw); e != nil {
			return nil, e
		}
		if e = Decode(raw, &ev); e != nil {
			return nil, e
		}
		result = append(result, ev)
	}
	return result, rows.Err()
}
func (s *Store) Ack(ctx context.Context, id string) error {
	_, e := s.Pool.Exec(ctx, "UPDATE device_runtime.outbox SET published_at=now() WHERE uuid=$1", id)
	return e
}
func (s *Store) Apply(ctx context.Context, d devices.Definition, generation int, kind string, extra ...map[string]any) error {
	tx, e := s.Pool.Begin(ctx)
	if e != nil {
		return e
	}
	defer tx.Rollback(ctx)
	raw, e := json.Marshal(d)
	if e != nil {
		return e
	}
	var definition any = raw
	if kind == "device.deactivated.v1" {
		definition = nil
	}
	tag, e := tx.Exec(ctx, `INSERT INTO device_runtime.devices(device_uuid,organization_uuid,generation,definition) VALUES($1,$2,$3,$4)
 ON CONFLICT(device_uuid) DO UPDATE SET review_required=CASE WHEN device_runtime.devices.generation<excluded.generation THEN false ELSE device_runtime.devices.review_required END,generation=excluded.generation,definition=excluded.definition,updated_at=now() WHERE device_runtime.devices.generation<=excluded.generation`, d.DeviceUUID, d.OrganizationUUID, generation, definition)
	if e != nil {
		return e
	}
	if tag.RowsAffected() == 0 {
		return tx.Commit(ctx)
	}
	payload := map[string]any{"device_uuid": d.DeviceUUID, "organization_uuid": d.OrganizationUUID, "configuration_uuid": d.ConfigurationUUID, "generation": generation, "presence": "unknown"}
	if len(extra) > 0 {
		for key, value := range extra[0] {
			if text, ok := value.(string); !ok || text != "" {
				payload[key] = value
			}
		}
	}
	outcome, _ := json.Marshal(map[string]any{"type": kind, "payload": payload})
	if _, e = tx.Exec(ctx, "UPDATE device_runtime.devices SET outcome=$2 WHERE device_uuid=$1", d.DeviceUUID, outcome); e != nil {
		return e
	}
	if e = event(ctx, tx, kind, payload); e != nil {
		return e
	}

	return tx.Commit(ctx)
}

// Persist preserves the production API; PersistResult also exposes transaction acceptance.
func (s *Store) Persist(ctx context.Context, t devices.Telemetry) error {
	_, err := s.PersistResult(ctx, t)
	return err
}
func (s *Store) PersistResult(ctx context.Context, t devices.Telemetry) (bool, error) {
	tx, e := s.Pool.Begin(ctx)
	if e != nil {
		return false, e
	}
	defer tx.Rollback(ctx)
	var allowed bool
	if e = tx.QueryRow(ctx, "SELECT true FROM device_runtime.devices WHERE device_uuid=$1 AND generation=$2 AND definition->>'configuration_uuid'=$3 AND organization_uuid=$4 FOR SHARE", t.Definition.DeviceUUID, t.Generation, t.Definition.ConfigurationUUID, t.Definition.OrganizationUUID).Scan(&allowed); errors.Is(e, pgx.ErrNoRows) {
		return false, tx.Commit(ctx)
	} else if e != nil {
		return false, e
	}
	if !allowed {
		return false, tx.Commit(ctx)
	}
	if len(t.Readings) == 0 {
		return false, tx.Commit(ctx)
	}
	// The ledger and telemetry commit together. Do not infer acceptance from a
	// nil error: stale generations and duplicate deliveries are intentional no-ops.
	committed, e := json.Marshal(devices.ProjectCommitted(t))
	if e != nil {
		return false, e
	}
	inserted, e := tx.Exec(ctx, "INSERT INTO device_runtime.telemetry_outbox(telemetry_uuid,organization_uuid,event) VALUES($1,$2,$3) ON CONFLICT(telemetry_uuid) DO NOTHING", t.UUID, t.Definition.OrganizationUUID, committed)
	if e != nil {
		return false, e
	}
	if inserted.RowsAffected() == 0 {
		err := tx.Commit(ctx)
		return err == nil, err
	}
	for _, reading := range t.Readings {
		raw, e := json.Marshal(reading)
		if e != nil {
			return false, e
		}
		if reading.Quality == "good" {
			_, e = tx.Exec(ctx, `INSERT INTO device_runtime.observations(event_uuid,organization_uuid,device_uuid,configuration_uuid,parameter_uuid,received_at,observed_at,reading) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING`, t.UUID, t.Definition.OrganizationUUID, t.Definition.DeviceUUID, t.Definition.ConfigurationUUID, reading.ParameterUUID, reading.ReceivedAt, reading.ObservedAt, raw)
		} else {
			_, e = tx.Exec(ctx, `INSERT INTO device_runtime.diagnostics(event_uuid,organization_uuid,device_uuid,parameter_uuid,received_at,reading) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`, t.UUID, t.Definition.OrganizationUUID, t.Definition.DeviceUUID, reading.ParameterUUID, reading.ReceivedAt, raw)
		}
		if e != nil {
			return false, e
		}
		if reading.Historical {
			continue
		}
		_, e = tx.Exec(ctx, `INSERT INTO device_runtime.latest(organization_uuid,device_uuid,configuration_uuid,parameter_uuid,received_at,reading) VALUES($1,$2,$3,$4,$5,$6)
   ON CONFLICT(device_uuid,configuration_uuid,parameter_uuid) DO UPDATE SET received_at=excluded.received_at,
   reading=CASE WHEN excluded.reading->>'quality'='good' THEN excluded.reading ELSE excluded.reading || jsonb_build_object('value',device_runtime.latest.reading->'value','observed_at',device_runtime.latest.reading->'observed_at','last_valid_received_at',COALESCE(device_runtime.latest.reading->'last_valid_received_at',device_runtime.latest.reading->'received_at')) END
   WHERE device_runtime.latest.received_at<excluded.received_at`, t.Definition.OrganizationUUID, t.Definition.DeviceUUID, t.Definition.ConfigurationUUID, reading.ParameterUUID, reading.ReceivedAt, raw)
		if e != nil {
			return false, e
		}
	}
	err := tx.Commit(ctx)
	return err == nil, err
}
func (s *Store) Latest(ctx context.Context, org, device, configuration string) ([]devices.Reading, error) {
	rows, e := s.Pool.Query(ctx, "SELECT reading FROM device_runtime.latest WHERE organization_uuid=$1 AND device_uuid=$2 AND configuration_uuid=$3 ORDER BY parameter_uuid", org, device, configuration)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	result := []devices.Reading{}
	for rows.Next() {
		var raw []byte
		var r devices.Reading
		if e = rows.Scan(&raw); e != nil {
			return nil, e
		}
		if e = Decode(raw, &r); e != nil {
			return nil, e
		}
		result = append(result, r)
	}
	return result, rows.Err()
}

type HistoryPoint struct {
	At      time.Time `json:"at"`
	Value   any       `json:"value"`
	Minimum *float64  `json:"min,omitempty"`
	Maximum *float64  `json:"max,omitempty"`
	Count   int64     `json:"count"`
}
type HistorySeries struct {
	ConfigurationUUID string         `json:"configuration_uuid"`
	Unit              *string        `json:"unit"`
	DataType          string         `json:"data_type"`
	Points            []HistoryPoint `json:"points"`
}

var ErrHistoryTooBroad = errors.New("This range contains too many values or configuration changes. Choose a shorter range.")

func (s *Store) History(ctx context.Context, org, device, param string, from, to time.Time, maxPoints int) ([]HistorySeries, error) {
	seconds := int64(math.Ceil(to.Sub(from).Seconds() / float64(maxPoints/2)))
	if seconds < 1 {
		seconds = 1
	}
	rows, e := s.Pool.Query(ctx, `
    SELECT * FROM (
      SELECT configuration_uuid::text, reading->>'unit' AS unit, reading->>'data_type' AS datatype,
        to_timestamp(floor(extract(epoch FROM received_at)/$6)*$6) AS at,
        to_jsonb(avg((reading->>'value')::numeric)) AS value,
        min((reading->>'value')::double precision), max((reading->>'value')::double precision), count(*)
      FROM device_runtime.observations
      WHERE organization_uuid=$1 AND device_uuid=$2 AND parameter_uuid=$3 AND received_at>=$4 AND received_at<=$5
        AND reading->>'data_type' IN ('integer','number')
      GROUP BY configuration_uuid,reading->>'unit',reading->>'data_type',4
      UNION ALL
      SELECT configuration_uuid::text, reading->>'unit', reading->>'data_type', received_at,
        reading->'value', NULL::double precision, NULL::double precision, 1
      FROM device_runtime.observations
      WHERE organization_uuid=$1 AND device_uuid=$2 AND parameter_uuid=$3 AND received_at>=$4 AND received_at<=$5
        AND reading->>'data_type' NOT IN ('integer','number')
    ) history ORDER BY at LIMIT 2001`, org, device, param, from, to, seconds)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	series := []HistorySeries{}
	indices := map[string]int{}
	totalPoints := 0
	for rows.Next() {
		var config, datatype string
		var unit *string
		var point HistoryPoint
		var raw []byte
		if e = rows.Scan(&config, &unit, &datatype, &point.At, &raw, &point.Minimum, &point.Maximum, &point.Count); e != nil {
			return nil, e
		}
		if raw != nil {
			if e = Decode(raw, &point.Value); e != nil {
				return nil, e
			}
		}
		key := config + ":" + datatype
		if unit != nil {
			key += ":" + *unit
		}
		i, ok := indices[key]
		if !ok {
			i = len(series)
			indices[key] = i
			series = append(series, HistorySeries{ConfigurationUUID: config, DataType: datatype, Unit: unit, Points: []HistoryPoint{}})
		}
		points := series[i].Points
		if (datatype == "number" || datatype == "integer") && len(points) > 0 && point.At.Sub(points[len(points)-1].At) > time.Duration(seconds)*time.Second {
			series[i].Points = append(series[i].Points, HistoryPoint{At: points[len(points)-1].At.Add(time.Duration(seconds) * time.Second), Value: nil})
			totalPoints++
		}
		totalPoints++
		if totalPoints > 2000 {
			return nil, ErrHistoryTooBroad
		}
		series[i].Points = append(series[i].Points, point)
	}
	return series, rows.Err()
}

type HistoryCursor struct {
	At        time.Time `json:"at"`
	EventUUID string    `json:"event_uuid"`
	Consumed  int       `json:"consumed"`
	Scope     string    `json:"scope"`
}

type HistoryRecord struct {
	TimestampSource   string    `json:"timestamp_source"`
	Historical        bool      `json:"historical"`
	EventUUID         string    `json:"event_uuid"`
	ConfigurationUUID string    `json:"configuration_uuid"`
	ParameterUUID     string    `json:"parameter_uuid"`
	ReceivedAt        time.Time `json:"received_at"`
	ObservedAt        time.Time `json:"observed_at"`
	DataType          string    `json:"data_type"`
	Unit              *string   `json:"unit"`
	Value             any       `json:"value"`
	Quality           string    `json:"quality"`
	Diagnostic        string    `json:"diagnostic,omitempty"`
}

type HistoryRecordsPage struct {
	Records      []HistoryRecord `json:"data"`
	Next         *HistoryCursor  `json:"-"`
	Consumed     int             `json:"consumed"`
	LimitReached bool            `json:"limit_reached"`
}

func (s *Store) HistoryRecords(ctx context.Context, org, device, param string, from, to time.Time, limit, pageSize int, cursor *HistoryCursor) (HistoryRecordsPage, error) {
	consumed := 0
	var cursorAt any
	cursorEvent := ""
	if cursor != nil {
		consumed = cursor.Consumed
		cursorAt = cursor.At
		cursorEvent = cursor.EventUUID
	}
	remaining := limit - consumed
	if remaining <= 0 {
		return HistoryRecordsPage{Records: []HistoryRecord{}, Consumed: consumed}, nil
	}
	pageLimit := pageSize
	if remaining < pageLimit {
		pageLimit = remaining
	}
	rows, err := s.Pool.Query(ctx, `
      SELECT event_uuid::text, configuration_uuid::text, parameter_uuid::text,
        received_at, observed_at, reading
      FROM device_runtime.observations
      WHERE organization_uuid=$1 AND device_uuid=$2 AND parameter_uuid=$3
        AND received_at>=$4 AND received_at<=$5
        AND ($6::timestamptz IS NULL OR (received_at,event_uuid::text) < ($6::timestamptz,$7))
      ORDER BY received_at DESC,event_uuid DESC
      LIMIT $8`, org, device, param, from, to, cursorAt, cursorEvent, pageLimit+1)
	if err != nil {
		return HistoryRecordsPage{}, err
	}
	defer rows.Close()
	records := make([]HistoryRecord, 0, pageLimit+1)
	for rows.Next() {
		var record HistoryRecord
		var reading devices.Reading
		var raw []byte
		if err = rows.Scan(&record.EventUUID, &record.ConfigurationUUID, &record.ParameterUUID, &record.ReceivedAt, &record.ObservedAt, &raw); err != nil {
			return HistoryRecordsPage{}, err
		}
		if err = Decode(raw, &reading); err != nil {
			return HistoryRecordsPage{}, err
		}
		record.DataType = reading.DataType
		record.Unit = reading.Unit
		record.Value = reading.Value
		record.Quality = reading.Quality
		record.TimestampSource = reading.TimestampSource
		record.Historical = reading.Historical
		record.Diagnostic = reading.Diagnostic
		records = append(records, record)
	}
	if err = rows.Err(); err != nil {
		return HistoryRecordsPage{}, err
	}
	hasExtra := len(records) > pageLimit
	if hasExtra {
		records = records[:pageLimit]
	}
	consumed += len(records)
	page := HistoryRecordsPage{
		Records:      records,
		Consumed:     consumed,
		LimitReached: hasExtra && consumed >= limit,
	}
	if hasExtra && consumed < limit && len(records) > 0 {
		last := records[len(records)-1]
		page.Next = &HistoryCursor{At: last.ReceivedAt, EventUUID: last.EventUUID, Consumed: consumed}
	}
	return page, nil
}

type StateSegment struct {
	From              time.Time `json:"from"`
	To                time.Time `json:"to"`
	Value             any       `json:"value"`
	Known             bool      `json:"known"`
	DataType          string    `json:"data_type,omitempty"`
	ConfigurationUUID string    `json:"configuration_uuid,omitempty"`
}

type StateDuration struct {
	Value      any     `json:"value"`
	Known      bool    `json:"known"`
	DataType   string  `json:"data_type,omitempty"`
	DurationMS int64   `json:"duration_ms"`
	Percentage float64 `json:"percentage"`
}

type StateHistory struct {
	From      time.Time       `json:"from"`
	To        time.Time       `json:"to"`
	Durations []StateDuration `json:"durations"`
	Timeline  []StateSegment  `json:"timeline"`
	Sampled   bool            `json:"sampled"`
}

type stateChange struct {
	At                time.Time
	Value             any
	Known             bool
	DataType          string
	ConfigurationUUID string
}

func (s *Store) StateHistory(ctx context.Context, org, device, param string, from, to time.Time, maxPoints int) (StateHistory, error) {
	rows, err := s.Pool.Query(ctx, `
      WITH raw AS (
        SELECT * FROM (
          SELECT event_uuid,configuration_uuid,received_at,reading
          FROM device_runtime.observations
          WHERE organization_uuid=$1 AND device_uuid=$2 AND parameter_uuid=$3 AND received_at<$4
          ORDER BY received_at DESC,event_uuid DESC LIMIT 1
        ) carry
        UNION ALL
        SELECT event_uuid,configuration_uuid,received_at,reading
        FROM device_runtime.observations
        WHERE organization_uuid=$1 AND device_uuid=$2 AND parameter_uuid=$3
          AND received_at>=$4 AND received_at<=$5
      ), ordered AS (
        SELECT event_uuid,configuration_uuid,received_at,reading,
          row_number() OVER (ORDER BY received_at,event_uuid) AS sequence,
          lag(reading->'value') OVER (ORDER BY received_at,event_uuid) AS previous_value,
          lag(configuration_uuid) OVER (ORDER BY received_at,event_uuid) AS previous_configuration,
          lag(COALESCE(reading->>'quality','')) OVER (ORDER BY received_at,event_uuid) AS previous_quality,
          lag(COALESCE(reading->>'data_type','')) OVER (ORDER BY received_at,event_uuid) AS previous_data_type
        FROM raw
      )
      SELECT configuration_uuid::text,received_at,reading
      FROM ordered
      WHERE sequence=1
        OR reading->'value' IS DISTINCT FROM previous_value
        OR configuration_uuid IS DISTINCT FROM previous_configuration
        OR COALESCE(reading->>'quality','') IS DISTINCT FROM previous_quality
        OR COALESCE(reading->>'data_type','') IS DISTINCT FROM previous_data_type
      ORDER BY received_at,event_uuid`, org, device, param, from, to)
	if err != nil {
		return StateHistory{}, err
	}
	defer rows.Close()
	changes := []stateChange{}
	for rows.Next() {
		var change stateChange
		var reading devices.Reading
		var raw []byte
		if err = rows.Scan(&change.ConfigurationUUID, &change.At, &raw); err != nil {
			return StateHistory{}, err
		}
		if err = Decode(raw, &reading); err != nil {
			return StateHistory{}, err
		}
		change.Value = reading.Value
		change.DataType = reading.DataType
		change.Known = reading.Value != nil && (reading.Quality == "" || reading.Quality == "good")
		changes = append(changes, change)
	}
	if err = rows.Err(); err != nil {
		return StateHistory{}, err
	}

	segments := stateSegments(changes, from, to)
	durations := stateDurations(segments, to.Sub(from))
	timeline := segments
	sampled := len(timeline) > maxPoints
	if sampled {
		timeline = sampleStateSegments(segments, from, to, maxPoints)
	}
	return StateHistory{From: from, To: to, Durations: durations, Timeline: timeline, Sampled: sampled}, nil
}

func stateSegments(changes []stateChange, from, to time.Time) []StateSegment {
	segments := []StateSegment{}
	start := from
	var current *stateChange
	appendCurrent := func(end time.Time) {
		if !end.After(start) {
			return
		}
		segment := StateSegment{From: start, To: end}
		if current != nil {
			segment.Value = current.Value
			segment.Known = current.Known
			segment.DataType = current.DataType
			segment.ConfigurationUUID = current.ConfigurationUUID
		}
		if len(segments) > 0 && timelineKey(segments[len(segments)-1]) == timelineKey(segment) {
			segments[len(segments)-1].To = end
			return
		}
		segments = append(segments, segment)
	}
	for i := range changes {
		change := changes[i]
		if change.At.Before(from) {
			current = &change
			continue
		}
		if change.At.After(to) {
			break
		}
		appendCurrent(change.At)
		current = &change
		start = change.At
	}
	appendCurrent(to)
	return segments
}

func stateValueKey(value any) string {
	raw, err := json.Marshal(value)
	if err != nil {
		return fmt.Sprint(value)
	}
	return string(raw)
}

func segmentKey(segment StateSegment) string {
	if !segment.Known {
		return "unknown"
	}
	return segment.DataType + ":" + stateValueKey(segment.Value)
}

func timelineKey(segment StateSegment) string {
	return segmentKey(segment) + ":" + segment.ConfigurationUUID
}

func stateDurations(segments []StateSegment, total time.Duration) []StateDuration {
	type durationValue struct {
		segment StateSegment
		value   time.Duration
	}
	values := map[string]durationValue{}
	for _, segment := range segments {
		key := segmentKey(segment)
		entry := values[key]
		entry.segment = segment
		entry.value += segment.To.Sub(segment.From)
		values[key] = entry
	}
	result := make([]StateDuration, 0, len(values))
	for _, entry := range values {
		milliseconds := entry.value.Milliseconds()
		percentage := 0.0
		if total > 0 {
			percentage = float64(entry.value) / float64(total) * 100
		}
		result = append(result, StateDuration{
			Value: entry.segment.Value, Known: entry.segment.Known, DataType: entry.segment.DataType,
			DurationMS: milliseconds, Percentage: percentage,
		})
	}
	sort.Slice(result, func(i, j int) bool { return result[i].DurationMS > result[j].DurationMS })
	return result
}

func sampleStateSegments(segments []StateSegment, from, to time.Time, maxPoints int) []StateSegment {
	if maxPoints < 1 || len(segments) <= maxPoints {
		return segments
	}
	total := to.Sub(from)
	result := make([]StateSegment, 0, maxPoints)
	for i := 0; i < maxPoints; i++ {
		bucketFrom := from.Add(time.Duration(float64(total) * float64(i) / float64(maxPoints)))
		bucketTo := from.Add(time.Duration(float64(total) * float64(i+1) / float64(maxPoints)))
		overlaps := map[string]time.Duration{}
		representatives := map[string]StateSegment{}
		order := []string{}
		for _, segment := range segments {
			start := segment.From
			if start.Before(bucketFrom) {
				start = bucketFrom
			}
			end := segment.To
			if end.After(bucketTo) {
				end = bucketTo
			}
			if !end.After(start) {
				continue
			}
			key := timelineKey(segment)
			if _, exists := representatives[key]; !exists {
				order = append(order, key)
			}
			overlaps[key] += end.Sub(start)
			representatives[key] = segment
		}
		winner := ""
		best := time.Duration(-1)
		for _, key := range order {
			overlap := overlaps[key]
			if overlap > best {
				winner, best = key, overlap
			}
		}
		segment := representatives[winner]
		segment.From, segment.To = bucketFrom, bucketTo
		if len(result) > 0 && timelineKey(result[len(result)-1]) == timelineKey(segment) {
			result[len(result)-1].To = bucketTo
		} else {
			result = append(result, segment)
		}
	}
	return result
}

var ErrCleanupIncomplete = errors.New("bounded cleanup has more expired measurements to remove")

func (s *Store) Cleanup(ctx context.Context, org string, cutoff time.Time) (int64, error) {
	return s.cleanup(ctx, org, cutoff, 50, 10000)
}

func (s *Store) cleanup(ctx context.Context, org string, cutoff time.Time, batches, batchSize int) (int64, error) {
	var total int64
	var remaining bool
	for _, table := range []string{"observations", "diagnostics"} {
		for batch := 0; batch < batches; batch++ {
			tag, e := s.Pool.Exec(ctx, `DELETE FROM device_runtime.`+table+` WHERE (tableoid,ctid) IN (SELECT tableoid,ctid FROM device_runtime.`+table+` WHERE organization_uuid=$1 AND received_at<$2 LIMIT $3)`, org, cutoff, batchSize)
			if e != nil {
				return total, e
			}
			total += tag.RowsAffected()
			if tag.RowsAffected() < int64(batchSize) {
				break
			}
		}
		var pending bool
		if e := s.Pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM device_runtime.`+table+` WHERE organization_uuid=$1 AND received_at<$2)`, org, cutoff).Scan(&pending); e != nil {
			return total, e
		}
		remaining = remaining || pending
	}
	if remaining {
		return total, ErrCleanupIncomplete
	}
	return total, nil
}

func (s *Store) ClaimCommand(ctx context.Context, c devices.Command) (bool, error) {
	raw, e := json.Marshal(c)
	if e != nil {
		return false, e
	}
	tag, e := s.Pool.Exec(ctx, `INSERT INTO device_runtime.commands(command_uuid,organization_uuid,device_uuid,parameter_uuid,configuration_uuid,request,status,expires_at) VALUES($1,$2,$3,$4,$5,$6,'dispatching',$7) ON CONFLICT(command_uuid) DO NOTHING`, c.UUID, c.OrganizationUUID, c.DeviceUUID, c.ParameterUUID, c.ConfigurationUUID, raw, c.ExpiresAt)
	if e != nil {
		return false, e
	}
	return tag.RowsAffected() == 1, nil
}
func (s *Store) CommandStatus(ctx context.Context, c devices.Command, status, diagnostic string, sent *time.Time) error {
	tx, e := s.Pool.Begin(ctx)
	if e != nil {
		return e
	}
	defer tx.Rollback(ctx)
	// Terminal outcomes cannot be overwritten by a late send acknowledgement or timeout.
	tag, e := tx.Exec(ctx, `UPDATE device_runtime.commands SET status=$2,diagnostic=$3,sent_at=COALESCE($4,sent_at),updated_at=now() WHERE command_uuid=$1 AND status IN ('dispatching','sent') AND status<>$2`, c.UUID, status, diagnostic, sent)
	if e != nil {
		return e
	}
	if tag.RowsAffected() == 0 {
		return tx.Commit(ctx)
	}
	if e = event(ctx, tx, "command.status.v1", map[string]any{"organization_uuid": c.OrganizationUUID, "device_uuid": c.DeviceUUID, "command_uuid": c.UUID, "status": status, "diagnostic": diagnostic, "sent_at": sent}); e != nil {
		return e
	}
	return tx.Commit(ctx)
}
func (s *Store) Outstanding(ctx context.Context) ([]devices.Command, error) {
	rows, e := s.Pool.Query(ctx, "SELECT request FROM device_runtime.commands WHERE status IN ('dispatching','sent')")
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	result := []devices.Command{}
	for rows.Next() {
		var raw []byte
		var c devices.Command
		if e = rows.Scan(&raw); e != nil {
			return nil, e
		}
		if e = Decode(raw, &c); e != nil {
			return nil, e
		}
		result = append(result, c)
	}
	return result, rows.Err()
}
func (s *Store) RecoverCommands(ctx context.Context) error {
	commands, e := s.Outstanding(ctx)
	if e != nil {
		return e
	}
	for _, c := range commands {
		if e = s.CommandStatus(ctx, c, "uncertain", "Runtime restarted after a dispatch decision. The command will not be sent again.", nil); e != nil {
			return e
		}
	}
	return nil
}
func (s *Store) SavedDevices(ctx context.Context) (map[string]devices.DeviceState, error) {
	rows, e := s.Pool.Query(ctx, "SELECT device_uuid::text,organization_uuid::text,generation,definition,review_required FROM device_runtime.devices")
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	result := map[string]devices.DeviceState{}
	for rows.Next() {
		var d devices.DeviceState
		var raw []byte
		if e = rows.Scan(&d.UUID, &d.OrganizationUUID, &d.Generation, &raw, &d.ReviewRequired); e != nil {
			return nil, e
		}
		if len(raw) > 0 {
			var definition devices.Definition
			if e = Decode(raw, &definition); e != nil {
				return nil, e
			}
			d.Applied = &definition
		}
		result[d.UUID] = d
	}
	return result, rows.Err()
}

// Failed requests advance the fence while preserving the previous working definition.
func (s *Store) FailTransition(ctx context.Context, d devices.Definition, generation int, operation, diagnostic string) error {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	payload := map[string]any{"device_uuid": d.DeviceUUID, "organization_uuid": d.OrganizationUUID, "generation": generation, "configuration_uuid": d.ConfigurationUUID, "diagnostic": diagnostic}
	if operation != "" {
		payload["operation_uuid"] = operation
	}
	outcome, _ := json.Marshal(map[string]any{"type": "device.failed.v1", "payload": payload})
	tag, err := tx.Exec(ctx, "INSERT INTO device_runtime.devices(device_uuid,organization_uuid,generation,outcome) VALUES($1,$2,$3,$4) ON CONFLICT(device_uuid) DO UPDATE SET generation=excluded.generation,outcome=excluded.outcome,updated_at=now() WHERE device_runtime.devices.generation<excluded.generation", d.DeviceUUID, d.OrganizationUUID, generation, outcome)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return tx.Commit(ctx)
	}
	if err = event(ctx, tx, "device.failed.v1", payload); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
func (s *Store) ReplayOutcome(ctx context.Context, device string, generation int) error {
	var raw []byte
	// Legacy rows predate saved outcomes. Their durable generation and definition
	// are confirmation evidence; startup has already restored their cache gates.
	if err := s.Pool.QueryRow(ctx, `UPDATE device_runtime.devices SET outcome=COALESCE(outcome,
	 jsonb_build_object('type',CASE WHEN definition IS NULL THEN 'device.deactivated.v1' ELSE 'device.applied.v1' END,
	 'payload',jsonb_build_object('device_uuid',device_uuid,'organization_uuid',organization_uuid,'generation',generation,
	 'configuration_uuid',definition->>'configuration_uuid','presence','unknown')))
	 WHERE device_uuid=$1 AND generation=$2 RETURNING outcome`, device, generation).Scan(&raw); err != nil {
		return err
	}
	if len(raw) == 0 {
		return nil
	}
	var outcome struct {
		Type    string         `json:"type"`
		Payload map[string]any `json:"payload"`
	}
	if err := Decode(raw, &outcome); err != nil {
		return err
	}
	return s.Emit(ctx, outcome.Type, outcome.Payload)
}
