package devices

import "time"

const CommittedTelemetryVersion = "telemetry.committed.v1"
const CommittedTelemetrySubject = "iot.committed.telemetry.v1"
const CommittedTelemetryStream = "IOT_COMMITTED_TELEMETRY"

// CommittedReading is an explicit projection, never a serialization of a device
// definition or of the retained last-valid value used by the latest-value UI.
type CommittedReading struct {
	ParameterUUID   string    `json:"parameter_uuid"`
	Key             string    `json:"key"`
	DataType        string    `json:"data_type"`
	Unit            *string   `json:"unit"`
	Value           any       `json:"value"`
	Quality         string    `json:"quality"`
	Diagnostic      string    `json:"diagnostic,omitempty"`
	ObservedAt      time.Time `json:"observed_at"`
	TimestampSource string    `json:"timestamp_source,omitempty"`
	ReceivedAt      time.Time `json:"received_at"`
	Historical      bool      `json:"historical"`
}

type CommittedTelemetry struct {
	SchemaVersion     string             `json:"schema_version"`
	EventID           string             `json:"event_id"`
	TelemetryID       string             `json:"telemetry_id"`
	Sequence          string             `json:"sequence"` // decimal string: safe for JavaScript clients
	OrganizationUUID  string             `json:"organization_uuid"`
	DeviceUUID        string             `json:"device_uuid"`
	ConfigurationUUID string             `json:"configuration_uuid"`
	Generation        int                `json:"generation"`
	Readings          []CommittedReading `json:"readings"`
}

func ProjectCommitted(t Telemetry) CommittedTelemetry {
	event := CommittedTelemetry{
		SchemaVersion: CommittedTelemetryVersion, EventID: t.UUID, TelemetryID: t.UUID,
		OrganizationUUID: t.Definition.OrganizationUUID, DeviceUUID: t.Definition.DeviceUUID,
		ConfigurationUUID: t.Definition.ConfigurationUUID, Generation: t.Generation,
		Readings: make([]CommittedReading, 0, len(t.Readings)),
	}
	for _, r := range t.Readings {
		event.Readings = append(event.Readings, CommittedReading{
			ParameterUUID: r.ParameterUUID, Key: r.Key, DataType: r.DataType, Unit: r.Unit,
			Value: r.Value, Quality: r.Quality, Diagnostic: r.Diagnostic,
			ObservedAt: r.ObservedAt, ReceivedAt: r.ReceivedAt, Historical: r.Historical, TimestampSource: r.TimestampSource,
		})
	}
	return event
}
