package definition

import (
	"encoding/json"
)

const (
	CompileRequestSchema = "iot.definition-compile-request.v1"
	CompileResultSchema  = "iot.definition-preview.v1"

	compilerName       = "iot-definition-compiler"
	compilerVersion    = "1.0.0"
	celEnvironment     = "cel-go-v0.26-restricted-v1"
	jsonPathVersion    = "ojg-v1-restricted-v1"
	unitRegistry       = "ucum-v1"
	maximumFixtures    = 256
	maximumRecords     = 100
	maximumCELCost     = 10_000
	maximumOutputBytes = 64 * 1024
)

type CompileRequest struct {
	Schema   string          `json:"schema"`
	Profile  json.RawMessage `json:"profile"`
	Binding  json.RawMessage `json:"binding"`
	Fixtures []Fixture       `json:"fixtures"`
}

type Fixture struct {
	Name     string `json:"name"`
	Kind     string `json:"kind"`
	Input    any    `json:"input"`
	Expected any    `json:"expected,omitempty"`
}

type CompileResult struct {
	Schema          string           `json:"schema"`
	Valid           bool             `json:"valid"`
	InputHash       string           `json:"input_hash"`
	Compiler        CompilerMetadata `json:"compiler"`
	Diagnostics     []Diagnostic     `json:"diagnostics"`
	ProfileArtifact map[string]any   `json:"profile_artifact"`
	BindingArtifact map[string]any   `json:"binding_artifact"`
	ArtifactHashes  ArtifactHashes   `json:"artifact_hashes"`
	Previews        []FixturePreview `json:"previews"`
}

type CompilerMetadata struct {
	Name            string `json:"name"`
	Version         string `json:"version"`
	CELEnvironment  string `json:"cel_environment"`
	JSONPathVersion string `json:"jsonpath_version"`
	UnitRegistry    string `json:"unit_registry"`
}

type ArtifactHashes struct {
	Profile *string `json:"profile"`
	Binding *string `json:"binding"`
}

type Diagnostic struct {
	Severity   string  `json:"severity"`
	Code       string  `json:"code"`
	Path       string  `json:"path"`
	Message    string  `json:"message"`
	Suggestion *string `json:"suggestion,omitempty"`
}

type FixturePreview struct {
	Name      string         `json:"name"`
	Kind      string         `json:"kind"`
	Valid     bool           `json:"valid"`
	Source    any            `json:"source"`
	Canonical any            `json:"canonical,omitempty"`
	Generated any            `json:"generated,omitempty"`
	Stages    []PreviewStage `json:"stages"`
}

type PreviewStage struct {
	Stage          string  `json:"stage"`
	Status         string  `json:"status"`
	Target         *string `json:"target,omitempty"`
	Raw            any     `json:"raw,omitempty"`
	Result         any     `json:"result,omitempty"`
	DiagnosticCode *string `json:"diagnostic_code,omitempty"`
}

type ProfileDocument struct {
	Schema  string          `json:"schema"`
	Profile ProfileIdentity `json:"profile"`
	Version ProfileVersion  `json:"version"`
}

type ProfileIdentity struct {
	UUID        string  `json:"uuid,omitempty"`
	Key         string  `json:"key"`
	Name        string  `json:"name"`
	Description *string `json:"description,omitempty"`
}

type ProfileVersion struct {
	UUID       string      `json:"uuid,omitempty"`
	Version    int         `json:"version"`
	Notes      *string     `json:"notes,omitempty"`
	Components []Component `json:"components"`
}

type Component struct {
	UUID        string      `json:"uuid,omitempty"`
	Key         *string     `json:"key"`
	Name        string      `json:"name"`
	Description *string     `json:"description,omitempty"`
	Telemetry   []Telemetry `json:"telemetry"`
	Properties  []Property  `json:"properties"`
	Events      []Event     `json:"events"`
	Commands    []Command   `json:"commands"`
}

type Telemetry struct {
	UUID        string      `json:"uuid,omitempty"`
	Key         string      `json:"key"`
	Label       string      `json:"label"`
	Description *string     `json:"description,omitempty"`
	ValueSchema ValueSchema `json:"value_schema"`
	Derivation  *Derivation `json:"derivation,omitempty"`
}

type Derivation struct {
	CEL          string   `json:"cel"`
	Dependencies []string `json:"dependencies"`
}

type Property struct {
	UUID            string           `json:"uuid,omitempty"`
	Key             string           `json:"key"`
	Label           string           `json:"label"`
	Description     *string          `json:"description,omitempty"`
	Scope           string           `json:"scope"`
	ValueSchema     ValueSchema      `json:"value_schema"`
	Acknowledgement *Acknowledgement `json:"acknowledgement,omitempty"`
}

type Acknowledgement struct {
	Required            bool    `json:"required"`
	ReportedPropertyKey *string `json:"reported_property_key,omitempty"`
}

