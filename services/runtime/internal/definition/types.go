package definition

const (
	CompileRequestSchema   = "iot.definition-compile-request.v1"
	CompileResultSchema    = "iot.definition-preview.v1"
	ProfileAuthoringSchema = "iot.device-profile.authoring.v1"
	BindingAuthoringSchema = "iot.native-mqtt-binding.authoring.v1"
	GatewayAuthoringSchema = "iot.gateway.authoring.v1"
	RouteAuthoringSchema   = "iot.gateway-route.authoring.v1"
	ProfileArtifactSchema  = "iot.device-profile.v1"
	BindingArtifactSchema  = "iot.native-mqtt-binding.v1"
	RuntimeBundleSchema    = "iot.runtime-bundle.v1"

	compilerName    = "iot-os-definition-compiler"
	compilerVersion = "1.0.0"
	celEnvironment  = "cel-go-v0.26-restricted-v1"
	jsonPathVersion = "ojg-v1-restricted-v1"
	unitRegistry    = "ucum-essence-2026"

	maximumFixtures    = 256
	maximumRecords     = 100
	maximumCELCost     = 10_000
	maximumOutputBytes = 64 * 1024
)

type CompileRequest struct {
	Schema           string               `json:"schema"`
	OrganizationUUID string               `json:"organization_uuid"`
	Profile          ProfileDocument      `json:"profile"`
	Binding          BindingDocument      `json:"binding"`
	Gateway          GatewayDocument      `json:"gateway"`
	Route            GatewayRouteDocument `json:"route"`
	Fixtures         []Fixture            `json:"fixtures"`
}

type Fixture struct {
	Name                    string                   `json:"name"`
	Kind                    string                   `json:"kind"`
	Channel                 string                   `json:"channel"`
	Topic                   string                   `json:"topic"`
	Payload                 any                      `json:"payload"`
	CommandInput            map[string]any           `json:"command_input,omitempty"`
	ExpectedParameterValues []ExpectedParameterValue `json:"expected_parameter_values,omitempty"`
}

type ExpectedParameterValue struct {
	ParameterUUID string `json:"parameter_uuid"`
	Value         any    `json:"value"`
}

type CompileResult struct {
	Schema          string           `json:"schema"`
	Valid           bool             `json:"valid"`
	InputHash       string           `json:"input_hash"`
	Compiler        CompilerMetadata `json:"compiler"`
	Diagnostics     []Diagnostic     `json:"diagnostics"`
	ArtifactHashes  ArtifactHashes   `json:"artifact_hashes"`
	ProfileArtifact *ProfileArtifact `json:"profile_artifact,omitempty"`
	BindingArtifact *BindingArtifact `json:"binding_artifact,omitempty"`
	RuntimeBundle   *RuntimeBundle   `json:"runtime_bundle,omitempty"`
	Previews        []FixturePreview `json:"previews"`
}

type CompilerMetadata struct {
	Name            string `json:"name"`
	Version         string `json:"version"`
	CELEnvironment  string `json:"cel_environment"`
	JSONPathVersion string `json:"jsonpath_version"`
	UnitRegistry    string `json:"unit_registry"`
}

type Diagnostic struct {
	Severity   string  `json:"severity"`
	Code       string  `json:"code"`
	Path       string  `json:"path"`
	Message    string  `json:"message"`
	Suggestion *string `json:"suggestion,omitempty"`
}

type ArtifactHashes struct {
	Profile       *string `json:"profile"`
	Binding       *string `json:"binding"`
	RuntimeBundle *string `json:"runtime_bundle"`
}

type FixturePreview struct {
	Name           string         `json:"name"`
	Accepted       bool           `json:"accepted"`
	Values         []PreviewValue `json:"values"`
	EncodedPayload any            `json:"encoded_payload,omitempty"`
	Diagnostics    []Diagnostic   `json:"diagnostics"`
}

type PreviewValue struct {
	ParameterUUID string  `json:"parameter_uuid"`
	ValueType     string  `json:"value_type"`
	Value         any     `json:"value"`
	Quality       Quality `json:"quality"`
}

type Quality struct {
	Status string   `json:"status"`
	Codes  []string `json:"codes"`
}

type ProfileDocument struct {
	Schema  string         `json:"schema"`
	Profile Profile        `json:"profile"`
	Version ProfileVersion `json:"version"`
}

