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
			// Devices re-send buffered samples after reconnecting, under a new
			// telemetry UUID. A source-timestamped sample with the same observed
			// time and value is the same measurement. Source clocks are at most
			// five minutes ahead of receipt, which bounds the chunk scan.
			_, e = tx.Exec(ctx, `INSERT INTO device_runtime.observations(event_uuid,organization_uuid,device_uuid,configuration_uuid,parameter_uuid,received_at,observed_at,reading)
   SELECT $1,$2,$3,$4,$5,$6,$7,$8
   WHERE NOT $9::boolean OR NOT EXISTS (
     SELECT 1 FROM device_runtime.observations o
     WHERE o.organization_uuid=$2 AND o.device_uuid=$3 AND o.parameter_uuid=$5 AND o.observed_at=$7
       AND o.received_at>=$7::timestamptz-interval '5 minutes' AND o.reading->'value'=$8::jsonb->'value')
   ON CONFLICT DO NOTHING`, t.UUID, t.Definition.OrganizationUUID, t.Definition.DeviceUUID, t.Definition.ConfigurationUUID, reading.ParameterUUID, reading.ReceivedAt, reading.ObservedAt, raw, reading.TimestampSource == "source")
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

// CarriedReading is a parameter's newest latest value, possibly stored under an
// earlier configuration of the same device.
type CarriedReading struct {
	ConfigurationUUID string
	Reading           devices.Reading
}

