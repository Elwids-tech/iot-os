package devices

import (
	"strconv"
	"time"
)

// The events of the application telemetry stream (spec 030, ADR-032): the runtime
// produces open, reading and reset on GET /internal/telemetry/stream; Laravel relays
// them and writes closed when it ends a relay for a reason of its own. Contracts:
// contracts/events/v1/telemetry-stream*.schema.json.
const (
	StreamReadingVersion = "telemetry-stream.v1"
	StreamOpenVersion    = "telemetry-stream-open.v1"
	StreamResetVersion   = "telemetry-stream-reset.v1"
	StreamClosedVersion  = "telemetry-stream-closed.v1"
)

// StreamItem is one reading as an application sees it: the committed reading without
// its provenance, diagnostic and timestamp source.
type StreamItem struct {
	ParameterUUID string    `json:"parameter_uuid"`
	Key           string    `json:"key"`
	DataType      string    `json:"data_type"`
	Unit          *string   `json:"unit"`
	Value         any       `json:"value"`
	Quality       string    `json:"quality"`
	ObservedAt    time.Time `json:"observed_at"`
	ReceivedAt    time.Time `json:"received_at"`
	Historical    bool      `json:"historical"`
}

// StreamReading is the SSE `reading` event: one committed event of one granted device.
// Position is the committed outbox sequence as a decimal string and equals the SSE id.
type StreamReading struct {
	SchemaVersion     string       `json:"schema_version"`
	Position          string       `json:"position"`
	EventID           string       `json:"event_id"`
	DeviceUUID        string       `json:"device_uuid"`
	ConfigurationUUID string       `json:"configuration_uuid"`
	Generation        int          `json:"generation"`
	Readings          []StreamItem `json:"readings"`
}

// StreamOpen is sent once, first: where the stream starts and how many devices it carries.
type StreamOpen struct {
	SchemaVersion string    `json:"schema_version"`
	Position      string    `json:"position"`
	Devices       int       `json:"devices"`
	OpenedAt      time.Time `json:"opened_at"`
}

// StreamReset tells the client its position is no longer retained; Position is the head.
type StreamReset struct {
	SchemaVersion string `json:"schema_version"`
	Position      string `json:"position"`
}

// StreamClosed is written by Laravel when it ends the relay; the runtime never sends it.
type StreamClosed struct {
	SchemaVersion string `json:"schema_version"`
	Reason        string `json:"reason"`
	Position      string `json:"position"`
}

// ProjectStream derives the stream event from a committed event and its outbox
// sequence, dropping telemetry_id, organization_uuid, installation_uuid,
// adapter_revision_uuid, manufacturer_serial, timestamp_source and diagnostic: the
// organization is the stream's, and the rest is internal to the platform.
func ProjectStream(event CommittedTelemetry, sequence int64) StreamReading {
	reading := StreamReading{
		SchemaVersion: StreamReadingVersion, Position: strconv.FormatInt(sequence, 10),
		EventID: event.EventID, DeviceUUID: event.DeviceUUID, ConfigurationUUID: event.ConfigurationUUID,
		Generation: event.Generation, Readings: make([]StreamItem, 0, len(event.Readings)),
	}
	for _, r := range event.Readings {
		reading.Readings = append(reading.Readings, StreamItem{
			ParameterUUID: r.ParameterUUID, Key: r.Key, DataType: r.DataType, Unit: r.Unit, Value: r.Value,
			Quality: r.Quality, ObservedAt: r.ObservedAt, ReceivedAt: r.ReceivedAt, Historical: r.Historical,
		})
	}
	return reading
}

// NewStreamOpen, NewStreamReset and NewStreamClosed build the control events with
// their schema versions, so a producer cannot forget one.
func NewStreamOpen(position string, devices int, openedAt time.Time) StreamOpen {
	return StreamOpen{SchemaVersion: StreamOpenVersion, Position: position, Devices: devices, OpenedAt: openedAt}
}

func NewStreamReset(position string) StreamReset {
	return StreamReset{SchemaVersion: StreamResetVersion, Position: position}
}

func NewStreamClosed(reason, position string) StreamClosed {
	return StreamClosed{SchemaVersion: StreamClosedVersion, Reason: reason, Position: position}
}