type Profile struct {
	UUID        string  `json:"uuid"`
	Key         string  `json:"key"`
	Name        string  `json:"name"`
	Description *string `json:"description,omitempty"`
}

type ProfileVersion struct {
	UUID              string             `json:"uuid"`
	Version           int                `json:"version"`
	Notes             *string            `json:"notes,omitempty"`
	Parameters        []Parameter        `json:"parameters"`
	DerivedParameters []DerivedParameter `json:"derived_parameters"`
	Properties        []Property         `json:"properties"`
	Events            []Event            `json:"events"`
	Commands          []Command          `json:"commands"`
}

type Parameter struct {
	UUID         string        `json:"uuid"`
	Key          string        `json:"key"`
	Label        string        `json:"label"`
	Description  *string       `json:"description,omitempty"`
	ValueSchema  ValueSchema   `json:"value_schema"`
	Presentation *Presentation `json:"presentation,omitempty"`
}

type DerivedParameter struct {
	UUID         string            `json:"uuid"`
	Key          string            `json:"key"`
	Label        string            `json:"label"`
	Description  *string           `json:"description,omitempty"`
	ValueSchema  ValueSchema       `json:"value_schema"`
	Expression   DerivedExpression `json:"expression"`
	Dependencies []string          `json:"dependencies"`
	Presentation *Presentation     `json:"presentation,omitempty"`
}

type DerivedExpression struct {
	Language string `json:"language"`
	Source   string `json:"source"`
}

type Property struct {
	UUID            string                   `json:"uuid"`
	Key             string                   `json:"key"`
	Label           string                   `json:"label"`
	Description     *string                  `json:"description,omitempty"`
	Scope           string                   `json:"scope"`
	ValueSchema     ValueSchema              `json:"value_schema"`
	Presentation    *Presentation            `json:"presentation,omitempty"`
	Acknowledgement *PropertyAcknowledgement `json:"acknowledgement,omitempty"`
}

type PropertyAcknowledgement struct {
	Required             bool    `json:"required"`
	ReportedPropertyUUID *string `json:"reported_property_uuid,omitempty"`
}

type Event struct {
	UUID                string       `json:"uuid"`
	Key                 string       `json:"key"`
	Label               string       `json:"label"`
	Description         *string      `json:"description,omitempty"`
	Mode                string       `json:"mode"`
	DefaultSeverity     string       `json:"default_severity"`
	DedupeWindowSeconds *int         `json:"dedupe_window_seconds,omitempty"`
	Fields              []EventField `json:"fields"`
}

type EventField struct {
	UUID         string        `json:"uuid"`
	Key          string        `json:"key"`
	Label        string        `json:"label"`
	Description  *string       `json:"description,omitempty"`
	ValueSchema  ValueSchema   `json:"value_schema"`
	Presentation *Presentation `json:"presentation,omitempty"`
}

type Command struct {
	UUID             string         `json:"uuid"`
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
	UUID         string        `json:"uuid"`
	Direction    string        `json:"direction"`
	Key          string        `json:"key"`
	Label        string        `json:"label"`
	Description  *string       `json:"description,omitempty"`
	Required     bool          `json:"required"`
	ValueSchema  ValueSchema   `json:"value_schema"`
	Presentation *Presentation `json:"presentation,omitempty"`
}

type ValueSchema struct {
	DataType     string           `json:"data_type"`
	UnitCode     *string          `json:"unit_code,omitempty"`
	Constraints  ValueConstraints `json:"constraints"`
	DefaultValue any              `json:"default_value,omitempty"`
}

type ValueConstraints struct {
	Minimum          *float64 `json:"minimum,omitempty"`
	Maximum          *float64 `json:"maximum,omitempty"`
	ExclusiveMinimum bool     `json:"exclusive_minimum,omitempty"`
	ExclusiveMaximum bool     `json:"exclusive_maximum,omitempty"`
	MultipleOf       *float64 `json:"multiple_of,omitempty"`
	MinLength        *int     `json:"min_length,omitempty"`
	MaxLength        *int     `json:"max_length,omitempty"`
	Pattern          *string  `json:"pattern,omitempty"`
	AllowedValues    []any    `json:"allowed_values,omitempty"`
}