// LatestAcross returns each parameter's newest value for the device, preferring
// the given configuration. Callers decide whether a value from an earlier
// configuration is still compatible.
func (s *Store) LatestAcross(ctx context.Context, org, device, configuration string) ([]CarriedReading, error) {
	rows, e := s.Pool.Query(ctx, `SELECT DISTINCT ON (parameter_uuid) configuration_uuid::text, reading
      FROM device_runtime.latest WHERE organization_uuid=$1 AND device_uuid=$2
      ORDER BY parameter_uuid, (configuration_uuid=$3) DESC, received_at DESC`, org, device, configuration)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	result := []CarriedReading{}
	for rows.Next() {
		var raw []byte
		var carried CarriedReading
		if e = rows.Scan(&carried.ConfigurationUUID, &raw); e != nil {
			return nil, e
		}
		if e = Decode(raw, &carried.Reading); e != nil {
			return nil, e
		}
		result = append(result, carried)
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
	// Configurations lists the revisions a merged series spans, oldest first.
	Configurations []ConfigurationSpan `json:"configurations,omitempty"`
}

type ConfigurationSpan struct {
	ConfigurationUUID string    `json:"configuration_uuid"`
	From              time.Time `json:"from"`
}

// HistoryOptions keeps the public SDK contract (receipt time, one series per
// configuration) as the default; the portal opts into reporting semantics.
type HistoryOptions struct {
	// ObservedTime selects and buckets by observed time, so buffered uploads
	// appear when they were measured.
	ObservedTime bool
	// MergeConfigurations joins configuration revisions that share a data type
	// and unit into one series and reports where each revision starts.
	MergeConfigurations bool
}

var ErrCounterUnitChanged = errors.New("The counter's unit changed in this range. Choose a range on one side of the change.")
var ErrHistoryTooBroad = errors.New("This range contains too many values or configuration changes. Choose a shorter range.")

func (s *Store) History(ctx context.Context, org, device, param string, from, to time.Time, maxPoints int, options HistoryOptions) ([]HistorySeries, error) {
	seconds := int64(math.Ceil(to.Sub(from).Seconds() / float64(maxPoints/2)))
	if seconds < 1 {
		seconds = 1
	}
	// Both clauses are constants. Source clocks are at most five minutes ahead
	// of receipt, which bounds the chunk scan for observed-time reads.
	at, window := "received_at", "received_at>=$4 AND received_at<=$5"
	if options.ObservedTime {
		at, window = "observed_at", "observed_at>=$4 AND observed_at<=$5 AND received_at>=$4::timestamptz-interval '5 minutes'"
	}
	configuration, group := "configuration_uuid::text", "configuration_uuid,"
	if options.MergeConfigurations {
		configuration, group = "''", ""
	}
	rows, e := s.Pool.Query(ctx, `
    SELECT * FROM (
      SELECT `+configuration+`, reading->>'unit' AS unit, reading->>'data_type' AS datatype,
        to_timestamp(floor(extract(epoch FROM `+at+`)/$6)*$6) AS at,
        to_jsonb(avg((reading->>'value')::numeric)) AS value,
        min((reading->>'value')::double precision), max((reading->>'value')::double precision), count(*)
      FROM device_runtime.observations
      WHERE organization_uuid=$1 AND device_uuid=$2 AND parameter_uuid=$3 AND `+window+`
        AND reading->>'data_type' IN ('integer','number')
      GROUP BY `+group+`reading->>'unit',reading->>'data_type',4
      UNION ALL
      SELECT configuration_uuid::text, reading->>'unit', reading->>'data_type', `+at+`,
        reading->'value', NULL::double precision, NULL::double precision, 1
      FROM device_runtime.observations
      WHERE organization_uuid=$1 AND device_uuid=$2 AND parameter_uuid=$3 AND `+window+`
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
		if options.MergeConfigurations {
			key = datatype
		}
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
		if config != "" {
			series[i].ConfigurationUUID = config
		}
		series[i].Points = append(series[i].Points, point)
	}
	if e = rows.Err(); e != nil || !options.MergeConfigurations || len(series) == 0 {
		return series, e
	}
	spans, e := s.configurationSpans(ctx, org, device, param, from, to, at, window)
	if e != nil {
		return nil, e
	}
	for i := range series {
		series[i].Configurations = spans
		if len(spans) > 0 {
			series[i].ConfigurationUUID = spans[len(spans)-1].ConfigurationUUID
		}
	}
	return series, nil
}

func (s *Store) configurationSpans(ctx context.Context, org, device, param string, from, to time.Time, at, window string) ([]ConfigurationSpan, error) {
	rows, e := s.Pool.Query(ctx, `SELECT configuration_uuid::text, min(`+at+`) FROM device_runtime.observations
      WHERE organization_uuid=$1 AND device_uuid=$2 AND parameter_uuid=$3 AND `+window+`
      GROUP BY 1 ORDER BY 2`, org, device, param, from, to)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	spans := []ConfigurationSpan{}
	for rows.Next() {
		var span ConfigurationSpan
		if e = rows.Scan(&span.ConfigurationUUID, &span.From); e != nil {
			return nil, e
		}
		spans = append(spans, span)
	}
	return spans, rows.Err()
}

type HistoryCursor struct {
	At        time.Time `json:"at"`
	EventUUID string    `json:"event_uuid"`
	Consumed  int       `json:"consumed"`
	Scope     string    `json:"scope"`
}

type HistoryRecord struct {
	InstallationUUID    string    `json:"installation_uuid,omitempty"`
	AdapterRevisionUUID string    `json:"adapter_revision_uuid,omitempty"`
	ManufacturerSerial  string    `json:"manufacturer_serial,omitempty"`
	TimestampSource     string    `json:"timestamp_source"`
	Historical          bool      `json:"historical"`
	EventUUID           string    `json:"event_uuid"`
	ConfigurationUUID   string    `json:"configuration_uuid"`
	ParameterUUID       string    `json:"parameter_uuid"`
	ReceivedAt          time.Time `json:"received_at"`
	ObservedAt          time.Time `json:"observed_at"`
	DataType            string    `json:"data_type"`
	Unit                *string   `json:"unit"`
	Value               any       `json:"value"`
	Quality             string    `json:"quality"`
	Diagnostic          string    `json:"diagnostic,omitempty"`
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
		record.InstallationUUID = reading.InstallationUUID
		record.AdapterRevisionUUID = reading.AdapterRevisionUUID
		record.ManufacturerSerial = reading.ManufacturerSerial
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
          SELECT event_uuid,configuration_uuid,observed_at,reading
          FROM device_runtime.observations
          WHERE organization_uuid=$1 AND device_uuid=$2 AND parameter_uuid=$3 AND observed_at<$4
          ORDER BY observed_at DESC,event_uuid DESC LIMIT 1
        ) carry
        UNION ALL
        SELECT event_uuid,configuration_uuid,observed_at,reading
        FROM device_runtime.observations
        WHERE organization_uuid=$1 AND device_uuid=$2 AND parameter_uuid=$3
          AND observed_at>=$4 AND observed_at<=$5 AND received_at>=$4::timestamptz-interval '5 minutes'
      ), ordered AS (
        SELECT event_uuid,configuration_uuid,observed_at,reading,
          row_number() OVER (ORDER BY observed_at,event_uuid) AS sequence,
          lag(reading->'value') OVER (ORDER BY observed_at,event_uuid) AS previous_value,
          lag(configuration_uuid) OVER (ORDER BY observed_at,event_uuid) AS previous_configuration,
          lag(COALESCE(reading->>'quality','')) OVER (ORDER BY observed_at,event_uuid) AS previous_quality,
          lag(COALESCE(reading->>'data_type','')) OVER (ORDER BY observed_at,event_uuid) AS previous_data_type
        FROM raw
      )
      SELECT configuration_uuid::text,observed_at,reading
      FROM ordered
      WHERE sequence=1
        OR reading->'value' IS DISTINCT FROM previous_value
        OR configuration_uuid IS DISTINCT FROM previous_configuration
        OR COALESCE(reading->>'quality','') IS DISTINCT FROM previous_quality
        OR COALESCE(reading->>'data_type','') IS DISTINCT FROM previous_data_type
      ORDER BY observed_at,event_uuid`, org, device, param, from, to)
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
	total, e := s.cleanupObservations(ctx, org, cutoff, batches)
	if e != nil {
		return total, e
	}
	var remaining bool
	for _, table := range []string{"diagnostics", "dag_evaluations"} {
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
	}
	for _, table := range []string{"observations", "diagnostics", "dag_evaluations"} {
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

// cleanupObservations deletes one day-chunk per batch. Compressed chunks do not
// expose row ctids, so each batch is a tenant and time predicate that Timescale
// applies to compressed batches directly.
func (s *Store) cleanupObservations(ctx context.Context, org string, cutoff time.Time, batches int) (int64, error) {
	// Emptied chunks stay until every tenant expires them, so only select
	// chunks that still hold this tenant's expired rows.
	rows, e := s.Pool.Query(ctx, `SELECT c.range_start,c.range_end FROM timescaledb_information.chunks c
      WHERE c.hypertable_schema='device_runtime' AND c.hypertable_name='observations' AND c.range_start<$2
        AND EXISTS (SELECT 1 FROM device_runtime.observations o WHERE o.organization_uuid=$1
          AND o.received_at>=c.range_start AND o.received_at<LEAST(c.range_end,$2))
      ORDER BY c.range_start LIMIT $3`, org, cutoff, batches)
	if e != nil {
		return 0, e
	}
	type window struct{ from, to time.Time }
	windows := []window{}
	for rows.Next() {
		var w window
		if e = rows.Scan(&w.from, &w.to); e != nil {
			rows.Close()
			return 0, e
		}
		if w.to.After(cutoff) {
			w.to = cutoff
		}
		windows = append(windows, w)
	}
	rows.Close()
	if e = rows.Err(); e != nil {
		return 0, e
	}
	var total int64
	for _, w := range windows {
		deleted, e := s.deleteObservationWindow(ctx, org, w.from, w.to)
		if e != nil {
			return total, e
		}
		total += deleted
	}
	return total, nil
}

func (s *Store) deleteObservationWindow(ctx context.Context, org string, from, to time.Time) (int64, error) {
	tx, e := s.Pool.Begin(ctx)
	if e != nil {
		return 0, e
	}
	defer tx.Rollback(ctx)
	// Decompressing a day of one tenant can exceed the pool's 5 s statement
	// limit; the caller's two-minute context still bounds the pass.
	if _, e = tx.Exec(ctx, "SET LOCAL statement_timeout = '2min'"); e != nil {
		return 0, e
	}
	tag, e := tx.Exec(ctx, `DELETE FROM device_runtime.observations WHERE organization_uuid=$1 AND received_at>=$2 AND received_at<$3`, org, from, to)
	if e != nil {
		return 0, e
	}
	return tag.RowsAffected(), tx.Commit(ctx)
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

// CounterBuckets maps the public bucket names to Timescale intervals.
var CounterBuckets = map[string]string{"15m": "15 minutes", "1h": "1 hour", "1d": "1 day", "1w": "7 days", "1mo": "1 month", "1y": "1 year"}

type IncreasePoint struct {
	At       time.Time `json:"at"`
	Increase float64   `json:"increase"`
	Samples  int64     `json:"samples"`
	Resets   int64     `json:"resets"`
	Partial  bool      `json:"partial"`
}

type CounterIncrease struct {
	From     time.Time       `json:"from"`
	To       time.Time       `json:"to"`
	Bucket   string          `json:"bucket"`
	Timezone string          `json:"timezone"`
	Unit     *string         `json:"unit"`
	Points   []IncreasePoint `json:"points"`
}

// CounterIncrease returns consumption per calendar bucket, ordered by observed
// time. A decrease is a rollover when wrapping at rolloverAt implies using at
// most half of the meter's range; otherwise it is a reset counted from zero. The delta across a unit change is
// not counted. Buckets start in the given IANA time zone; the increase between
// two samples belongs to the bucket of the later sample.
func (s *Store) CounterIncrease(ctx context.Context, org, device, param string, from, to time.Time, bucket string, location *time.Location, rolloverAt *float64) (CounterIncrease, error) {
	interval, ok := CounterBuckets[bucket]
	if !ok {
		return CounterIncrease{}, errors.New("unsupported bucket")
	}
	rows, err := s.Pool.Query(ctx, `
      WITH raw AS (
        SELECT * FROM (
          SELECT observed_at,event_uuid,reading->>'unit' AS unit,(reading->>'value')::double precision AS v
          FROM device_runtime.observations
          WHERE organization_uuid=$1 AND device_uuid=$2 AND parameter_uuid=$3 AND observed_at<$4
            AND reading->>'data_type' IN ('integer','number')
          ORDER BY observed_at DESC,event_uuid DESC LIMIT 1
        ) carry
        UNION ALL
        SELECT observed_at,event_uuid,reading->>'unit',(reading->>'value')::double precision
        FROM device_runtime.observations
        WHERE organization_uuid=$1 AND device_uuid=$2 AND parameter_uuid=$3
          AND observed_at>=$4 AND observed_at<$5 AND received_at>=$4::timestamptz-interval '5 minutes'
          AND reading->>'data_type' IN ('integer','number')
      ), ordered AS (
        SELECT observed_at,v,unit,lag(v) OVER w AS previous,lag(unit) OVER w AS previous_unit
        FROM raw WINDOW w AS (ORDER BY observed_at,event_uuid)
      ), deltas AS (
        SELECT observed_at,unit,
          CASE WHEN previous IS NULL OR unit IS DISTINCT FROM previous_unit THEN 0
               WHEN v>=previous THEN v-previous
               WHEN $8::double precision>previous AND $8::double precision-previous+v<=$8::double precision/2 THEN $8::double precision-previous+v
               ELSE v END AS increase,
          (previous IS NOT NULL AND unit IS NOT DISTINCT FROM previous_unit AND v<previous) AS reset
        FROM ordered WHERE observed_at>=$4
      )
      SELECT time_bucket($6::interval,observed_at,$7) AS at,sum(increase),count(*),count(*) FILTER (WHERE reset),unit
      FROM deltas GROUP BY 1,unit ORDER BY 1 LIMIT 2001`, org, device, param, from, to, interval, location.String(), rolloverAt)
	if err != nil {
		return CounterIncrease{}, err
	}
	defer rows.Close()
	result := CounterIncrease{From: from, To: to, Bucket: bucket, Timezone: location.String(), Points: []IncreasePoint{}}
	for rows.Next() {
		var point IncreasePoint
		var unit *string
		if err = rows.Scan(&point.At, &point.Increase, &point.Samples, &point.Resets, &unit); err != nil {
			return CounterIncrease{}, err
		}
		if len(result.Points) == 2000 {
			return CounterIncrease{}, ErrHistoryTooBroad
		}
		if len(result.Points) > 0 && (unit == nil) != (result.Unit == nil) || unit != nil && result.Unit != nil && *unit != *result.Unit {
			return CounterIncrease{}, ErrCounterUnitChanged
		}
		result.Unit = unit
		point.At = point.At.In(location)
		point.Partial = point.At.Before(from) || BucketEnd(point.At, bucket).After(to)
		result.Points = append(result.Points, point)
	}
	return result, rows.Err()
}

// BucketEnd returns the start of the bucket after start, in start's location.
func BucketEnd(start time.Time, bucket string) time.Time {
	switch bucket {
	case "15m":
		return start.Add(15 * time.Minute)
	case "1h":
		return start.Add(time.Hour)
	case "1d":
		return start.AddDate(0, 0, 1)
	case "1w":
		return start.AddDate(0, 0, 7)
	case "1mo":
		return start.AddDate(0, 1, 0)
	default:
		return start.AddDate(1, 0, 0)
	}
}
