package definition

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"sort"
	"strings"
)

var (
	keyPattern          = regexp.MustCompile(`^[a-z][a-z0-9_]{0,99}$`)
	qualifiedKeyPattern = regexp.MustCompile(`^[a-z][a-z0-9_]{0,99}(?:\.[a-z][a-z0-9_]{0,99})*$`)
	uuidPattern         = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$`)
)

type Compiler struct{}

type compilation struct {
	profile     ProfileDocument
	binding     BindingDocument
	catalog     semanticCatalog
	channels    map[string]Channel
	expressions *expressionCompiler
	result      *CompileResult
}

func NewCompiler() *Compiler {
	return &Compiler{}
}

func (compiler *Compiler) Compile(ctx context.Context, request CompileRequest) (CompileResult, error) {
	inputHash, err := canonicalHash(request)
	if err != nil {
		return CompileResult{}, err
	}

	result := CompileResult{
		Schema:          CompileResultSchema,
		InputHash:       inputHash,
		Compiler:        metadata(),
		Diagnostics:     []Diagnostic{},
		ProfileArtifact: nil,
		BindingArtifact: nil,
		ArtifactHashes:  ArtifactHashes{},
		Previews:        []FixturePreview{},
	}

	if request.Schema != CompileRequestSchema {
		addDiagnostic(&result, "error", "UNSUPPORTED_REQUEST_SCHEMA", "/schema", fmt.Sprintf(
			"Expected schema %q.", CompileRequestSchema,
		))
	}
	if len(request.Fixtures) == 0 || len(request.Fixtures) > maximumFixtures {
		addDiagnostic(&result, "error", "INVALID_FIXTURE_COUNT", "/fixtures", fmt.Sprintf(
			"Compilation requires between 1 and %d fixtures.", maximumFixtures,
		))
	}

	var profile ProfileDocument
	if err := decodeStrict(request.Profile, &profile); err != nil {
		addDiagnostic(&result, "error", "INVALID_PROFILE_DOCUMENT", "/profile", err.Error())
	}

	var binding BindingDocument
	if err := decodeStrict(request.Binding, &binding); err != nil {
		addDiagnostic(&result, "error", "INVALID_BINDING_DOCUMENT", "/binding", err.Error())
	}

	if hasErrors(result.Diagnostics) {
		finalizeResult(&result)

		return result, nil
	}

	expressions, err := newExpressionCompiler()
	if err != nil {
		return CompileResult{}, err
	}

	compiled := compilation{
		profile:     profile,
		binding:     binding,
		catalog:     newSemanticCatalog(),
		channels:    map[string]Channel{},
		expressions: expressions,
		result:      &result,
	}
	compiled.validateProfile()
	compiled.validateBinding()

	if !hasErrors(result.Diagnostics) {
		compiled.executeFixtures(ctx, request.Fixtures)
	}

	if !hasErrors(result.Diagnostics) {
		if err := compiled.buildArtifacts(inputHash); err != nil {
			return CompileResult{}, err
		}
		result.Valid = true
	}

	finalizeResult(&result)

	return result, nil
}

func newSemanticCatalog() semanticCatalog {
	return semanticCatalog{
		Capabilities: map[string]capability{},
		Telemetry:    map[string]capability{},
		Properties:   map[string]capability{},
		Events:       map[string]capability{},
		Commands:     map[string]capability{},
		Derivations:  []string{},
	}
}

func (compiled *compilation) validateProfile() {
	profile := compiled.profile
	if profile.Schema != "iot.device-profile.authoring.v1" {
		compiled.error("UNSUPPORTED_PROFILE_SCHEMA", "/profile/schema", "Unsupported Device Profile schema.")
	}
	compiled.requireUUID(profile.Profile.UUID, "/profile/profile/uuid", "Profile")
	compiled.requireUUID(profile.Version.UUID, "/profile/version/uuid", "Profile Version")
	compiled.requireKey(profile.Profile.Key, "/profile/profile/key")
	if strings.TrimSpace(profile.Profile.Name) == "" {
		compiled.error("MISSING_NAME", "/profile/profile/name", "Profile name is required.")
	}
	if profile.Version.Version < 1 {
		compiled.error("INVALID_VERSION", "/profile/version/version", "Profile Version must be at least 1.")
	}
	if len(profile.Version.Components) == 0 || len(profile.Version.Components) > 32 {
		compiled.error("INVALID_COMPONENT_COUNT", "/profile/version/components", "Profile must contain between 1 and 32 components.")
	}

	componentKeys := map[string]struct{}{}
	rootCount := 0
	for componentIndex := range profile.Version.Components {
		component := &profile.Version.Components[componentIndex]
		componentPath := fmt.Sprintf("/profile/version/components/%d", componentIndex)
		componentKey := "<root>"
		if component.Key == nil {
			rootCount++
		} else {
			componentKey = *component.Key
			compiled.requireKey(componentKey, componentPath+"/key")
		}
		if _, exists := componentKeys[componentKey]; exists {
			compiled.error("DUPLICATE_COMPONENT_KEY", componentPath+"/key", "Component keys must be unique, including the implicit root.")
		}
		componentKeys[componentKey] = struct{}{}

		compiled.addTelemetry(component, componentPath)
		compiled.addProperties(component, componentPath)
		compiled.addEvents(component, componentPath)
		compiled.addCommands(component, componentPath)
	}
	if rootCount != 1 {
		compiled.error("INVALID_ROOT_COMPONENT", "/profile/version/components", "Profile must contain exactly one implicit root component with key null.")
	}

	compiled.validateDerivations()
}

func (compiled *compilation) addTelemetry(component *Component, componentPath string) {
	for index := range component.Telemetry {
		telemetry := &component.Telemetry[index]
		path := fmt.Sprintf("%s/telemetry/%d", componentPath, index)
		qualified := qualify(component.Key, telemetry.Key)
		compiled.requireKey(telemetry.Key, path+"/key")
		compiled.validateValueSchema(telemetry.ValueSchema, path+"/value_schema")
		entry := capability{
			Kind:         capabilityTelemetry,
			QualifiedKey: qualified,
			ValueSchema:  &telemetry.ValueSchema,
			ComponentKey: component.Key,
		}
		if compiled.addCapability(entry, path+"/key") {
			compiled.catalog.Telemetry[qualified] = entry
		}
	}
}

func (compiled *compilation) addProperties(component *Component, componentPath string) {
	for index := range component.Properties {
		property := &component.Properties[index]
		path := fmt.Sprintf("%s/properties/%d", componentPath, index)
		qualified := qualify(component.Key, property.Key)
		compiled.requireKey(property.Key, path+"/key")
		compiled.validateValueSchema(property.ValueSchema, path+"/value_schema")
		if property.Scope != "platform" && property.Scope != "desired" && property.Scope != "reported" {
			compiled.error("INVALID_PROPERTY_SCOPE", path+"/scope", "Property scope must be platform, desired, or reported.")
		}
		entry := capability{
			Kind:          capabilityProperty,
			QualifiedKey:  qualified,
			ValueSchema:   &property.ValueSchema,
			PropertyScope: property.Scope,
			ComponentKey:  component.Key,
		}
		if compiled.addCapability(entry, path+"/key") {
			compiled.catalog.Properties[qualified] = entry
		}
	}
}

func (compiled *compilation) addEvents(component *Component, componentPath string) {
	for index := range component.Events {
		event := &component.Events[index]
		path := fmt.Sprintf("%s/events/%d", componentPath, index)
		qualified := qualify(component.Key, event.Key)
		compiled.requireKey(event.Key, path+"/key")
		fieldKeys := map[string]struct{}{}
		for fieldIndex := range event.Fields {
			field := &event.Fields[fieldIndex]
			fieldPath := fmt.Sprintf("%s/fields/%d", path, fieldIndex)
			compiled.requireKey(field.Key, fieldPath+"/key")
			compiled.validateValueSchema(field.ValueSchema, fieldPath+"/value_schema")
			if _, exists := fieldKeys[field.Key]; exists {
				compiled.error("DUPLICATE_EVENT_FIELD", fieldPath+"/key", "Event field keys must be unique.")
			}
			fieldKeys[field.Key] = struct{}{}
		}
		entry := capability{Kind: capabilityEvent, QualifiedKey: qualified, Event: event, ComponentKey: component.Key}
		if compiled.addCapability(entry, path+"/key") {
			compiled.catalog.Events[qualified] = entry
		}
	}
}

func (compiled *compilation) addCommands(component *Component, componentPath string) {
	for index := range component.Commands {
		command := &component.Commands[index]
		path := fmt.Sprintf("%s/commands/%d", componentPath, index)
		qualified := qualify(component.Key, command.Key)
		compiled.requireKey(command.Key, path+"/key")
		fieldKeys := map[string]struct{}{}
		outputCount := 0
		for fieldIndex := range command.Fields {
			field := &command.Fields[fieldIndex]
			fieldPath := fmt.Sprintf("%s/fields/%d", path, fieldIndex)
			compiled.requireKey(field.Key, fieldPath+"/key")
			compiled.validateValueSchema(field.ValueSchema, fieldPath+"/value_schema")
			if field.Direction != "input" && field.Direction != "output" {
				compiled.error("INVALID_COMMAND_FIELD_DIRECTION", fieldPath+"/direction", "Command field direction must be input or output.")
			}
			if field.Direction == "output" {
				outputCount++
			}
			if _, exists := fieldKeys[field.Key]; exists {
				compiled.error("DUPLICATE_COMMAND_FIELD", fieldPath+"/key", "Command field keys must be unique.")
			}
			fieldKeys[field.Key] = struct{}{}
		}
		if command.Mode == "two_way" && outputCount == 0 {
			compiled.error("MISSING_COMMAND_OUTPUT", path+"/fields", "A two-way Command requires at least one output field.")
		}
		if command.Mode == "one_way" && outputCount > 0 {
			compiled.error("UNEXPECTED_COMMAND_OUTPUT", path+"/fields", "A one-way Command cannot declare output fields.")
		}
		entry := capability{Kind: capabilityCommand, QualifiedKey: qualified, Command: command, ComponentKey: component.Key}
		if compiled.addCapability(entry, path+"/key") {
			compiled.catalog.Commands[qualified] = entry
		}
	}
}

func (compiled *compilation) addCapability(entry capability, path string) bool {
	if !qualifiedKeyPattern.MatchString(entry.QualifiedKey) {
		compiled.error("INVALID_QUALIFIED_KEY", path, fmt.Sprintf("%q is not a valid qualified capability key.", entry.QualifiedKey))

		return false
	}
	if _, exists := compiled.catalog.Capabilities[entry.QualifiedKey]; exists {
		compiled.error("DUPLICATE_CAPABILITY_KEY", path, fmt.Sprintf("Capability %q is declared more than once.", entry.QualifiedKey))

		return false
	}
	compiled.catalog.Capabilities[entry.QualifiedKey] = entry

	return true
}

func (compiled *compilation) validateValueSchema(schema ValueSchema, path string) {
	validTypes := map[string]struct{}{
		"float64": {}, "int64": {}, "uint64": {}, "boolean": {}, "string": {}, "bytes": {}, "state": {},
	}
	if _, valid := validTypes[schema.DataType]; !valid {
		compiled.error("INVALID_DATA_TYPE", path+"/data_type", fmt.Sprintf("Unsupported data type %q.", schema.DataType))
	}
	if schema.Constraints.Minimum != nil && schema.Constraints.Maximum != nil && *schema.Constraints.Minimum > *schema.Constraints.Maximum {
		compiled.error("INVALID_NUMERIC_CONSTRAINT", path+"/constraints", "minimum cannot be greater than maximum.")
	}
	if schema.Constraints.MinLength != nil && schema.Constraints.MaxLength != nil && *schema.Constraints.MinLength > *schema.Constraints.MaxLength {
		compiled.error("INVALID_LENGTH_CONSTRAINT", path+"/constraints", "min_length cannot be greater than max_length.")
	}
	if schema.Constraints.Pattern != "" {
		if _, err := regexp.Compile(schema.Constraints.Pattern); err != nil {
			compiled.error("INVALID_VALUE_PATTERN", path+"/constraints/pattern", err.Error())
		}
	}
}

func (compiled *compilation) validateDerivations() {
	state := map[string]uint8{}
	var visit func(string)
	visit = func(key string) {
		if state[key] == 2 {
			return
		}
		if state[key] == 1 {
			compiled.error("DERIVATION_CYCLE", "/profile/version/components", fmt.Sprintf("Derived telemetry cycle includes %q.", key))

			return
		}
		state[key] = 1
		telemetry := compiled.telemetryDefinition(key)
		if telemetry != nil && telemetry.Derivation != nil {
			for _, dependency := range telemetry.Derivation.Dependencies {
				if _, exists := compiled.catalog.Telemetry[dependency]; !exists {
					compiled.error("DERIVATION_TARGET_NOT_FOUND", "/profile/version/components", fmt.Sprintf(
						"Derived telemetry %q depends on unknown telemetry %q.", key, dependency,
					))
					continue
				}
				visit(dependency)
			}
			if err := compiled.expressions.Compile(telemetry.Derivation.CEL); err != nil {
				compiled.error("INVALID_CEL", "/profile/version/components", fmt.Sprintf("Derived telemetry %q: %v", key, err))
			}
			compiled.catalog.Derivations = append(compiled.catalog.Derivations, key)
		}
		state[key] = 2
	}

	keys := sortedKeys(compiled.catalog.Telemetry)
	for _, key := range keys {
		visit(key)
	}
}

func (compiled *compilation) validateBinding() {
	binding := compiled.binding
	if binding.Schema != "iot.native-mqtt-binding.authoring.v1" {
		compiled.error("UNSUPPORTED_BINDING_SCHEMA", "/binding/schema", "Unsupported Native MQTT Binding schema.")
	}
	compiled.requireUUID(binding.Binding.UUID, "/binding/binding/uuid", "Binding")
	compiled.requireUUID(binding.Version.UUID, "/binding/version/uuid", "Binding Version")
	compiled.requireKey(binding.Binding.Key, "/binding/binding/key")
	if binding.Binding.Transport != "native_mqtt_json" {
		compiled.error("UNSUPPORTED_TRANSPORT", "/binding/binding/transport", "Only native_mqtt_json is supported in v1.")
	}
	if binding.Binding.ProfileUUID != compiled.profile.Profile.UUID {
		compiled.error("PROFILE_IDENTITY_MISMATCH", "/binding/binding/profile_uuid", "Binding targets a different Device Profile UUID.")
	}
	if binding.Version.ProfileVersionUUID != compiled.profile.Version.UUID {
		compiled.error("PROFILE_VERSION_IDENTITY_MISMATCH", "/binding/version/profile_version_uuid", "Binding targets a different Device Profile Version UUID.")
	}
	if binding.Version.Version < 1 {
		compiled.error("INVALID_VERSION", "/binding/version/version", "Binding Version must be at least 1.")
	}

	for index := range binding.Version.Channels {
		channel := binding.Version.Channels[index]
		path := fmt.Sprintf("/binding/version/channels/%d", index)
		compiled.requireKey(channel.Key, path+"/key")
		if _, exists := compiled.channels[channel.Key]; exists {
			compiled.error("DUPLICATE_CHANNEL_KEY", path+"/key", fmt.Sprintf("Channel %q is declared more than once.", channel.Key))
			continue
		}
		compiled.channels[channel.Key] = channel
		compiled.validateChannel(channel, path)
	}

	compiled.validateTelemetryMappings()
	compiled.validatePropertyMappings()
	compiled.validateEventMappings()
	compiled.validateCommandMappings()
}

func (compiled *compilation) validateChannel(channel Channel, path string) {
	if channel.ContentType != "application/json" {
		compiled.error("UNSUPPORTED_CONTENT_TYPE", path+"/content_type", "Only application/json channels are supported.")
	}
	if channel.MaxRecords < 1 || channel.MaxRecords > maximumRecords {
		compiled.error("INVALID_RECORD_LIMIT", path+"/max_records", fmt.Sprintf("max_records must be between 1 and %d.", maximumRecords))
	}
	if _, err := parseRestrictedPath(channel.RecordPath, true); err != nil {
		compiled.error("UNSUPPORTED_JSONPATH", path+"/record_path", err.Error())
	}
	if channel.Envelope.DeviceID != nil {
		compiled.validatePathRef(*channel.Envelope.DeviceID, path+"/envelope/device_id")
	}
	if channel.Envelope.ObservedAt != nil {
		compiled.validatePathRef(channel.Envelope.ObservedAt.Path, path+"/envelope/observed_at/path")
	}
	if channel.Envelope.MessageID != nil {
		compiled.validatePathRef(*channel.Envelope.MessageID, path+"/envelope/message_id")
	}
}

func (compiled *compilation) validateTelemetryMappings() {
	mapped := map[string]int{}
	for index, mapping := range compiled.binding.Version.TelemetryMappings {
		path := fmt.Sprintf("/binding/version/telemetry_mappings/%d", index)
		entry, exists := compiled.catalog.Telemetry[mapping.Target]
		if !exists {
			compiled.error("TARGET_NOT_FOUND", path+"/target", fmt.Sprintf("Telemetry target %q does not exist.", mapping.Target))
		} else if !typesCompatible(mapping.WireDataType, entry.ValueSchema.DataType) && mapping.Transform == nil {
			compiled.error("TYPE_MISMATCH", path+"/wire_data_type", fmt.Sprintf("Wire type %q is not compatible with telemetry type %q.", mapping.WireDataType, entry.ValueSchema.DataType))
		}
		mapped[mapping.Target]++
		compiled.validateChannelReference(mapping.Channel, "telemetry", "device_to_platform", path+"/channel")
		compiled.validatePathRef(mapping.Source, path+"/source")
		compiled.validateTransform(mapping.Transform, path+"/transform")
		compiled.validateMissingPolicy(mapping.MissingPolicy, mapping.DefaultValue, path)
	}
	for target, entry := range compiled.catalog.Telemetry {
		telemetry := compiled.telemetryDefinition(target)
		if telemetry != nil && telemetry.Derivation == nil && entry.ValueSchema.Required && mapped[target] == 0 {
			compiled.error("REQUIRED_MAPPING_MISSING", "/binding/version/telemetry_mappings", fmt.Sprintf("Required telemetry %q is not mapped.", target))
		}
		if mapped[target] > 1 {
			compiled.error("DUPLICATE_MAPPING_TARGET", "/binding/version/telemetry_mappings", fmt.Sprintf("Telemetry %q is mapped more than once.", target))
		}
	}
}

func (compiled *compilation) validatePropertyMappings() {
	mapped := map[string]int{}
	for index, mapping := range compiled.binding.Version.PropertyMappings {
		path := fmt.Sprintf("/binding/version/property_mappings/%d", index)
		entry, exists := compiled.catalog.Properties[mapping.Target]
		if !exists {
			compiled.error("TARGET_NOT_FOUND", path+"/target", fmt.Sprintf("Property target %q does not exist.", mapping.Target))
		} else {
			expectedDirection := "extract"
			expectedPurpose := "reported_properties"
			expectedTransportDirection := "device_to_platform"
			if entry.PropertyScope == "desired" {
				expectedDirection = "place"
				expectedPurpose = "desired_properties"
				expectedTransportDirection = "platform_to_device"
			}
			if entry.PropertyScope == "platform" {
				compiled.error("PLATFORM_PROPERTY_MAPPED", path+"/target", "Platform-owned properties cannot be mapped to device transport.")
			}
			if mapping.Direction != expectedDirection {
				compiled.error("PROPERTY_DIRECTION_MISMATCH", path+"/direction", fmt.Sprintf("Property %q requires %s direction.", mapping.Target, expectedDirection))
			}
			compiled.validateChannelReference(mapping.Channel, expectedPurpose, expectedTransportDirection, path+"/channel")
			if !typesCompatible(mapping.WireDataType, entry.ValueSchema.DataType) && mapping.Transform == nil {
				compiled.error("TYPE_MISMATCH", path+"/wire_data_type", fmt.Sprintf("Wire type %q is not compatible with property type %q.", mapping.WireDataType, entry.ValueSchema.DataType))
			}
		}
		mapped[mapping.Target]++
		if _, err := parseRestrictedPath(mapping.JSONPath, false); err != nil {
			compiled.error("UNSUPPORTED_JSONPATH", path+"/json_path", err.Error())
		}
		compiled.validateTransform(mapping.Transform, path+"/transform")
		compiled.validateMissingPolicy(mapping.MissingPolicy, mapping.DefaultValue, path)
	}
	for target, entry := range compiled.catalog.Properties {
		if entry.PropertyScope != "platform" && entry.ValueSchema.Required && mapped[target] == 0 {
			compiled.error("REQUIRED_MAPPING_MISSING", "/binding/version/property_mappings", fmt.Sprintf("Required property %q is not mapped.", target))
		}
		if mapped[target] > 1 {
			compiled.error("DUPLICATE_MAPPING_TARGET", "/binding/version/property_mappings", fmt.Sprintf("Property %q is mapped more than once.", target))
		}
	}
}

func (compiled *compilation) validateEventMappings() {
	mapped := map[string]int{}
	for index, mapping := range compiled.binding.Version.EventMappings {
		path := fmt.Sprintf("/binding/version/event_mappings/%d", index)
		entry, exists := compiled.catalog.Events[mapping.Target]
		if !exists {
			compiled.error("TARGET_NOT_FOUND", path+"/target", fmt.Sprintf("Event target %q does not exist.", mapping.Target))
		} else {
			fieldSchemas := eventFieldSchemas(entry.Event)
			fieldTargets := map[string]int{}
			for fieldIndex, fieldMapping := range mapping.FieldMappings {
				fieldPath := fmt.Sprintf("%s/field_mappings/%d", path, fieldIndex)
				schema, fieldExists := fieldSchemas[fieldMapping.Target]
				if !fieldExists {
					compiled.error("TARGET_NOT_FOUND", fieldPath+"/target", fmt.Sprintf("Event field %q does not exist.", fieldMapping.Target))
				} else if !typesCompatible(fieldMapping.WireDataType, schema.DataType) && fieldMapping.Transform == nil {
					compiled.error("TYPE_MISMATCH", fieldPath+"/wire_data_type", fmt.Sprintf("Wire type %q is not compatible with event field type %q.", fieldMapping.WireDataType, schema.DataType))
				}
				fieldTargets[fieldMapping.Target]++
				compiled.validatePathRef(fieldMapping.Source, fieldPath+"/source")
				compiled.validateTransform(fieldMapping.Transform, fieldPath+"/transform")
				compiled.validateMissingPolicy(fieldMapping.MissingPolicy, fieldMapping.DefaultValue, fieldPath)
			}
			for fieldKey, schema := range fieldSchemas {
				if schema.Required && fieldTargets[fieldKey] == 0 {
					compiled.error("REQUIRED_MAPPING_MISSING", path+"/field_mappings", fmt.Sprintf("Required event field %q is not mapped.", fieldKey))
				}
				if fieldTargets[fieldKey] > 1 {
					compiled.error("DUPLICATE_MAPPING_TARGET", path+"/field_mappings", fmt.Sprintf("Event field %q is mapped more than once.", fieldKey))
				}
			}
		}
		mapped[mapping.Target]++
		compiled.validateChannelReference(mapping.Channel, "event", "device_to_platform", path+"/channel")
		if mapping.Discriminator != nil {
			compiled.validatePathRef(mapping.Discriminator.Path, path+"/discriminator/path")
		}
		if mapping.EventID != nil {
			compiled.validatePathRef(*mapping.EventID, path+"/event_id")
		}
		if mapping.State != nil {
			compiled.validatePathRef(mapping.State.Path, path+"/state/path")
			compiled.validateTransform(mapping.State.Transform, path+"/state/transform")
		}
	}
	for target := range compiled.catalog.Events {
		if mapped[target] == 0 {
			compiled.error("REQUIRED_MAPPING_MISSING", "/binding/version/event_mappings", fmt.Sprintf("Event %q is not mapped.", target))
		}
		if mapped[target] > 1 {
			compiled.error("DUPLICATE_MAPPING_TARGET", "/binding/version/event_mappings", fmt.Sprintf("Event %q is mapped more than once.", target))
		}
	}
}

func (compiled *compilation) validateCommandMappings() {
	mapped := map[string]int{}
	for index, mapping := range compiled.binding.Version.CommandMappings {
		path := fmt.Sprintf("/binding/version/command_mappings/%d", index)
		entry, exists := compiled.catalog.Commands[mapping.Target]
		if !exists {
			compiled.error("TARGET_NOT_FOUND", path+"/target", fmt.Sprintf("Command target %q does not exist.", mapping.Target))
			continue
		}
		mapped[mapping.Target]++
		compiled.validateChannelReference(mapping.RequestChannel, "command_request", "platform_to_device", path+"/request_channel")
		compiled.validateDefinitePath(mapping.RequestEnvelope.CommandIDPath, path+"/request_envelope/command_id_path")
		compiled.validateOptionalDefinitePath(mapping.RequestEnvelope.DeviceIDPath, path+"/request_envelope/device_id_path")
		compiled.validateOptionalDefinitePath(mapping.RequestEnvelope.RequestedAtPath, path+"/request_envelope/requested_at_path")
		compiled.validateOptionalDefinitePath(mapping.RequestEnvelope.ExpiresAtPath, path+"/request_envelope/expires_at_path")

		if entry.Command.Mode == "two_way" {
			if mapping.ResponseChannel == nil || mapping.Response == nil {
				compiled.error("COMMAND_RESPONSE_REQUIRED", path, "A two-way Command requires response_channel, correlation, and status mappings.")
			} else {
				compiled.validateChannelReference(*mapping.ResponseChannel, "command_response", "device_to_platform", path+"/response_channel")
				compiled.validatePathRef(mapping.Response.Correlation, path+"/response/correlation")
				compiled.validatePathRef(mapping.Response.Status.Path, path+"/response/status/path")
				compiled.validateTransform(mapping.Response.Status.Transform, path+"/response/status/transform")
				compiled.validateStatusValues(mapping.Response.Status.Values, path+"/response/status/values")
			}
		} else if mapping.ResponseChannel != nil || mapping.Response != nil {
			compiled.error("COMMAND_RESPONSE_NOT_ALLOWED", path, "A one-way Command cannot declare response mappings.")
		}

		fieldSchemas := commandFieldSchemas(entry.Command)
		fieldTargets := map[string]int{}
		for fieldIndex, fieldMapping := range mapping.FieldMappings {
			fieldPath := fmt.Sprintf("%s/field_mappings/%d", path, fieldIndex)
			field, fieldExists := fieldSchemas[fieldMapping.Target]
			if !fieldExists {
				compiled.error("TARGET_NOT_FOUND", fieldPath+"/target", fmt.Sprintf("Command field %q does not exist.", fieldMapping.Target))
			} else {
				if field.Direction != fieldMapping.Direction {
					compiled.error("COMMAND_FIELD_DIRECTION_MISMATCH", fieldPath+"/direction", fmt.Sprintf("Command field %q has direction %q.", fieldMapping.Target, field.Direction))
				}
				if !typesCompatible(fieldMapping.WireDataType, field.ValueSchema.DataType) && fieldMapping.Transform == nil {
					compiled.error("TYPE_MISMATCH", fieldPath+"/wire_data_type", fmt.Sprintf("Wire type %q is not compatible with Command field type %q.", fieldMapping.WireDataType, field.ValueSchema.DataType))
				}
			}
			fieldTargets[fieldMapping.Target]++
			compiled.validateDefinitePath(fieldMapping.JSONPath, fieldPath+"/json_path")
			compiled.validateTransform(fieldMapping.Transform, fieldPath+"/transform")
			compiled.validateMissingPolicy(fieldMapping.MissingPolicy, fieldMapping.DefaultValue, fieldPath)
		}
		for fieldKey, field := range fieldSchemas {
			if field.ValueSchema.Required && fieldTargets[fieldKey] == 0 {
				compiled.error("REQUIRED_MAPPING_MISSING", path+"/field_mappings", fmt.Sprintf("Required Command field %q is not mapped.", fieldKey))
			}
			if fieldTargets[fieldKey] > 1 {
				compiled.error("DUPLICATE_MAPPING_TARGET", path+"/field_mappings", fmt.Sprintf("Command field %q is mapped more than once.", fieldKey))
			}
		}
	}
	for target := range compiled.catalog.Commands {
		if mapped[target] == 0 {
			compiled.error("REQUIRED_MAPPING_MISSING", "/binding/version/command_mappings", fmt.Sprintf("Command %q is not mapped.", target))
		}
		if mapped[target] > 1 {
			compiled.error("DUPLICATE_MAPPING_TARGET", "/binding/version/command_mappings", fmt.Sprintf("Command %q is mapped more than once.", target))
		}
	}
}

func (compiled *compilation) validateChannelReference(key, purpose, direction, path string) {
	channel, exists := compiled.channels[key]
	if !exists {
		compiled.error("CHANNEL_NOT_FOUND", path, fmt.Sprintf("Channel %q does not exist.", key))

		return
	}
	if channel.Purpose != purpose {
		compiled.error("CHANNEL_PURPOSE_MISMATCH", path, fmt.Sprintf("Channel %q has purpose %q; expected %q.", key, channel.Purpose, purpose))
	}
	if channel.Direction != direction {
		compiled.error("CHANNEL_DIRECTION_MISMATCH", path, fmt.Sprintf("Channel %q has direction %q; expected %q.", key, channel.Direction, direction))
	}
}

func (compiled *compilation) validatePathRef(reference PathRef, path string) {
	if reference.Scope != "payload" && reference.Scope != "record" {
		compiled.error("INVALID_PATH_SCOPE", path+"/scope", "Path scope must be payload or record.")
	}
	compiled.validateDefinitePath(reference.JSONPath, path+"/json_path")
}

func (compiled *compilation) validateDefinitePath(value, path string) {
	if _, err := parseRestrictedPath(value, false); err != nil {
		compiled.error("UNSUPPORTED_JSONPATH", path, err.Error())
	}
}

func (compiled *compilation) validateOptionalDefinitePath(value, path string) {
	if value != "" {
		compiled.validateDefinitePath(value, path)
	}
}

func (compiled *compilation) validateTransform(transform *Transform, path string) {
	if transform == nil {
		return
	}
	if transform.Preset == "" && transform.CEL == "" {
		compiled.error("EMPTY_TRANSFORM", path, "Transform must declare preset or cel.")
	}
	if transform.Preset != "" {
		if _, err := applyPreset(transform.Preset, "probe"); err != nil && !strings.Contains(err.Error(), "requires") {
			compiled.error("UNSUPPORTED_TRANSFORM_PRESET", path+"/preset", err.Error())
		}
	}
	if transform.CEL != "" {
		if err := compiled.expressions.Compile(transform.CEL); err != nil {
			compiled.error("INVALID_CEL", path+"/cel", err.Error())
		}
	}
}

func (compiled *compilation) validateMissingPolicy(policy string, defaultValue any, path string) {
	switch policy {
	case "reject_message", "omit_value":
	case "use_default":
		if defaultValue == nil {
			compiled.error("DEFAULT_VALUE_REQUIRED", path+"/default_value", "use_default requires default_value.")
		}
	default:
		compiled.error("INVALID_MISSING_POLICY", path+"/missing_policy", fmt.Sprintf("Unsupported missing policy %q.", policy))
	}
}

func (compiled *compilation) validateStatusValues(values StatusValues, path string) {
	seen := map[string]string{}
	groups := []struct {
		name   string
		values []string
	}{
		{"accepted", values.Accepted},
		{"running", values.Running},
		{"succeeded", values.Succeeded},
		{"failed", values.Failed},
	}
	for _, group := range groups {
		for _, value := range group.values {
			if previous, exists := seen[value]; exists {
				compiled.error("AMBIGUOUS_COMMAND_STATUS", path, fmt.Sprintf("Wire status %q appears in both %s and %s.", value, previous, group.name))
			}
			seen[value] = group.name
		}
	}
	if len(values.Succeeded) == 0 || len(values.Failed) == 0 {
		compiled.error("TERMINAL_COMMAND_STATUS_REQUIRED", path, "Command response mapping requires succeeded and failed wire values.")
	}
}

func (compiled *compilation) requireKey(value, path string) {
	if !keyPattern.MatchString(value) {
		compiled.error("INVALID_KEY", path, fmt.Sprintf("%q is not a valid key.", value))
	}
}

func (compiled *compilation) requireUUID(value, path, label string) {
	if !uuidPattern.MatchString(value) {
		compiled.error("MISSING_IDENTITY", path, fmt.Sprintf("%s requires a persisted UUID before compilation.", label))
	}
}

func (compiled *compilation) error(code, path, message string) {
	addDiagnostic(compiled.result, "error", code, path, message)
}

func (compiled *compilation) buildArtifacts(sourceHash string) error {
	profileArtifact := map[string]any{
		"schema":               "iot.device-profile.v1",
		"profile_uuid":         compiled.profile.Profile.UUID,
		"profile_key":          compiled.profile.Profile.Key,
		"profile_version_uuid": compiled.profile.Version.UUID,
		"version":              compiled.profile.Version.Version,
		"source_hash":          sourceHash,
		"compiler":             metadata(),
		"components":           compiled.profile.Version.Components,
	}
	profileHash, err := canonicalHash(profileArtifact)
	if err != nil {
		return err
	}

	bindingArtifact := map[string]any{
		"schema":                "iot.native-mqtt-binding.v1",
		"binding_uuid":          compiled.binding.Binding.UUID,
		"binding_key":           compiled.binding.Binding.Key,
		"binding_version_uuid":  compiled.binding.Version.UUID,
		"version":               compiled.binding.Version.Version,
		"profile_uuid":          compiled.profile.Profile.UUID,
		"profile_version_uuid":  compiled.profile.Version.UUID,
		"profile_artifact_hash": profileHash,
		"source_hash":           sourceHash,
		"compiler":              metadata(),
		"channels":              compiled.binding.Version.Channels,
		"telemetry_mappings":    compiled.binding.Version.TelemetryMappings,
		"property_mappings":     compiled.binding.Version.PropertyMappings,
		"event_mappings":        compiled.binding.Version.EventMappings,
		"command_mappings":      compiled.binding.Version.CommandMappings,
	}
	bindingHash, err := canonicalHash(bindingArtifact)
	if err != nil {
		return err
	}

	compiled.result.ProfileArtifact = profileArtifact
	compiled.result.BindingArtifact = bindingArtifact
	compiled.result.ArtifactHashes.Profile = &profileHash
	compiled.result.ArtifactHashes.Binding = &bindingHash

	return nil
}

func (compiled *compilation) telemetryDefinition(key string) *Telemetry {
	for componentIndex := range compiled.profile.Version.Components {
		component := &compiled.profile.Version.Components[componentIndex]
		for telemetryIndex := range component.Telemetry {
			telemetry := &component.Telemetry[telemetryIndex]
			if qualify(component.Key, telemetry.Key) == key {
				return telemetry
			}
		}
	}

	return nil
}

func qualify(componentKey *string, key string) string {
	if componentKey == nil {
		return key
	}

	return *componentKey + "." + key
}

func typesCompatible(wire, semantic string) bool {
	if wire == semantic {
		return true
	}
	numeric := map[string]bool{"float64": true, "int64": true, "uint64": true}
	if numeric[wire] && numeric[semantic] {
		return true
	}

	return (wire == "string" && semantic == "state") || (wire == "state" && semantic == "string")
}

func eventFieldSchemas(event *Event) map[string]ValueSchema {
	fields := map[string]ValueSchema{}
	for _, field := range event.Fields {
		fields[field.Key] = field.ValueSchema
	}

	return fields
}

func commandFieldSchemas(command *Command) map[string]CommandField {
	fields := map[string]CommandField{}
	for _, field := range command.Fields {
		fields[field.Key] = field
	}

	return fields
}

func sortedKeys[T any](values map[string]T) []string {
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sort.Strings(keys)

	return keys
}

func addDiagnostic(result *CompileResult, severity, code, path, message string) {
	result.Diagnostics = append(result.Diagnostics, Diagnostic{
		Severity: severity,
		Code:     code,
		Path:     path,
		Message:  message,
	})
}

func hasErrors(diagnostics []Diagnostic) bool {
	for _, diagnostic := range diagnostics {
		if diagnostic.Severity == "error" {
			return true
		}
	}

	return false
}

func finalizeResult(result *CompileResult) {
	sort.SliceStable(result.Diagnostics, func(left, right int) bool {
		if result.Diagnostics[left].Path != result.Diagnostics[right].Path {
			return result.Diagnostics[left].Path < result.Diagnostics[right].Path
		}
		if result.Diagnostics[left].Code != result.Diagnostics[right].Code {
			return result.Diagnostics[left].Code < result.Diagnostics[right].Code
		}

		return result.Diagnostics[left].Message < result.Diagnostics[right].Message
	})
	result.Valid = !hasErrors(result.Diagnostics) && result.ProfileArtifact != nil && result.BindingArtifact != nil
}

func ensureContext(ctx context.Context) error {
	select {
	case <-ctx.Done():
		return ctx.Err()
	default:
		return nil
	}
}

var errFixtureRejected = errors.New("fixture rejected")