type Presentation struct {
	Order     int                  `json:"order"`
	Precision *int                 `json:"precision,omitempty"`
	Input     *InputPresentation   `json:"input,omitempty"`
	Display   *DisplayPresentation `json:"display,omitempty"`
}

type InputPresentation struct {
	Widget      string  `json:"widget"`
	Placeholder *string `json:"placeholder,omitempty"`
}

type DisplayPresentation struct {
	Widget string `json:"widget"`
}

type BindingDocument struct {
	Schema  string         `json:"schema"`
	Binding Binding        `json:"binding"`
	Version BindingVersion `json:"version"`
}

type Binding struct {
	UUID        string  `json:"uuid"`
	ProfileUUID string  `json:"profile_uuid"`
	Key         string  `json:"key"`
	Name        string  `json:"name"`
	Description *string `json:"description,omitempty"`
	Transport   string  `json:"transport"`
}

type BindingVersion struct {
	UUID               string             `json:"uuid"`
	ProfileVersionUUID string             `json:"profile_version_uuid"`
	Version            int                `json:"version"`
	Notes              *string            `json:"notes,omitempty"`
	Channels           []Channel          `json:"channels"`
	ParameterMappings  []ParameterMapping `json:"parameter_mappings"`
	PropertyMappings   []PropertyMapping  `json:"property_mappings"`
	EventMappings      []EventMapping     `json:"event_mappings"`
	CommandMappings    []CommandMapping   `json:"command_mappings"`
}

type Channel struct {
	UUID          string   `json:"uuid"`
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
	ObservedAt *TimestampPath `json:"observed_at,omitempty"`
	MessageID  *PathRef       `json:"message_id,omitempty"`
	Sequence   *PathRef       `json:"sequence,omitempty"`
}

type TimestampPath struct {
	Path   PathRef `json:"path"`
	Format string  `json:"format"`
}

type PathRef struct {
	Scope    string `json:"scope"`
	JSONPath string `json:"json_path"`
}

type CalibrationOperation struct {
	Op         string   `json:"op"`
	Value      *float64 `json:"value,omitempty"`
	Exponent   *float64 `json:"exponent,omitempty"`
	Minimum    *float64 `json:"minimum,omitempty"`
	Maximum    *float64 `json:"maximum,omitempty"`
	Precision  *int     `json:"precision,omitempty"`
	Expression string   `json:"expression,omitempty"`
}

type ParameterMapping struct {
	UUID                string                 `json:"uuid"`
	Channel             string                 `json:"channel"`
	TargetParameterUUID string                 `json:"target_parameter_uuid"`
	Source              PathRef                `json:"source"`
	WireDataType        string                 `json:"wire_data_type"`
	Calibration         []CalibrationOperation `json:"calibration"`
	OnMissing           string                 `json:"on_missing"`
	OnInvalid           string                 `json:"on_invalid"`
	DefaultValue        any                    `json:"default_value,omitempty"`
}

type PropertyMapping struct {
	UUID               string                 `json:"uuid"`
	Channel            string                 `json:"channel"`
	TargetPropertyUUID string                 `json:"target_property_uuid"`
	Direction          string                 `json:"direction"`
	Source             PathRef                `json:"source"`
	WireDataType       string                 `json:"wire_data_type"`
	Operations         []CalibrationOperation `json:"operations"`
	OnMissing          string                 `json:"on_missing"`
	OnInvalid          string                 `json:"on_invalid"`
	DefaultValue       any                    `json:"default_value,omitempty"`
}

type EventMapping struct {
	UUID            string              `json:"uuid"`
	Channel         string              `json:"channel"`
	TargetEventUUID string              `json:"target_event_uuid"`
	Discriminator   *Discriminator      `json:"discriminator,omitempty"`
	EventID         *PathRef            `json:"event_id,omitempty"`
	State           *EventStateMapping  `json:"state,omitempty"`
	FieldMappings   []EventFieldMapping `json:"field_mappings"`
}

type Discriminator struct {
	Source PathRef `json:"source"`
	Equals any     `json:"equals"`
}

type EventStateMapping struct {
	Source        PathRef `json:"source"`
	ActiveValues  []any   `json:"active_values"`
	ClearedValues []any   `json:"cleared_values"`
}

