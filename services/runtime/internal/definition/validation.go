package definition

import (
	"fmt"
	"regexp"
	"sort"
	"strings"
)

var (
	uuidPattern               = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$`)
	keyPattern                = regexp.MustCompile(`^[a-z][a-z0-9_]{0,99}$`)
	topicVariable             = regexp.MustCompile(`\{([A-Za-z_][A-Za-z0-9_]*)\}`)
	derivedParameterReference = regexp.MustCompile(`p\s*\[\s*['"]([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})['"]\s*\]`)
)

func (compiler *Compiler) validate(request CompileRequest, diagnostics *diagnosticCollector) compilePlan {
	plan := compilePlan{
		parameters:    map[string]Parameter{},
		derived:       map[string]DerivedParameter{},
		properties:    map[string]Property{},
		events:        map[string]Event{},
		eventFields:   map[string]EventField{},
		commands:      map[string]Command{},
		commandFields: map[string]commandFieldTarget{},
		channels:      map[string]Channel{},
		inboundScopes: map[string]InboundScope{},
	}

	compiler.validateDocumentIdentities(request, diagnostics)
	compiler.validateProfile(request.Profile, &plan, diagnostics)
	compiler.validateBinding(request.Binding, &plan, diagnostics)
	compiler.validateRoute(request, &plan, diagnostics)
	compiler.resolveChannels(request, &plan, diagnostics)
	compiler.validateFixtures(request.Fixtures, diagnostics)

	return plan
}

func (compiler *Compiler) validateDocumentIdentities(request CompileRequest, diagnostics *diagnosticCollector) {
	assertSchema(request.Schema, CompileRequestSchema, "/schema", diagnostics)
	assertSchema(request.Profile.Schema, ProfileAuthoringSchema, "/profile/schema", diagnostics)
	assertSchema(request.Binding.Schema, BindingAuthoringSchema, "/binding/schema", diagnostics)
	assertSchema(request.Gateway.Schema, GatewayAuthoringSchema, "/gateway/schema", diagnostics)
	assertSchema(request.Route.Schema, RouteAuthoringSchema, "/route/schema", diagnostics)
	assertUUID(request.OrganizationUUID, "/organization_uuid", diagnostics)
	assertUUID(request.Profile.Profile.UUID, "/profile/profile/uuid", diagnostics)
	assertUUID(request.Profile.Version.UUID, "/profile/version/uuid", diagnostics)
	assertUUID(request.Binding.Binding.UUID, "/binding/binding/uuid", diagnostics)
	assertUUID(request.Binding.Version.UUID, "/binding/version/uuid", diagnostics)
	assertUUID(request.Gateway.Gateway.UUID, "/gateway/gateway/uuid", diagnostics)
	assertUUID(request.Route.Route.UUID, "/route/route/uuid", diagnostics)
	assertUUID(request.Route.Route.DeviceUUID, "/route/route/device_uuid", diagnostics)

	if request.Binding.Binding.ProfileUUID != request.Profile.Profile.UUID {
		diagnostics.error("PROFILE_IDENTITY_MISMATCH", "/binding/binding/profile_uuid", "Binding Profile UUID does not match the compiled Profile.")
	}
	if request.Binding.Version.ProfileVersionUUID != request.Profile.Version.UUID {
		diagnostics.error("PROFILE_VERSION_IDENTITY_MISMATCH", "/binding/version/profile_version_uuid", "Binding Profile Version UUID does not match the compiled Profile Version.")
	}
	if request.Route.Route.GatewayUUID != request.Gateway.Gateway.UUID {
		diagnostics.error("GATEWAY_IDENTITY_MISMATCH", "/route/route/gateway_uuid", "Gateway Route does not belong to the compiled Gateway.")
	}
	if request.Route.Route.ProfileVersionUUID != request.Profile.Version.UUID {
		diagnostics.error("ROUTE_PROFILE_VERSION_MISMATCH", "/route/route/profile_version_uuid", "Gateway Route does not pin the compiled Profile Version.")
	}
	if request.Route.Route.BindingVersionUUID != request.Binding.Version.UUID {
		diagnostics.error("ROUTE_BINDING_VERSION_MISMATCH", "/route/route/binding_version_uuid", "Gateway Route does not pin the compiled Binding Version.")
	}
	if !request.Route.Route.Enabled {
		diagnostics.error("ROUTE_DISABLED", "/route/route/enabled", "A disabled Gateway Route cannot produce an active Runtime Bundle.")
	}
}

func (compiler *Compiler) validateProfile(
	document ProfileDocument,
	plan *compilePlan,
	diagnostics *diagnosticCollector,
) {
	assertKey(document.Profile.Key, "/profile/profile/key", diagnostics)
	if document.Version.Version < 1 {
		diagnostics.error("INVALID_VERSION", "/profile/version/version", "Profile Version must be at least 1.")
	}

	seenUUIDs := map[string]string{}
	parameterKeys := map[string]string{}
	propertyKeys := map[string]string{}
	eventKeys := map[string]string{}
	commandKeys := map[string]string{}
	for index, parameter := range document.Version.Parameters {
		path := fmt.Sprintf("/profile/version/parameters/%d", index)
		registerUUID(parameter.UUID, path+"/uuid", seenUUIDs, diagnostics)
		registerKey(parameter.Key, path+"/key", parameterKeys, diagnostics)
		validateValueSchema(parameter.ValueSchema, path+"/value_schema", diagnostics)
		if _, exists := plan.parameters[parameter.UUID]; !exists {
			plan.parameters[parameter.UUID] = parameter
		}
	}

	for index, parameter := range document.Version.DerivedParameters {
		path := fmt.Sprintf("/profile/version/derived_parameters/%d", index)
		registerUUID(parameter.UUID, path+"/uuid", seenUUIDs, diagnostics)
		registerKey(parameter.Key, path+"/key", parameterKeys, diagnostics)
		validateValueSchema(parameter.ValueSchema, path+"/value_schema", diagnostics)
		if parameter.Expression.Language != "cel" {
			diagnostics.error("DERIVATION_LANGUAGE_UNSUPPORTED", path+"/expression/language", "Derived parameters must use restricted CEL.")
		} else if err := compiler.expressions.Compile(parameter.Expression.Source); err != nil {
			diagnostics.error(celDiagnosticCode(err), path+"/expression/source", err.Error())
		}
		if _, exists := plan.derived[parameter.UUID]; !exists {
			plan.derived[parameter.UUID] = parameter
		}
	}

	for index, property := range document.Version.Properties {
		path := fmt.Sprintf("/profile/version/properties/%d", index)
		registerUUID(property.UUID, path+"/uuid", seenUUIDs, diagnostics)
		registerKey(property.Key, path+"/key", propertyKeys, diagnostics)
		validateValueSchema(property.ValueSchema, path+"/value_schema", diagnostics)
		if _, exists := plan.properties[property.UUID]; !exists {
			plan.properties[property.UUID] = property
		}
	}

	for eventIndex, event := range document.Version.Events {
		path := fmt.Sprintf("/profile/version/events/%d", eventIndex)
		registerUUID(event.UUID, path+"/uuid", seenUUIDs, diagnostics)
		registerKey(event.Key, path+"/key", eventKeys, diagnostics)
		if _, exists := plan.events[event.UUID]; !exists {
			plan.events[event.UUID] = event
		}
		fieldKeys := map[string]string{}
		for fieldIndex, field := range event.Fields {
			fieldPath := fmt.Sprintf("%s/fields/%d", path, fieldIndex)
			registerUUID(field.UUID, fieldPath+"/uuid", seenUUIDs, diagnostics)
			registerKey(field.Key, fieldPath+"/key", fieldKeys, diagnostics)
			validateValueSchema(field.ValueSchema, fieldPath+"/value_schema", diagnostics)
			if _, exists := plan.eventFields[field.UUID]; !exists {
				plan.eventFields[field.UUID] = field
			}
		}
	}

	for commandIndex, command := range document.Version.Commands {
		path := fmt.Sprintf("/profile/version/commands/%d", commandIndex)
		registerUUID(command.UUID, path+"/uuid", seenUUIDs, diagnostics)
		registerKey(command.Key, path+"/key", commandKeys, diagnostics)
		if command.Mode != "one_way" && command.Mode != "two_way" {
			diagnostics.error("COMMAND_MODE_INVALID", path+"/mode", "Command mode must be one_way or two_way.")
		}
		if (command.Risk == "medium" || command.Risk == "high") &&
			(command.ConfirmationText == nil || strings.TrimSpace(*command.ConfirmationText) == "") {
			diagnostics.error("COMMAND_CONFIRMATION_REQUIRED", path+"/confirmation_text", "Medium- and high-risk Commands require confirmation text.")
		}
		if !command.Idempotent && command.MaxAttempts != 1 {
			diagnostics.error("COMMAND_ATTEMPTS_INVALID", path+"/max_attempts", "A non-idempotent Command must have exactly one attempt.")
		}
		if _, exists := plan.commands[command.UUID]; !exists {
			plan.commands[command.UUID] = command
		}
		fieldKeys := map[string]string{}
		hasOutput := false
		for fieldIndex, field := range command.Fields {
			fieldPath := fmt.Sprintf("%s/fields/%d", path, fieldIndex)
			registerUUID(field.UUID, fieldPath+"/uuid", seenUUIDs, diagnostics)
			registerKey(field.Key, fieldPath+"/key", fieldKeys, diagnostics)
			validateValueSchema(field.ValueSchema, fieldPath+"/value_schema", diagnostics)
			if field.Direction == "output" {
				hasOutput = true
				if command.Mode == "one_way" {
					diagnostics.error("COMMAND_OUTPUT_NOT_ALLOWED", fieldPath+"/direction", "A one-way Command cannot declare output fields.")
				}
			}
			if _, exists := plan.commandFields[field.UUID]; !exists {
				plan.commandFields[field.UUID] = commandFieldTarget{CommandUUID: command.UUID, Field: field}
			}
		}
		if command.Mode == "two_way" && !hasOutput {
			diagnostics.error("COMMAND_OUTPUT_REQUIRED", path+"/fields", "A two-way Command must declare at least one output field.")
		}
	}

	plan.derivedOrder = compiler.orderDerived(document.Version.DerivedParameters, plan, diagnostics)
}

func (compiler *Compiler) orderDerived(
	parameters []DerivedParameter,
	plan *compilePlan,
	diagnostics *diagnosticCollector,
) []DerivedParameter {
	position := map[string]int{}
	indegree := map[string]int{}
	edges := map[string][]string{}
	for index, parameter := range parameters {
		position[parameter.UUID] = index
		indegree[parameter.UUID] = 0
	}

	for index, parameter := range parameters {
		path := fmt.Sprintf("/profile/version/derived_parameters/%d/dependencies", index)
		declared := map[string]bool{}
		for _, dependency := range parameter.Dependencies {
			declared[dependency] = true
			if _, measured := plan.parameters[dependency]; measured {
				continue
			}
			if _, derived := plan.derived[dependency]; derived {
				indegree[parameter.UUID]++
				edges[dependency] = append(edges[dependency], parameter.UUID)
				continue
			}
			diagnostics.error("DERIVATION_DEPENDENCY_NOT_FOUND", path, fmt.Sprintf("Dependency parameter UUID %s is not declared by this Profile Version.", dependency))
		}
		for _, match := range derivedParameterReference.FindAllStringSubmatch(parameter.Expression.Source, -1) {
			referenced := match[1]
			if !declared[referenced] {
				diagnostics.error("DERIVATION_DEPENDENCY_UNDECLARED", path, fmt.Sprintf("CEL references parameter UUID %s without declaring it as a dependency.", referenced))
			}
		}
	}

	queue := make([]string, 0, len(parameters))
	for _, parameter := range parameters {
		if indegree[parameter.UUID] == 0 {
			queue = append(queue, parameter.UUID)
		}
	}
	ordered := make([]DerivedParameter, 0, len(parameters))
	for len(queue) > 0 {
		sort.SliceStable(queue, func(left, right int) bool {
			return position[queue[left]] < position[queue[right]]
		})
		current := queue[0]
		queue = queue[1:]
		ordered = append(ordered, plan.derived[current])
		for _, dependent := range edges[current] {
			indegree[dependent]--
			if indegree[dependent] == 0 {
				queue = append(queue, dependent)
			}
		}
	}
	if len(ordered) != len(parameters) {
		diagnostics.error("DERIVATION_CYCLE", "/profile/version/derived_parameters", "Derived parameter dependencies contain a cycle.")
	}

	return ordered
}

func (compiler *Compiler) validateBinding(
	document BindingDocument,
	plan *compilePlan,
	diagnostics *diagnosticCollector,
) {
	assertKey(document.Binding.Key, "/binding/binding/key", diagnostics)
	if document.Binding.Transport != "native_mqtt_json" {
		diagnostics.error("TRANSPORT_UNSUPPORTED", "/binding/binding/transport", "Only native_mqtt_json is supported by this compiler.")
	}
	if document.Version.Version < 1 {
		diagnostics.error("INVALID_VERSION", "/binding/version/version", "Binding Version must be at least 1.")
	}

	seenUUIDs := map[string]string{}
	for index, channel := range document.Version.Channels {
		path := fmt.Sprintf("/binding/version/channels/%d", index)
		registerUUID(channel.UUID, path+"/uuid", seenUUIDs, diagnostics)
		assertKey(channel.Key, path+"/key", diagnostics)
		if previous, exists := plan.channels[channel.Key]; exists {
			diagnostics.error("DUPLICATE_CHANNEL_KEY", path+"/key", fmt.Sprintf("Channel key %s is duplicated by Channel %s.", channel.Key, previous.UUID))
		} else {
			plan.channels[channel.Key] = channel
		}
		compiler.validateChannel(channel, path, diagnostics)
	}
	if len(document.Version.Channels) == 0 {
		diagnostics.error("CHANNEL_REQUIRED", "/binding/version/channels", "A Binding Version requires at least one Channel.")
	}

	for index, mapping := range document.Version.ParameterMappings {
		path := fmt.Sprintf("/binding/version/parameter_mappings/%d", index)
		registerUUID(mapping.UUID, path+"/uuid", seenUUIDs, diagnostics)
		parameter, exists := plan.parameters[mapping.TargetParameterUUID]
		if !exists {
			diagnostics.error("MAPPING_TARGET_NOT_FOUND", path+"/target_parameter_uuid", "Parameter mapping target UUID is not a measured parameter in the compiled Profile Version.")
		} else if !dataTypesCompatible(mapping.WireDataType, parameter.ValueSchema.DataType) {
			diagnostics.error("TYPE_MISMATCH", path+"/wire_data_type", fmt.Sprintf("Wire type %s cannot produce Profile type %s.", mapping.WireDataType, parameter.ValueSchema.DataType))
		}
		compiler.validateMappingChannel(mapping.Channel, "telemetry", "device_to_platform", path+"/channel", plan, diagnostics)
		validatePathReference(mapping.Source, path+"/source", diagnostics)
		validatePolicies(mapping.OnMissing, mapping.OnInvalid, mapping.DefaultValue, path, diagnostics)
		if err := validateOperations(compiler.expressions, mapping.Calibration); err != nil {
			diagnostics.error(celOrCalibrationCode(err), path+"/calibration", err.Error())
		}
	}

	for index, mapping := range document.Version.PropertyMappings {
		path := fmt.Sprintf("/binding/version/property_mappings/%d", index)
		registerUUID(mapping.UUID, path+"/uuid", seenUUIDs, diagnostics)
		property, exists := plan.properties[mapping.TargetPropertyUUID]
		if !exists {
			diagnostics.error("MAPPING_TARGET_NOT_FOUND", path+"/target_property_uuid", "Property mapping target UUID is not declared by the compiled Profile Version.")
		} else if !dataTypesCompatible(mapping.WireDataType, property.ValueSchema.DataType) {
			diagnostics.error("TYPE_MISMATCH", path+"/wire_data_type", fmt.Sprintf("Wire type %s cannot produce Profile type %s.", mapping.WireDataType, property.ValueSchema.DataType))
		}
		compiler.validateMappingChannel(mapping.Channel, "", mapping.Direction, path+"/channel", plan, diagnostics)
		validatePathReference(mapping.Source, path+"/source", diagnostics)
		validatePolicies(mapping.OnMissing, mapping.OnInvalid, mapping.DefaultValue, path, diagnostics)
		if err := validateOperations(compiler.expressions, mapping.Operations); err != nil {
			diagnostics.error(celOrCalibrationCode(err), path+"/operations", err.Error())
		}
	}

	for index, mapping := range document.Version.EventMappings {
		path := fmt.Sprintf("/binding/version/event_mappings/%d", index)
		registerUUID(mapping.UUID, path+"/uuid", seenUUIDs, diagnostics)
		if _, exists := plan.events[mapping.TargetEventUUID]; !exists {
			diagnostics.error("MAPPING_TARGET_NOT_FOUND", path+"/target_event_uuid", "Event mapping target UUID is not declared by the compiled Profile Version.")
		}
		compiler.validateMappingChannel(mapping.Channel, "event", "device_to_platform", path+"/channel", plan, diagnostics)
		if mapping.Discriminator != nil {
			validatePathReference(mapping.Discriminator.Source, path+"/discriminator/source", diagnostics)
		}
		if mapping.EventID != nil {
			validatePathReference(*mapping.EventID, path+"/event_id", diagnostics)
		}
		if mapping.State != nil {
			validatePathReference(mapping.State.Source, path+"/state/source", diagnostics)
		}
		for fieldIndex, field := range mapping.FieldMappings {
			fieldPath := fmt.Sprintf("%s/field_mappings/%d", path, fieldIndex)
			target, exists := plan.eventFields[field.TargetEventFieldUUID]
			if !exists {
				diagnostics.error("MAPPING_TARGET_NOT_FOUND", fieldPath+"/target_event_field_uuid", "Event field mapping target UUID is not declared by the compiled Profile Version.")
			} else if !dataTypesCompatible(field.WireDataType, target.ValueSchema.DataType) {
				diagnostics.error("TYPE_MISMATCH", fieldPath+"/wire_data_type", fmt.Sprintf("Wire type %s cannot produce Profile type %s.", field.WireDataType, target.ValueSchema.DataType))
			}
			validatePathReference(field.Source, fieldPath+"/source", diagnostics)
			validatePolicies(field.OnMissing, field.OnInvalid, field.DefaultValue, fieldPath, diagnostics)
			if err := validateOperations(compiler.expressions, field.Operations); err != nil {
				diagnostics.error(celOrCalibrationCode(err), fieldPath+"/operations", err.Error())
			}
		}
	}

	compiler.validateCommandMappings(document.Version.CommandMappings, plan, seenUUIDs, diagnostics)
}

func (compiler *Compiler) validateChannel(channel Channel, path string, diagnostics *diagnosticCollector) {
	if channel.ContentType != "application/json" {
		diagnostics.error("CONTENT_TYPE_UNSUPPORTED", path+"/content_type", "Native MQTT Channels must use application/json.")
	}
	if channel.QoS < 0 || channel.QoS > 1 {
		diagnostics.error("QOS_UNSUPPORTED", path+"/qos", "Only MQTT QoS 0 and 1 are supported.")
	}
	if channel.MaxRecords < 1 || channel.MaxRecords > maximumRecords {
		diagnostics.error("RECORD_LIMIT_INVALID", path+"/max_records", "Channel max_records must be between 1 and 100.")
	}
	if _, err := parseRestrictedPath(channel.RecordPath, true); err != nil {
		diagnostics.error("JSONPATH_UNSUPPORTED", path+"/record_path", err.Error())
	}
	if strings.ContainsAny(channel.TopicTemplate, "+#") {
		diagnostics.error("MQTT_TOPIC_WILDCARD_UNSUPPORTED", path+"/topic_template", "Compiled topics cannot contain MQTT wildcards.")
	}
	expectedDirection := map[string]string{
		"telemetry":           "device_to_platform",
		"reported_properties": "device_to_platform",
		"desired_properties":  "platform_to_device",
		"event":               "device_to_platform",
		"command_request":     "platform_to_device",
		"command_response":    "device_to_platform",
	}[channel.Purpose]
	if expectedDirection == "" {
		diagnostics.error("CHANNEL_PURPOSE_INVALID", path+"/purpose", "Channel purpose is not supported.")
	} else if channel.Direction != expectedDirection {
		diagnostics.error("CHANNEL_DIRECTION_MISMATCH", path+"/direction", fmt.Sprintf("Channel purpose %s requires direction %s.", channel.Purpose, expectedDirection))
	}
	if channel.Envelope.ObservedAt != nil {
		validatePathReference(channel.Envelope.ObservedAt.Path, path+"/envelope/observed_at/path", diagnostics)
	}
	if channel.Envelope.MessageID != nil {
		validatePathReference(*channel.Envelope.MessageID, path+"/envelope/message_id", diagnostics)
	}
	if channel.Envelope.Sequence != nil {
		validatePathReference(*channel.Envelope.Sequence, path+"/envelope/sequence", diagnostics)
	}
}

func (compiler *Compiler) validateCommandMappings(
	mappings []CommandMapping,
	plan *compilePlan,
	seenUUIDs map[string]string,
	diagnostics *diagnosticCollector,
) {
	mappedCommands := map[string]string{}
	for index, mapping := range mappings {
		path := fmt.Sprintf("/binding/version/command_mappings/%d", index)
		registerUUID(mapping.UUID, path+"/uuid", seenUUIDs, diagnostics)
		command, exists := plan.commands[mapping.TargetCommandUUID]
		if !exists {
			diagnostics.error("MAPPING_TARGET_NOT_FOUND", path+"/target_command_uuid", "Command mapping target UUID is not declared by the compiled Profile Version.")
		} else if previous, duplicate := mappedCommands[mapping.TargetCommandUUID]; duplicate {
			diagnostics.error("DUPLICATE_COMMAND_MAPPING", path+"/target_command_uuid", fmt.Sprintf("Command already mapped at %s.", previous))
		} else {
			mappedCommands[mapping.TargetCommandUUID] = path
		}
		compiler.validateMappingChannel(mapping.RequestChannel, "command_request", "platform_to_device", path+"/request_channel", plan, diagnostics)
		if mapping.RequestTemplate == nil {
			diagnostics.error("COMMAND_REQUEST_TEMPLATE_REQUIRED", path+"/request_template", "Command request_template must be a JSON object.")
		}
		validatePlacementPath(mapping.RequestEnvelope.CommandIDPath, path+"/request_envelope/command_id_path", diagnostics)
		validateOptionalPlacementPath(mapping.RequestEnvelope.RequestedAtPath, path+"/request_envelope/requested_at_path", diagnostics)
		validateOptionalPlacementPath(mapping.RequestEnvelope.ExpiresAtPath, path+"/request_envelope/expires_at_path", diagnostics)
		validateOptionalPlacementPath(mapping.RequestEnvelope.RoutePathPath, path+"/request_envelope/route_path_path", diagnostics)
		for key, value := range mapping.RequestEnvelope.RouteVariablePaths {
			assertKey(key, path+"/request_envelope/route_variable_paths", diagnostics)
			validatePlacementPath(value, path+"/request_envelope/route_variable_paths/"+key, diagnostics)
		}

		if exists && command.Mode == "two_way" {
			if mapping.ResponseChannel == nil || mapping.Response == nil {
				diagnostics.error("COMMAND_RESPONSE_MAPPING_REQUIRED", path, "A two-way Command requires response channel, correlation, and status mapping.")
			}
		}
		if exists && command.Mode == "one_way" && (mapping.ResponseChannel != nil || mapping.Response != nil) {
			diagnostics.error("COMMAND_RESPONSE_NOT_ALLOWED", path, "A one-way Command cannot declare a response mapping.")
		}
		if mapping.ResponseChannel != nil {
			compiler.validateMappingChannel(*mapping.ResponseChannel, "command_response", "device_to_platform", path+"/response_channel", plan, diagnostics)
		}
		if mapping.Response != nil {
			validatePathReference(mapping.Response.Correlation, path+"/response/correlation", diagnostics)
			validatePathReference(mapping.Response.Status.Path, path+"/response/status/path", diagnostics)
			if len(mapping.Response.Status.Values.Succeeded) == 0 || len(mapping.Response.Status.Values.Failed) == 0 {
				diagnostics.error("COMMAND_STATUS_TERMINAL_VALUES_REQUIRED", path+"/response/status/values", "Command response status must map succeeded and failed terminal values.")
			}
		}

		mappedFields := map[string]bool{}
		for fieldIndex, field := range mapping.FieldMappings {
			fieldPath := fmt.Sprintf("%s/field_mappings/%d", path, fieldIndex)
			target, targetExists := plan.commandFields[field.TargetCommandFieldUUID]
			if !targetExists || (exists && target.CommandUUID != command.UUID) {
				diagnostics.error("MAPPING_TARGET_NOT_FOUND", fieldPath+"/target_command_field_uuid", "Command field mapping target UUID does not belong to the mapped Command.")
			} else {
				if target.Field.Direction != field.Direction {
					diagnostics.error("COMMAND_FIELD_DIRECTION_MISMATCH", fieldPath+"/direction", "Command field mapping direction does not match the Profile field.")
				}
				if !dataTypesCompatible(field.WireDataType, target.Field.ValueSchema.DataType) {
					diagnostics.error("TYPE_MISMATCH", fieldPath+"/wire_data_type", fmt.Sprintf("Wire type %s is incompatible with Profile type %s.", field.WireDataType, target.Field.ValueSchema.DataType))
				}
				if field.Direction == "input" && field.OnInvalid == "accept_with_bad_quality" {
					diagnostics.error("COMMAND_INPUT_POLICY_UNSAFE", fieldPath+"/on_invalid", "Command inputs cannot transmit invalid values with bad quality.")
				}
				if field.Direction == "input" && target.Field.Required && field.OnMissing != "reject_message" {
					diagnostics.error("COMMAND_REQUIRED_INPUT_POLICY_INVALID", fieldPath+"/on_missing", "A required Command input must be collected before publishing and therefore must reject a missing value.")
				}
			}
			validatePlacementPath(field.JSONPath, fieldPath+"/json_path", diagnostics)
			validatePolicies(field.OnMissing, field.OnInvalid, field.DefaultValue, fieldPath, diagnostics)
			if err := validateOperations(compiler.expressions, field.Operations); err != nil {
				diagnostics.error(celOrCalibrationCode(err), fieldPath+"/operations", err.Error())
			}
			mappedFields[field.TargetCommandFieldUUID] = true
		}
		validateCommandTemplate(mapping, path, diagnostics)
		if exists {
			for _, field := range command.Fields {
				if field.Required && !mappedFields[field.UUID] {
					diagnostics.error("COMMAND_FIELD_MAPPING_REQUIRED", path+"/field_mappings", fmt.Sprintf("Required Command field %s is not mapped.", field.UUID))
				}
			}
		}
	}
}

func validateCommandTemplate(mapping CommandMapping, path string, diagnostics *diagnosticCollector) {
	if mapping.RequestTemplate == nil {
		return
	}
	template, err := deepCopyMap(mapping.RequestTemplate)
	if err != nil {
		diagnostics.error("COMMAND_REQUEST_TEMPLATE_INVALID", path+"/request_template", err.Error())

		return
	}
	type placement struct {
		path  string
		value string
	}
	placements := []placement{{path: mapping.RequestEnvelope.CommandIDPath, value: "compiler-command-id"}}
	for _, optional := range []struct {
		name      string
		candidate *string
	}{
		{name: "requested_at", candidate: mapping.RequestEnvelope.RequestedAtPath},
		{name: "expires_at", candidate: mapping.RequestEnvelope.ExpiresAtPath},
		{name: "route_path", candidate: mapping.RequestEnvelope.RoutePathPath},
	} {
		name := optional.name
		candidate := optional.candidate
		if candidate != nil {
			placements = append(placements, placement{path: *candidate, value: "compiler-" + name})
		}
	}
	routeKeys := make([]string, 0, len(mapping.RequestEnvelope.RouteVariablePaths))
	for key := range mapping.RequestEnvelope.RouteVariablePaths {
		routeKeys = append(routeKeys, key)
	}
	sort.Strings(routeKeys)
	for _, key := range routeKeys {
		placements = append(placements, placement{
			path:  mapping.RequestEnvelope.RouteVariablePaths[key],
			value: "compiler-route-" + key,
		})
	}
	for _, field := range mapping.FieldMappings {
		if field.Direction == "input" {
			placements = append(placements, placement{
				path:  field.JSONPath,
				value: "compiler-field-" + field.TargetCommandFieldUUID,
			})
		}
	}
	for _, item := range placements {
		if err := placeValue(template, item.path, item.value); err != nil {
			diagnostics.error("COMMAND_TEMPLATE_PATH_CONFLICT", path+"/request_template", fmt.Sprintf("Cannot place %s: %v", item.path, err))

			return
		}
	}
	for _, item := range placements {
		value, err := valueAtPath(template, item.path)
		if err != nil || value != item.value {
			diagnostics.error("COMMAND_TEMPLATE_PATH_CONFLICT", path+"/request_template", fmt.Sprintf("Command request paths collide at %s.", item.path))

			return
		}
	}
}

func (compiler *Compiler) validateMappingChannel(
	key string,
	purpose string,
	direction string,
	path string,
	plan *compilePlan,
	diagnostics *diagnosticCollector,
) {
	channel, exists := plan.channels[key]
	if !exists {
		diagnostics.error("CHANNEL_NOT_FOUND", path, fmt.Sprintf("Channel %s is not declared by the Binding Version.", key))

		return
	}
	if purpose != "" && channel.Purpose != purpose {
		diagnostics.error("CHANNEL_PURPOSE_MISMATCH", path, fmt.Sprintf("Channel %s has purpose %s, expected %s.", key, channel.Purpose, purpose))
	}
	if direction != "" && channel.Direction != direction {
		diagnostics.error("CHANNEL_DIRECTION_MISMATCH", path, fmt.Sprintf("Channel %s has direction %s, expected %s.", key, channel.Direction, direction))
	}
}

func (compiler *Compiler) validateRoute(
	request CompileRequest,
	plan *compilePlan,
	diagnostics *diagnosticCollector,
) {
	if request.Route.Route.Revision < 1 {
		diagnostics.error("INVALID_ROUTE_REVISION", "/route/route/revision", "Gateway Route revision must be at least 1.")
	}
	if strings.TrimSpace(request.Route.Route.RoutePath) == "" {
		diagnostics.error("ROUTE_PATH_REQUIRED", "/route/route/route_path", "Gateway Route path is required.")
	}
	for index, scope := range request.Route.Route.InboundScopes {
		path := fmt.Sprintf("/route/route/inbound_scopes/%d", index)
		channel, exists := plan.channels[scope.Channel]
		if !exists {
			diagnostics.error("CHANNEL_NOT_FOUND", path+"/channel", fmt.Sprintf("Channel %s is not declared by the Binding Version.", scope.Channel))
		} else if channel.Direction != "device_to_platform" {
			diagnostics.error("ROUTE_SCOPE_DIRECTION_INVALID", path+"/channel", "Inbound route scopes may target only device-to-platform Channels.")
		}
		if _, duplicate := plan.inboundScopes[scope.Channel]; duplicate {
			diagnostics.error("DUPLICATE_ROUTE_SCOPE", path+"/channel", fmt.Sprintf("Channel %s has more than one inbound route scope.", scope.Channel))
		} else {
			plan.inboundScopes[scope.Channel] = scope
		}
		if _, err := parseRestrictedPath(scope.PayloadPath, false); err != nil {
			diagnostics.error("JSONPATH_UNSUPPORTED", path+"/payload_path", err.Error())
		}
		if scope.Selector != nil {
			validatePathReference(scope.Selector.Source, path+"/selector/source", diagnostics)
		}
	}
	for mappingIndex, mapping := range request.Binding.Version.CommandMappings {
		for key := range mapping.RequestEnvelope.RouteVariablePaths {
			if _, exists := commandEnvelopeRouteValue(request, key); !exists {
				diagnostics.error(
					"ROUTE_VARIABLE_NOT_FOUND",
					fmt.Sprintf("/binding/version/command_mappings/%d/request_envelope/route_variable_paths/%s", mappingIndex, key),
					fmt.Sprintf("Command envelope route variable %s is not supplied by the Gateway Route.", key),
				)
			}
		}
	}
}

func (compiler *Compiler) resolveChannels(
	request CompileRequest,
	plan *compilePlan,
	diagnostics *diagnosticCollector,
) {
	resolved := make([]ResolvedChannel, 0, len(request.Binding.Version.Channels))
	for index, channel := range request.Binding.Version.Channels {
		path := fmt.Sprintf("/binding/version/channels/%d/topic_template", index)
		topic, err := resolveTopic(channel.TopicTemplate, request)
		if err != nil {
			diagnostics.error("TOPIC_TEMPLATE_UNRESOLVED", path, err.Error())
			continue
		}
		compiled := ResolvedChannel{
			ChannelUUID: channel.UUID,
			Key:         channel.Key,
			Purpose:     channel.Purpose,
			Direction:   channel.Direction,
			Topic:       topic,
			QoS:         channel.QoS,
			Retain:      channel.Retain,
			RecordPath:  channel.RecordPath,
			MaxRecords:  channel.MaxRecords,
			Envelope:    channel.Envelope,
		}
		if scope, exists := plan.inboundScopes[channel.Key]; exists {
			compiled.RoutePayloadPath = scope.PayloadPath
			compiled.RouteSelector = scope.Selector
		}
		resolved = append(resolved, compiled)
	}
	sort.SliceStable(resolved, func(left, right int) bool {
		return resolved[left].Key < resolved[right].Key
	})
	plan.resolvedChannels = resolved
}

func (compiler *Compiler) validateFixtures(fixtures []Fixture, diagnostics *diagnosticCollector) {
	if len(fixtures) > maximumFixtures {
		diagnostics.error("FIXTURE_LIMIT_EXCEEDED", "/fixtures", "A compile request may include at most 256 fixtures.")
	}
	for index, fixture := range fixtures {
		path := fmt.Sprintf("/fixtures/%d", index)
		if strings.TrimSpace(fixture.Name) == "" {
			diagnostics.error("FIXTURE_NAME_REQUIRED", path+"/name", "Fixture name is required.")
		}
		switch fixture.Kind {
		case "telemetry", "event", "property", "command_request", "command_response":
		default:
			diagnostics.error("FIXTURE_KIND_INVALID", path+"/kind", "Fixture kind is not supported.")
		}
	}
}

func validateValueSchema(schema ValueSchema, path string, diagnostics *diagnosticCollector) {
	validTypes := map[string]bool{
		"float64": true, "int64": true, "uint64": true, "boolean": true,
		"string": true, "bytes": true, "state": true,
	}
	if !validTypes[schema.DataType] {
		diagnostics.error("DATA_TYPE_INVALID", path+"/data_type", fmt.Sprintf("Data type %s is not supported.", schema.DataType))
	}
	if schema.Constraints.Minimum != nil && schema.Constraints.Maximum != nil &&
		*schema.Constraints.Minimum > *schema.Constraints.Maximum {
		diagnostics.error("CONSTRAINT_RANGE_INVALID", path+"/constraints", "Minimum cannot exceed maximum.")
	}
	if schema.Constraints.MultipleOf != nil && *schema.Constraints.MultipleOf <= 0 {
		diagnostics.error("CONSTRAINT_MULTIPLE_INVALID", path+"/constraints/multiple_of", "multiple_of must be greater than zero.")
	}
	if schema.Constraints.Pattern != nil {
		if _, err := regexp.Compile(*schema.Constraints.Pattern); err != nil {
			diagnostics.error("CONSTRAINT_PATTERN_INVALID", path+"/constraints/pattern", err.Error())
		}
	}
	if schema.DefaultValue != nil {
		if _, err := validateSemanticValue(schema.DefaultValue, schema); err != nil {
			diagnostics.error("DEFAULT_VALUE_INVALID", path+"/default_value", err.Error())
		}
	}
}

func validatePolicies(onMissing, onInvalid string, defaultValue any, path string, diagnostics *diagnosticCollector) {
	validMissing := map[string]bool{"reject_message": true, "omit_value": true, "use_default": true}
	validInvalid := map[string]bool{
		"reject_message": true, "omit_value": true, "use_default": true,
		"clamp": true, "accept_with_bad_quality": true,
	}
	if !validMissing[onMissing] {
		diagnostics.error("MAPPING_POLICY_REQUIRED", path+"/on_missing", "Mapping requires an explicit on_missing policy.")
	}
	if !validInvalid[onInvalid] {
		diagnostics.error("MAPPING_POLICY_REQUIRED", path+"/on_invalid", "Mapping requires an explicit on_invalid policy.")
	}
	if (onMissing == "use_default" || onInvalid == "use_default") && defaultValue == nil {
		diagnostics.error("MAPPING_DEFAULT_REQUIRED", path+"/default_value", "use_default requires a mapping default_value.")
	}
}

func validatePathReference(reference PathRef, path string, diagnostics *diagnosticCollector) {
	if reference.Scope != "message" && reference.Scope != "record" && reference.Scope != "route" {
		diagnostics.error("JSONPATH_SCOPE_INVALID", path+"/scope", "Path scope must be message, record, or route.")
	}
	if _, err := parseRestrictedPath(reference.JSONPath, false); err != nil {
		diagnostics.error("JSONPATH_UNSUPPORTED", path+"/json_path", err.Error())
	}
}

func validatePlacementPath(path, diagnosticPath string, diagnostics *diagnosticCollector) {
	parsed, err := parseRestrictedPath(path, false)
	if err != nil {
		diagnostics.error("JSONPATH_UNSUPPORTED", diagnosticPath, err.Error())
	} else if len(parsed.Steps) == 0 {
		diagnostics.error("JSONPATH_PLACEMENT_ROOT_UNSUPPORTED", diagnosticPath, "Command fields cannot be placed at the JSON document root.")
	}
}

func validateOptionalPlacementPath(path *string, diagnosticPath string, diagnostics *diagnosticCollector) {
	if path != nil {
		validatePlacementPath(*path, diagnosticPath, diagnostics)
	}
}

func dataTypesCompatible(wire, target string) bool {
	numeric := map[string]bool{"float64": true, "int64": true, "uint64": true}
	if numeric[wire] && numeric[target] {
		return true
	}
	if wire == target {
		return true
	}

	return wire == "string" && target == "state"
}

func resolveTopic(template string, request CompileRequest) (string, error) {
	values := map[string]string{
		"gateway_id":        request.Gateway.Gateway.MQTTClientID,
		"gateway_uuid":      request.Gateway.Gateway.UUID,
		"route_path":        request.Route.Route.RoutePath,
		"device_uuid":       request.Route.Route.DeviceUUID,
		"organization_uuid": request.OrganizationUUID,
	}
	routeVariableKeys := make([]string, 0, len(request.Route.Route.TopicVariables))
	for key := range request.Route.Route.TopicVariables {
		routeVariableKeys = append(routeVariableKeys, key)
	}
	sort.Strings(routeVariableKeys)
	for _, key := range routeVariableKeys {
		if _, reserved := values[key]; reserved {
			return "", fmt.Errorf("route topic variable %s collides with a trusted compiler variable", key)
		}
		values[key] = request.Route.Route.TopicVariables[key]
	}

	unresolved := ""
	resolved := topicVariable.ReplaceAllStringFunc(template, func(match string) string {
		name := strings.TrimSuffix(strings.TrimPrefix(match, "{"), "}")
		value, exists := values[name]
		if !exists || value == "" {
			unresolved = name

			return match
		}

		return value
	})
	if unresolved != "" {
		return "", fmt.Errorf("topic variable %s is not resolved by Gateway or Route context", unresolved)
	}
	if strings.ContainsAny(resolved, "{}+#\x00") {
		return "", fmt.Errorf("resolved topic %q contains an unresolved placeholder, MQTT wildcard, or null byte", resolved)
	}
	if len(resolved) == 0 || len(resolved) > 512 {
		return "", fmt.Errorf("resolved topic length must be between 1 and 512 bytes")
	}

	return resolved, nil
}

func registerUUID(value, path string, seen map[string]string, diagnostics *diagnosticCollector) {
	assertUUID(value, path, diagnostics)
	if previous, exists := seen[value]; exists {
		diagnostics.error("DUPLICATE_DEFINITION_UUID", path, fmt.Sprintf("UUID %s is already used at %s.", value, previous))
	} else {
		seen[value] = path
	}
}

func registerKey(value, path string, seen map[string]string, diagnostics *diagnosticCollector) {
	assertKey(value, path, diagnostics)
	if previous, exists := seen[value]; exists {
		diagnostics.error("DUPLICATE_DEFINITION_KEY", path, fmt.Sprintf("Key %s is already used at %s.", value, previous))
	} else {
		seen[value] = path
	}
}

func assertUUID(value, path string, diagnostics *diagnosticCollector) {
	if !uuidPattern.MatchString(value) {
		diagnostics.error("UUID_INVALID", path, "Value must be a canonical UUID.")
	}
}

func assertKey(value, path string, diagnostics *diagnosticCollector) {
	if !keyPattern.MatchString(value) {
		diagnostics.error("KEY_INVALID", path, "Value must be a lowercase snake_case key.")
	}
}

func assertSchema(actual, expected, path string, diagnostics *diagnosticCollector) {
	if actual != expected {
		diagnostics.error("SCHEMA_UNSUPPORTED", path, fmt.Sprintf("Expected schema %s.", expected))
	}
}

func celOrCalibrationCode(err error) string {
	if strings.Contains(strings.ToLower(err.Error()), "cel") ||
		strings.Contains(strings.ToLower(err.Error()), "undeclared reference") {
		return celDiagnosticCode(err)
	}

	return "CALIBRATION_INVALID"
}
