package devices

import (
	"encoding/json"
	"time"
)

type Source struct {
	ConnectionUUID string `json:"connection_uuid"`
	CandidateUUID  string `json:"candidate_uuid"`
	GroupID        string `json:"group_id"`
	EdgeNodeID     string `json:"edge_node_id"`
	DeviceID       string `json:"device_id"`
}

func (s Source) Key() string { return s.ConnectionUUID + "/" + s.EdgeNodeID + "/" + s.DeviceID }

type Mapping struct {
	ConversionMode    string      `json:"conversion_mode,omitempty"`
	IngressConversion *Conversion `json:"ingress_conversion,omitempty"`
	ParameterUUID     string      `json:"parameter_uuid"`
	Metric            string      `json:"metric"`
	Datatype          string      `json:"datatype"`
	CommandMetric     *string     `json:"command_metric"`
	CommandDatatype   *string     `json:"command_datatype"`
}
type Definition struct {
	Adapter              *AdapterBinding `json:"adapter,omitempty"`
	SchemaVersion        string          `json:"schema_version"`
	ConfigurationUUID    string          `json:"configuration_uuid"`
	DeviceUUID           string          `json:"device_uuid"`
	OrganizationUUID     string          `json:"organization_uuid"`
	ProfileArtifactUUID  string          `json:"profile_artifact_uuid"`
	ProfileHash          string          `json:"profile_hash"`
	ProfileCanonicalJSON string          `json:"profile_canonical_json"`
	Source               Source          `json:"source"`
	BirthRevision        int             `json:"birth_revision"`
	Mappings             []Mapping       `json:"mappings"`
}

// AdapterBinding comes from platform enrollment, never from the vendor payload.
type AdapterBinding struct {
	InstallationUUID   string `json:"installation_uuid"`
	AdapterUUID        string `json:"adapter_uuid"`
	ManufacturerSerial string `json:"manufacturer_serial"`
}
type Parameter struct {
	IngressConversion *Conversion `json:"ingress_conversion,omitempty"`
	UUID              string      `json:"uuid"`
	Key               string      `json:"key"`
	Label             string      `json:"label"`
	Kind              string      `json:"kind"`
	DataType          string      `json:"data_type"`
	Unit              *string     `json:"unit"`
	Format            *string     `json:"format"`
	ReportsState      bool        `json:"reports_state"`
	AcceptsCommand    bool        `json:"accepts_command"`
	Validation        *struct {
		Rule    any    `json:"rule"`
		Message string `json:"message"`
	} `json:"validation"`
	Reporting *struct {
		StaleAfterSeconds int `json:"stale_after_seconds"`
	} `json:"reporting"`
	Counter *struct {
		Monotonic     bool   `json:"monotonic"`
		ResetBehavior string `json:"reset_behavior"`
	} `json:"counter"`
}
type Calculation struct {
	TargetParameterUUID string `json:"target_parameter_uuid"`
	Inputs              []struct {
		Alias         string `json:"alias"`
		ParameterUUID string `json:"parameter_uuid"`
	} `json:"inputs"`
	Expression any `json:"expression"`
}
type Profile struct {
	SchemaVersion string        `json:"schema_version"`
	Parameters    []Parameter   `json:"parameters"`
	Calculations  []Calculation `json:"calculations"`
}
type Metric struct {
	InstallationUUID    string     `json:"installation_uuid,omitempty"`
	AdapterRevisionUUID string     `json:"adapter_revision_uuid,omitempty"`
	Name                string     `json:"name"`
	Alias               *uint64    `json:"alias,omitempty"`
	Datatype            string     `json:"datatype"`
	Value               any        `json:"value"`
	Timestamp           *time.Time `json:"timestamp,omitempty"`
	ReceivedAt          time.Time  `json:"received_at,omitempty"`
	Historical          bool       `json:"historical,omitempty"`
	IsNull              bool       `json:"is_null,omitempty"`
	Diagnostic          string     `json:"diagnostic,omitempty"`
}
type Reading struct {
	InstallationUUID    string     `json:"installation_uuid,omitempty"`
	AdapterRevisionUUID string     `json:"adapter_revision_uuid,omitempty"`
	ManufacturerSerial  string     `json:"manufacturer_serial,omitempty"`
	ParameterUUID       string     `json:"parameter_uuid"`
	Key                 string     `json:"key"`
	Label               string     `json:"label"`
	DataType            string     `json:"data_type"`
	Unit                *string    `json:"unit"`
	Value               any        `json:"value"`
	Quality             string     `json:"quality"`
	Diagnostic          string     `json:"diagnostic,omitempty"`
	ObservedAt          time.Time  `json:"observed_at"`
	TimestampSource     string     `json:"timestamp_source,omitempty"`
	ReceivedAt          time.Time  `json:"received_at"`
	LastValidReceivedAt *time.Time `json:"last_valid_received_at,omitempty"`
	Historical          bool       `json:"historical"`
}
type Event struct {
	UUID       string          `json:"uuid"`
	Type       string          `json:"type"`
	Payload    json.RawMessage `json:"payload"`
	LeaseToken string          `json:"lease_token,omitempty"`
}
type Connection struct {
	UUID             string `json:"uuid"`
	OrganizationUUID string `json:"organization_uuid"`
	GroupID          string `json:"group_id"`
	HostID           string `json:"host_id"`
	Username         string `json:"username"`
	Password         string `json:"password"`
	BrokerURL        string `json:"broker_url"`
}
type DeviceState struct {
	OperationUUID    string      `json:"operation_uuid"`
	UUID             string      `json:"uuid"`
	OrganizationUUID string      `json:"organization_uuid"`
	Generation       int         `json:"generation"`
	Lifecycle        string      `json:"lifecycle"`
	DeploymentStatus string      `json:"deployment_status"`
	Desired          *Definition `json:"desired"`
	Applied          *Definition `json:"applied"`
	ReviewRequired   bool        `json:"review_required"`
}
type Retention struct {
	OrganizationUUID string `json:"organization_uuid"`
	Days             int    `json:"days"`
}
type ControlState struct {
	Connections []Connection  `json:"connections"`
	Devices     []DeviceState `json:"devices"`
	Retention   []Retention   `json:"retention"`
}
type Telemetry struct {
	CaptureID  string     `json:"capture_id,omitempty"`
	Generation int        `json:"generation"`
	UUID       string     `json:"uuid"`
	Definition Definition `json:"definition"`
	SessionID  string     `json:"session_id"`
	Readings   []Reading  `json:"readings"`
}
type Command struct {
	AutomationActionID string    `json:"automation_action_id,omitempty"`
	Generation         int       `json:"generation"`
	UUID               string    `json:"command_uuid"`
	OrganizationUUID   string    `json:"organization_uuid"`
	DeviceUUID         string    `json:"device_uuid"`
	ConfigurationUUID  string    `json:"configuration_uuid"`
	ParameterUUID      string    `json:"parameter_uuid"`
	Value              any       `json:"value"`
	SessionID          string    `json:"session_id"`
	ConfirmedAt        time.Time `json:"confirmed_at"`
	ExpiresAt          time.Time `json:"expires_at"`
}