type EventFieldMapping struct {
	TargetEventFieldUUID string                 `json:"target_event_field_uuid"`
	Source               PathRef                `json:"source"`
	WireDataType         string                 `json:"wire_data_type"`
	Operations           []CalibrationOperation `json:"operations"`
	OnMissing            string                 `json:"on_missing"`
	OnInvalid            string                 `json:"on_invalid"`
	DefaultValue         any                    `json:"default_value,omitempty"`
}

type CommandMapping struct {
	UUID              string                 `json:"uuid"`
	TargetCommandUUID string                 `json:"target_command_uuid"`
	RequestChannel    string                 `json:"request_channel"`
	ResponseChannel   *string                `json:"response_channel,omitempty"`
	RequestTemplate   map[string]any         `json:"request_template"`
	RequestEnvelope   CommandRequestEnvelope `json:"request_envelope"`
	Response          *CommandResponse       `json:"response,omitempty"`
	FieldMappings     []CommandFieldMapping  `json:"field_mappings"`
}

type CommandRequestEnvelope struct {
	CommandIDPath      string            `json:"command_id_path"`
	RequestedAtPath    *string           `json:"requested_at_path,omitempty"`
	ExpiresAtPath      *string           `json:"expires_at_path,omitempty"`
	RoutePathPath      *string           `json:"route_path_path,omitempty"`
	RouteVariablePaths map[string]string `json:"route_variable_paths,omitempty"`
}

type CommandResponse struct {
	Correlation PathRef              `json:"correlation"`
	Status      CommandStatusMapping `json:"status"`
}

type CommandStatusMapping struct {
	Path   PathRef             `json:"path"`
	Values CommandStatusValues `json:"values"`
}

type CommandStatusValues struct {
	Accepted  []any `json:"accepted,omitempty"`
	Running   []any `json:"running,omitempty"`
	Succeeded []any `json:"succeeded"`
	Failed    []any `json:"failed"`
}

type CommandFieldMapping struct {
	Direction              string                 `json:"direction"`
	TargetCommandFieldUUID string                 `json:"target_command_field_uuid"`
	JSONPath               string                 `json:"json_path"`
	WireDataType           string                 `json:"wire_data_type"`
	Operations             []CalibrationOperation `json:"operations"`
	OnMissing              string                 `json:"on_missing"`
	OnInvalid              string                 `json:"on_invalid"`
	DefaultValue           any                    `json:"default_value,omitempty"`
}

type GatewayDocument struct {
	Schema  string  `json:"schema"`
	Gateway Gateway `json:"gateway"`
}

type Gateway struct {
	UUID         string  `json:"uuid"`
	Key          string  `json:"key"`
	Name         string  `json:"name"`
	Description  *string `json:"description,omitempty"`
	MQTTClientID string  `json:"mqtt_client_id"`
}

type GatewayRouteDocument struct {
	Schema string       `json:"schema"`
	Route  GatewayRoute `json:"route"`
}

type GatewayRoute struct {
	UUID               string            `json:"uuid"`
	Revision           int               `json:"revision"`
	GatewayUUID        string            `json:"gateway_uuid"`
	DeviceUUID         string            `json:"device_uuid"`
	ProfileVersionUUID string            `json:"profile_version_uuid"`
	BindingVersionUUID string            `json:"binding_version_uuid"`
	RoutePath          string            `json:"route_path"`
	TopicVariables     map[string]string `json:"topic_variables"`
	InboundScopes      []InboundScope    `json:"inbound_scopes"`
	Enabled            bool              `json:"enabled"`
}

type InboundScope struct {
	Channel     string         `json:"channel"`
	PayloadPath string         `json:"payload_path"`
	Selector    *RouteSelector `json:"selector,omitempty"`
}

type RouteSelector struct {
	Source PathRef `json:"source"`
	Equals any     `json:"equals"`
}

type ProfileArtifact struct {
	Schema             string             `json:"schema"`
	ProfileUUID        string             `json:"profile_uuid"`
	ProfileKey         string             `json:"profile_key"`
	ProfileVersionUUID string             `json:"profile_version_uuid"`
	Version            int                `json:"version"`
	SourceHash         string             `json:"source_hash"`
	Compiler           CompilerMetadata   `json:"compiler"`
	Parameters         []Parameter        `json:"parameters"`
	DerivedParameters  []DerivedParameter `json:"derived_parameters"`
	Properties         []Property         `json:"properties"`
	Events             []Event            `json:"events"`
	Commands           []Command          `json:"commands"`
}