type Event struct {
	UUID                string       `json:"uuid,omitempty"`
	Key                 string       `json:"key"`
	Label               string       `json:"label"`
	Description         *string      `json:"description,omitempty"`
	Mode                string       `json:"mode"`
	DefaultSeverity     string       `json:"default_severity"`
	DedupeWindowSeconds *int         `json:"dedupe_window_seconds,omitempty"`
	Fields              []EventField `json:"fields"`
}

type EventField struct {
	UUID        string      `json:"uuid,omitempty"`
	Key         string      `json:"key"`
	Label       string      `json:"label"`
	Description *string     `json:"description,omitempty"`
	ValueSchema ValueSchema `json:"value_schema"`
}

type Command struct {
	UUID             string         `json:"uuid,omitempty"`
	Key              string         `json:"key"`
	Label            string         `json:"label"`
	Description      *string        `json:"description,omitempty"`
	Mode             string         `json:"mode"`
	Risk             string         `json:"risk"`
	ConfirmationText *string        `json:"confirmation_text,omitempty"`
	TimeoutSeconds   int            `json:"timeout_seconds"`
	OfflinePolicy    string         `json:"offline_policy"`
	Idempotent       bool           `json:"idempotent"`
	MaxAttempts      int            `json:"max_attempts"`
	Fields           []CommandField `json:"fields"`
}

type CommandField struct {
	UUID        string      `json:"uuid,omitempty"`
	Direction   string      `json:"direction"`
	Key         string      `json:"key"`
	Label       string      `json:"label"`
	Description *string     `json:"description,omitempty"`
	ValueSchema ValueSchema `json:"value_schema"`
}

type ValueSchema struct {
	DataType     string           `json:"data_type"`
	UnitCode     *string          `json:"unit_code,omitempty"`
	Required     bool             `json:"required"`
	Critical     bool             `json:"critical"`
	Constraints  ValueConstraints `json:"constraints"`
	DefaultValue any              `json:"default_value,omitempty"`
	Display      DisplayMetadata  `json:"display"`
}

type ValueConstraints struct {
	Minimum          *float64 `json:"minimum,omitempty"`
	Maximum          *float64 `json:"maximum,omitempty"`
	ExclusiveMinimum bool     `json:"exclusive_minimum,omitempty"`
	ExclusiveMaximum bool     `json:"exclusive_maximum,omitempty"`
	MultipleOf       *float64 `json:"multiple_of,omitempty"`
	MinLength        *int     `json:"min_length,omitempty"`
	MaxLength        *int     `json:"max_length,omitempty"`
	Pattern          string   `json:"pattern,omitempty"`
	AllowedValues    []any    `json:"allowed_values,omitempty"`
}

type DisplayMetadata struct {
	Order     int  `json:"order"`
	Precision *int `json:"precision,omitempty"`
}

type BindingDocument struct {
	Schema  string          `json:"schema"`
	Binding BindingIdentity `json:"binding"`
	Version BindingVersion  `json:"version"`
}

type BindingIdentity struct {
	UUID        string  `json:"uuid,omitempty"`
	ProfileUUID string  `json:"profile_uuid"`
	Key         string  `json:"key"`
	Name        string  `json:"name"`
	Description *string `json:"description,omitempty"`
	Transport   string  `json:"transport"`
}

type BindingVersion struct {
	UUID               string             `json:"uuid,omitempty"`
	ProfileVersionUUID string             `json:"profile_version_uuid"`
	Version            int                `json:"version"`
	Notes              *string            `json:"notes,omitempty"`
	Channels           []Channel          `json:"channels"`
	TelemetryMappings  []TelemetryMapping `json:"telemetry_mappings"`
	PropertyMappings   []PropertyMapping  `json:"property_mappings"`
	EventMappings      []EventMapping     `json:"event_mappings"`
	CommandMappings    []CommandMapping   `json:"command_mappings"`
}

type Channel struct {
	UUID          string   `json:"uuid,omitempty"`
	Key           string   `json:"key"`
	Label         string   `json:"label"`
	Purpose       string   `json:"purpose"`
	Direction     string   `json:"direction"`
	TopicTemplate string   `json:"topic_template"`
	QoS           int      `json:"qos"`
	Retain        bool     `json:"retain"`
	ContentType   string   `json:"content_type"`
	RecordPath    string   `json:"record_path"`
	MaxRecords    int      `json:"max_records"`
	Envelope      Envelope `json:"envelope"`
}

type Envelope struct {
	DeviceID   *PathRef           `json:"device_id,omitempty"`
	ObservedAt *ObservedAtMapping `json:"observed_at,omitempty"`
	MessageID  *PathRef           `json:"message_id,omitempty"`
}

type ObservedAtMapping struct {
	Path   PathRef `json:"path"`
	Format string  `json:"format"`
}

type PathRef struct {
	Scope    string `json:"scope"`
	JSONPath string `json:"json_path"`
}