type BindingArtifact struct {
	Schema              string             `json:"schema"`
	BindingUUID         string             `json:"binding_uuid"`
	BindingKey          string             `json:"binding_key"`
	BindingVersionUUID  string             `json:"binding_version_uuid"`
	Version             int                `json:"version"`
	ProfileUUID         string             `json:"profile_uuid"`
	ProfileVersionUUID  string             `json:"profile_version_uuid"`
	ProfileArtifactHash string             `json:"profile_artifact_hash"`
	SourceHash          string             `json:"source_hash"`
	Compiler            CompilerMetadata   `json:"compiler"`
	Channels            []Channel          `json:"channels"`
	ParameterMappings   []ParameterMapping `json:"parameter_mappings"`
	PropertyMappings    []PropertyMapping  `json:"property_mappings"`
	EventMappings       []EventMapping     `json:"event_mappings"`
	CommandMappings     []CommandMapping   `json:"command_mappings"`
}

type RuntimeBundle struct {
	Schema              string              `json:"schema"`
	RuntimeBundleHash   string              `json:"runtime_bundle_hash,omitempty"`
	OrganizationUUID    string              `json:"organization_uuid"`
	GatewayUUID         string              `json:"gateway_uuid"`
	GatewayRouteUUID    string              `json:"gateway_route_uuid"`
	RouteRevision       int                 `json:"route_revision"`
	RoutePath           string              `json:"route_path"`
	DeviceUUID          string              `json:"device_uuid"`
	ProfileUUID         string              `json:"profile_uuid"`
	ProfileVersionUUID  string              `json:"profile_version_uuid"`
	BindingUUID         string              `json:"binding_uuid"`
	BindingVersionUUID  string              `json:"binding_version_uuid"`
	ProfileArtifactHash string              `json:"profile_artifact_hash"`
	BindingArtifactHash string              `json:"binding_artifact_hash"`
	RouteSourceHash     string              `json:"route_source_hash"`
	Compiler            CompilerMetadata    `json:"compiler"`
	Channels            []ResolvedChannel   `json:"channels"`
	ParameterPipelines  []ParameterPipeline `json:"parameter_pipelines"`
	DerivedPipelines    []DerivedPipeline   `json:"derived_pipelines"`
	CommandPipelines    []CommandPipeline   `json:"command_pipelines"`
}

type ResolvedChannel struct {
	ChannelUUID      string         `json:"channel_uuid"`
	Key              string         `json:"key"`
	Purpose          string         `json:"purpose"`
	Direction        string         `json:"direction"`
	Topic            string         `json:"topic"`
	QoS              int            `json:"qos"`
	Retain           bool           `json:"retain"`
	RecordPath       string         `json:"record_path"`
	MaxRecords       int            `json:"max_records"`
	Envelope         Envelope       `json:"envelope"`
	RoutePayloadPath string         `json:"route_payload_path,omitempty"`
	RouteSelector    *RouteSelector `json:"route_selector,omitempty"`
}

type ParameterPipeline struct {
	Mapping        ParameterMapping `json:"mapping"`
	TargetDataType string           `json:"target_data_type"`
}

type DerivedPipeline struct {
	ParameterUUID            string            `json:"parameter_uuid"`
	TargetDataType           string            `json:"target_data_type"`
	Expression               DerivedExpression `json:"expression"`
	DependencyParameterUUIDs []string          `json:"dependency_parameter_uuids"`
	EvaluationOrder          int               `json:"evaluation_order"`
}

type CommandPipeline struct {
	CommandUUID   string         `json:"command_uuid"`
	MappingUUID   string         `json:"mapping_uuid"`
	RequestTopic  string         `json:"request_topic"`
	ResponseTopic *string        `json:"response_topic,omitempty"`
	Mapping       CommandMapping `json:"mapping"`
}

type CommandInvocation struct {
	CommandID   string
	RequestedAt string
	ExpiresAt   string
	Inputs      map[string]any
}

type DecodedCommandResponse struct {
	CorrelationID string         `json:"correlation_id"`
	Status        string         `json:"status"`
	Terminal      bool           `json:"terminal"`
	Succeeded     bool           `json:"succeeded"`
	Outputs       map[string]any `json:"outputs"`
}