type Transform struct {
	Preset string `json:"preset,omitempty"`
	CEL    string `json:"cel,omitempty"`
}

type TelemetryMapping struct {
	UUID          string     `json:"uuid,omitempty"`
	Channel       string     `json:"channel"`
	Target        string     `json:"target"`
	Source        PathRef    `json:"source"`
	WireDataType  string     `json:"wire_data_type"`
	Transform     *Transform `json:"transform,omitempty"`
	MissingPolicy string     `json:"missing_policy"`
	DefaultValue  any        `json:"default_value,omitempty"`
}

type PropertyMapping struct {
	UUID          string     `json:"uuid,omitempty"`
	Channel       string     `json:"channel"`
	Target        string     `json:"target"`
	Direction     string     `json:"direction"`
	JSONPath      string     `json:"json_path"`
	SourceScope   string     `json:"source_scope,omitempty"`
	WireDataType  string     `json:"wire_data_type"`
	Transform     *Transform `json:"transform,omitempty"`
	MissingPolicy string     `json:"missing_policy"`
	DefaultValue  any        `json:"default_value,omitempty"`
}

type Discriminator struct {
	Path   PathRef `json:"path"`
	Equals any     `json:"equals"`
}

type EventMapping struct {
	UUID          string              `json:"uuid,omitempty"`
	Channel       string              `json:"channel"`
	Target        string              `json:"target"`
	Discriminator *Discriminator      `json:"discriminator,omitempty"`
	EventID       *PathRef            `json:"event_id,omitempty"`
	State         *EventStateMapping  `json:"state,omitempty"`
	FieldMappings []EventFieldMapping `json:"field_mappings"`
}

type EventStateMapping struct {
	Path      PathRef    `json:"path"`
	Transform *Transform `json:"transform,omitempty"`
}

type EventFieldMapping struct {
	Target        string     `json:"target"`
	Source        PathRef    `json:"source"`
	WireDataType  string     `json:"wire_data_type"`
	Transform     *Transform `json:"transform,omitempty"`
	MissingPolicy string     `json:"missing_policy"`
	DefaultValue  any        `json:"default_value,omitempty"`
}

type CommandMapping struct {
	UUID            string                 `json:"uuid,omitempty"`
	Target          string                 `json:"target"`
	RequestChannel  string                 `json:"request_channel"`
	ResponseChannel *string                `json:"response_channel,omitempty"`
	RequestTemplate map[string]any         `json:"request_template"`
	RequestEnvelope CommandRequestEnvelope `json:"request_envelope"`
	Response        *CommandResponse       `json:"response,omitempty"`
	FieldMappings   []CommandFieldMapping  `json:"field_mappings"`
}

type CommandRequestEnvelope struct {
	CommandIDPath   string `json:"command_id_path"`
	DeviceIDPath    string `json:"device_id_path,omitempty"`
	RequestedAtPath string `json:"requested_at_path,omitempty"`
	ExpiresAtPath   string `json:"expires_at_path,omitempty"`
}

type CommandResponse struct {
	Correlation PathRef       `json:"correlation"`
	Status      StatusMapping `json:"status"`
}

type StatusMapping struct {
	Path      PathRef      `json:"path"`
	Transform *Transform   `json:"transform,omitempty"`
	Values    StatusValues `json:"values"`
}

type StatusValues struct {
	Accepted  []string `json:"accepted,omitempty"`
	Running   []string `json:"running,omitempty"`
	Succeeded []string `json:"succeeded"`
	Failed    []string `json:"failed"`
}

type CommandFieldMapping struct {
	Direction     string     `json:"direction"`
	Target        string     `json:"target"`
	JSONPath      string     `json:"json_path"`
	WireDataType  string     `json:"wire_data_type"`
	Transform     *Transform `json:"transform,omitempty"`
	MissingPolicy string     `json:"missing_policy"`
	DefaultValue  any        `json:"default_value,omitempty"`
}

type capabilityKind string

const (
	capabilityTelemetry capabilityKind = "telemetry"
	capabilityProperty  capabilityKind = "property"
	capabilityEvent     capabilityKind = "event"
	capabilityCommand   capabilityKind = "command"
)

type capability struct {
	Kind          capabilityKind
	QualifiedKey  string
	ValueSchema   *ValueSchema
	PropertyScope string
	Event         *Event
	Command       *Command
	ComponentKey  *string
}

type semanticCatalog struct {
	Capabilities map[string]capability
	Telemetry    map[string]capability
	Properties   map[string]capability
	Events       map[string]capability
	Commands     map[string]capability
	Derivations  []string
}

func metadata() CompilerMetadata {
	return CompilerMetadata{
		Name:            compilerName,
		Version:         compilerVersion,
		CELEnvironment:  celEnvironment,
		JSONPathVersion: jsonPathVersion,
		UnitRegistry:    unitRegistry,
	}
}
