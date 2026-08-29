package definition

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"time"
)

func (compiler *Compiler) previewFixture(
	ctx context.Context,
	request CompileRequest,
	profile ProfileArtifact,
	bundle RuntimeBundle,
	plan compilePlan,
	index int,
	fixture Fixture,
) FixturePreview {
	preview := FixturePreview{
		Name:        fixture.Name,
		Values:      []PreviewValue{},
		Diagnostics: []Diagnostic{},
	}
	diagnostics := &diagnosticCollector{}
	path := fmt.Sprintf("/fixtures/%d", index)
	channel, exists := resolvedChannel(bundle, fixture.Channel)
	if !exists {
		diagnostics.error("FIXTURE_CHANNEL_NOT_FOUND", path+"/channel", fmt.Sprintf("Resolved Channel %s is not present in the Runtime Bundle.", fixture.Channel))
		preview.Diagnostics = diagnostics.sorted()

		return preview
	}
	if fixture.Topic != channel.Topic {
		diagnostics.error("FIXTURE_TOPIC_MISMATCH", path+"/topic", fmt.Sprintf("Fixture topic %s does not equal resolved topic %s.", fixture.Topic, channel.Topic))
	}

	switch fixture.Kind {
	case "telemetry":
		preview.Values = compiler.previewTelemetry(ctx, fixture, path, channel, bundle, plan, diagnostics)
	case "command_request":
		preview.EncodedPayload = compiler.previewCommandRequest(ctx, fixture, path, profile, bundle, diagnostics)
	case "command_response":
		preview.EncodedPayload = compiler.previewCommandResponse(ctx, fixture, path, profile, bundle, diagnostics)
	case "event", "property":
		diagnostics.error("FIXTURE_KIND_UNSUPPORTED", path+"/kind", fmt.Sprintf("%s fixture execution is not part of this Runtime Bundle milestone.", fixture.Kind))
	default:
		diagnostics.error("FIXTURE_KIND_INVALID", path+"/kind", "Fixture kind is not supported.")
	}

	preview.Accepted = !diagnostics.hasErrors()
	preview.Diagnostics = diagnostics.sorted()

	return preview
}

func (compiler *Compiler) previewTelemetry(
	ctx context.Context,
	fixture Fixture,
	fixturePath string,
	channel ResolvedChannel,
	bundle RuntimeBundle,
	plan compilePlan,
	diagnostics *diagnosticCollector,
) []PreviewValue {
	if channel.Purpose != "telemetry" || channel.Direction != "device_to_platform" {
		diagnostics.error("FIXTURE_CHANNEL_PURPOSE_MISMATCH", fixturePath+"/channel", "Telemetry fixture requires a device-to-platform telemetry Channel.")

		return []PreviewValue{}
	}
	recordPath, err := parseRestrictedPath(channel.RecordPath, true)
	if err != nil {
		diagnostics.error("JSONPATH_UNSUPPORTED", fixturePath+"/payload", err.Error())

		return []PreviewValue{}
	}
	selected, found := recordPath.Get(fixture.Payload)
	if !found {
		diagnostics.error("RECORD_PATH_NOT_FOUND", fixturePath+"/payload", "Channel record_path did not select a value from the fixture payload.")

		return []PreviewValue{}
	}
	records := []any{selected}
	if recordPath.Wildcard {
		var ok bool
		records, ok = selected.([]any)
		if !ok {
			diagnostics.error("RECORD_PATH_TYPE_INVALID", fixturePath+"/payload", "Wildcard record_path must select an array.")

			return []PreviewValue{}
		}
	}
	if len(records) > channel.MaxRecords {
		diagnostics.error("RECORD_LIMIT_EXCEEDED", fixturePath+"/payload", fmt.Sprintf("Fixture selected %d records, exceeding max_records %d.", len(records), channel.MaxRecords))
		records = records[:channel.MaxRecords]
	}

	values := []PreviewValue{}
	for recordIndex, record := range records {
		routeValue := record
		if channel.RoutePayloadPath != "" {
			routePath, err := parseRestrictedPath(channel.RoutePayloadPath, false)
			if err != nil {
				diagnostics.error("JSONPATH_UNSUPPORTED", fixturePath+"/payload", err.Error())
				continue
			}
			var routeFound bool
			routeValue, routeFound = routePath.Get(record)
			if !routeFound {
				diagnostics.error("ROUTE_PAYLOAD_NOT_FOUND", fixturePath+"/payload", fmt.Sprintf("Route payload path did not match record %d.", recordIndex))
				continue
			}
		}
		if channel.RouteSelector != nil {
			selectorValue, selectorFound, err := scopedValue(channel.RouteSelector.Source, fixture.Payload, record, routeValue)
			if err != nil {
				diagnostics.error("ROUTE_SELECTOR_INVALID", fixturePath+"/payload", err.Error())
				continue
			}
			if !selectorFound || !scalarEqual(selectorValue, channel.RouteSelector.Equals) {
				diagnostics.error("ROUTE_SELECTOR_NOT_MATCHED", fixturePath+"/payload", fmt.Sprintf("Route selector did not match record %d.", recordIndex))
				continue
			}
		}
		compiler.previewEnvelope(fixture.Payload, record, routeValue, channel.Envelope, fixturePath, diagnostics)

		recordValues, parameterValues := compiler.previewMeasuredParameters(
			ctx,
			fixture,
			fixturePath,
			channel,
			record,
			routeValue,
			bundle,
			plan,
			diagnostics,
		)
		values = append(values, recordValues...)
		derivedValues := compiler.previewDerivedParameters(ctx, fixturePath, fixture.Payload, record, routeValue, channel.Topic, parameterValues, plan, diagnostics)
		values = append(values, derivedValues...)
	}

	for _, expected := range fixture.ExpectedParameterValues {
		matched := false
		for _, value := range values {
			if value.ParameterUUID == expected.ParameterUUID && scalarEqual(value.Value, expected.Value) {
				matched = true
				break
			}
		}
		if !matched {
			diagnostics.error("FIXTURE_EXPECTATION_MISMATCH", fixturePath+"/expected_parameter_values", fmt.Sprintf("Expected value for parameter %s was not produced.", expected.ParameterUUID))
		}
	}

	return values
}

func (compiler *Compiler) previewMeasuredParameters(
	ctx context.Context,
	fixture Fixture,
	fixturePath string,
	channel ResolvedChannel,
	record any,
	routeValue any,
	bundle RuntimeBundle,
	plan compilePlan,
	diagnostics *diagnosticCollector,
) ([]PreviewValue, map[string]any) {
	values := []PreviewValue{}
	parameterValues := map[string]any{}
	for _, pipeline := range bundle.ParameterPipelines {
		mapping := pipeline.Mapping
		if mapping.Channel != channel.Key {
			continue
		}
		path := fixturePath + "/payload"
		raw, found, err := scopedValue(mapping.Source, fixture.Payload, record, routeValue)
		if err != nil {
			diagnostics.error("MAPPING_EXTRACTION_FAILED", path, fmt.Sprintf("Mapping %s: %v", mapping.UUID, err))
			continue
		}
		quality := Quality{Status: "good", Codes: []string{}}
		if !found {
			raw, found, err = missingMappedValue(mapping.OnMissing, mapping.DefaultValue)
			if err != nil {
				diagnostics.error("MAPPING_VALUE_MISSING", path, fmt.Sprintf("Mapping %s rejects a missing value.", mapping.UUID))
				continue
			}
			if !found {
				diagnostics.info("MAPPING_VALUE_OMITTED", path, fmt.Sprintf("Mapping %s omitted a missing value.", mapping.UUID))
				continue
			}
		}

		candidate := raw
		wire, err := coerceValue(raw, mapping.WireDataType)
		if err == nil {
			candidate = wire
		}
		if err == nil {
			wire, err = applyOperations(ctx, compiler.expressions, mapping.Calibration, wire, map[string]any{
				"message":         fixture.Payload,
				"record":          record,
				"route":           routeValue,
				"topic":           channel.Topic,
				"p":               parameterValues,
				"route_variables": map[string]string{},
			})
			if err == nil {
				candidate = wire
			}
		}
		parameter := plan.parameters[mapping.TargetParameterUUID]
		if err == nil {
			wire, err = validateSemanticValue(wire, parameter.ValueSchema)
		}
		if err != nil {
			resolved, include, policyErr := invalidMappedValue(mapping.OnInvalid, mapping.DefaultValue, candidate, parameter.ValueSchema)
			if policyErr != nil {
				diagnostics.error("MAPPING_VALUE_INVALID", path, fmt.Sprintf("Mapping %s: %v", mapping.UUID, err))
				continue
			}
			if !include {
				diagnostics.info("MAPPING_VALUE_OMITTED", path, fmt.Sprintf("Mapping %s omitted an invalid value.", mapping.UUID))
				continue
			}
			wire = resolved
			if mapping.OnInvalid == "accept_with_bad_quality" {
				quality = Quality{Status: "bad", Codes: []string{"mapping_value_invalid"}}
				diagnostics.warning("MAPPING_VALUE_BAD_QUALITY", path, fmt.Sprintf("Mapping %s accepted an invalid value with bad quality: %v", mapping.UUID, err))
			}
		}
		parameterValues[mapping.TargetParameterUUID] = wire
		values = append(values, PreviewValue{
			ParameterUUID: mapping.TargetParameterUUID,
			ValueType:     pipeline.TargetDataType,
			Value:         wire,
			Quality:       quality,
		})
	}

	return values, parameterValues
}

func (compiler *Compiler) previewDerivedParameters(
	ctx context.Context,
	fixturePath string,
	message any,
	record any,
	routeValue any,
	topic string,
	parameterValues map[string]any,
	plan compilePlan,
	diagnostics *diagnosticCollector,
) []PreviewValue {
	values := []PreviewValue{}
	for _, parameter := range plan.derivedOrder {
		available := true
		for _, dependency := range parameter.Dependencies {
			if _, exists := parameterValues[dependency]; !exists {
				diagnostics.error("DERIVATION_DEPENDENCY_UNAVAILABLE", fixturePath+"/payload", fmt.Sprintf("Derived parameter %s is missing dependency %s.", parameter.UUID, dependency))
				available = false
			}
		}
		if !available {
			continue
		}
		value, err := compiler.expressions.Evaluate(ctx, parameter.Expression.Source, map[string]any{
			"p":               parameterValues,
			"message":         message,
			"record":          record,
			"route":           routeValue,
			"topic":           topic,
			"route_variables": map[string]string{},
		})
		if err == nil {
			value, err = validateSemanticValue(value, parameter.ValueSchema)
		}
		if err != nil {
			diagnostics.error("DERIVATION_EVALUATION_FAILED", fixturePath+"/payload", fmt.Sprintf("Derived parameter %s: %v", parameter.UUID, err))
			continue
		}
		parameterValues[parameter.UUID] = value
		values = append(values, PreviewValue{
			ParameterUUID: parameter.UUID,
			ValueType:     parameter.ValueSchema.DataType,
			Value:         value,
			Quality:       Quality{Status: "good", Codes: []string{}},
		})
	}

	return values
}

func (compiler *Compiler) previewEnvelope(
	message any,
	record any,
	routeValue any,
	envelope Envelope,
	fixturePath string,
	diagnostics *diagnosticCollector,
) {
	if envelope.ObservedAt != nil {
		value, found, err := scopedValue(envelope.ObservedAt.Path, message, record, routeValue)
		if err != nil || !found {
			diagnostics.error("ENVELOPE_OBSERVED_AT_MISSING", fixturePath+"/payload", "Observed-at path did not resolve.")
		} else if err := validateTimestamp(value, envelope.ObservedAt.Format); err != nil {
			diagnostics.error("ENVELOPE_OBSERVED_AT_INVALID", fixturePath+"/payload", err.Error())
		}
	}
	for name, reference := range map[string]*PathRef{
		"message_id": envelope.MessageID,
		"sequence":   envelope.Sequence,
	} {
		if reference == nil {
			continue
		}
		_, found, err := scopedValue(*reference, message, record, routeValue)
		if err != nil || !found {
			diagnostics.error("ENVELOPE_VALUE_MISSING", fixturePath+"/payload", fmt.Sprintf("Envelope %s path did not resolve.", name))
		}
	}
}

func (compiler *Compiler) previewCommandRequest(
	ctx context.Context,
	fixture Fixture,
	path string,
	profile ProfileArtifact,
	bundle RuntimeBundle,
	diagnostics *diagnosticCollector,
) any {
	pipeline, exists := commandPipelineByChannel(bundle, fixture.Channel, true)
	if !exists {
		diagnostics.error("COMMAND_PIPELINE_NOT_FOUND", path+"/channel", "No Command request pipeline uses the fixture Channel.")

		return nil
	}
	commandID, err := valueAtPath(fixture.Payload, pipeline.Mapping.RequestEnvelope.CommandIDPath)
	if err != nil {
		diagnostics.error("COMMAND_ID_MISSING", path+"/payload", err.Error())

		return nil
	}
	commandIDText, ok := commandID.(string)
	if !ok {
		diagnostics.error("COMMAND_ID_INVALID", path+"/payload", "Command ID must be a string.")

		return nil
	}
	invocation := CommandInvocation{
		CommandID: commandIDText,
		Inputs:    fixture.CommandInput,
	}
	if pipeline.Mapping.RequestEnvelope.RequestedAtPath != nil {
		value, err := valueAtPath(fixture.Payload, *pipeline.Mapping.RequestEnvelope.RequestedAtPath)
		if err != nil {
			diagnostics.error("COMMAND_REQUESTED_AT_MISSING", path+"/payload", err.Error())

			return nil
		}
		invocation.RequestedAt, _ = value.(string)
	}
	if pipeline.Mapping.RequestEnvelope.ExpiresAtPath != nil {
		value, err := valueAtPath(fixture.Payload, *pipeline.Mapping.RequestEnvelope.ExpiresAtPath)
		if err != nil {
			diagnostics.error("COMMAND_EXPIRES_AT_MISSING", path+"/payload", err.Error())

			return nil
		}
		invocation.ExpiresAt, _ = value.(string)
	}
	if invocation.Inputs == nil {
		invocation.Inputs = map[string]any{}
		for _, mapping := range pipeline.Mapping.FieldMappings {
			if mapping.Direction != "input" {
				continue
			}
			value, err := valueAtPath(fixture.Payload, mapping.JSONPath)
			if err == nil {
				invocation.Inputs[mapping.TargetCommandFieldUUID] = value
			}
		}
	}
	encoded, err := compiler.EncodeCommand(ctx, profile, bundle, pipeline.CommandUUID, invocation)
	if err != nil {
		diagnostics.error("COMMAND_ENCODING_FAILED", path+"/payload", err.Error())

		return nil
	}
	if !canonicalEqual(encoded, fixture.Payload) {
		diagnostics.error("COMMAND_ENCODING_MISMATCH", path+"/payload", "Encoded Command request is not byte-semantically equal to the fixture payload.")
	}

	return encoded
}

func (compiler *Compiler) previewCommandResponse(
	ctx context.Context,
	fixture Fixture,
	path string,
	profile ProfileArtifact,
	bundle RuntimeBundle,
	diagnostics *diagnosticCollector,
) any {
	pipeline, exists := commandPipelineByChannel(bundle, fixture.Channel, false)
	if !exists {
		diagnostics.error("COMMAND_PIPELINE_NOT_FOUND", path+"/channel", "No Command response pipeline uses the fixture Channel.")

		return nil
	}
	decoded, err := compiler.DecodeCommandResponse(ctx, profile, bundle, pipeline.CommandUUID, fixture.Payload)
	if err != nil {
		diagnostics.error("COMMAND_RESPONSE_DECODING_FAILED", path+"/payload", err.Error())

		return nil
	}

	return decoded
}

func resolvedChannel(bundle RuntimeBundle, key string) (ResolvedChannel, bool) {
	for _, channel := range bundle.Channels {
		if channel.Key == key {
			return channel, true
		}
	}

	return ResolvedChannel{}, false
}

func commandPipelineByChannel(bundle RuntimeBundle, channel string, request bool) (CommandPipeline, bool) {
	for _, pipeline := range bundle.CommandPipelines {
		if request && pipeline.Mapping.RequestChannel == channel {
			return pipeline, true
		}
		if !request && pipeline.Mapping.ResponseChannel != nil && *pipeline.Mapping.ResponseChannel == channel {
			return pipeline, true
		}
	}

	return CommandPipeline{}, false
}

func valueAtPath(source any, pathValue string) (any, error) {
	path, err := parseRestrictedPath(pathValue, false)
	if err != nil {
		return nil, err
	}
	value, found := path.Get(source)
	if !found {
		return nil, fmt.Errorf("path %s did not resolve", pathValue)
	}

	return value, nil
}

func validateTimestamp(value any, format string) error {
	switch format {
	case "rfc3339":
		text, ok := value.(string)
		if !ok {
			return errors.New("RFC3339 timestamp must be a string")
		}
		if _, err := time.Parse(time.RFC3339Nano, text); err != nil {
			return fmt.Errorf("invalid RFC3339 timestamp: %w", err)
		}
	case "unix_seconds", "unix_milliseconds":
		if _, ok := numericValue(value); !ok {
			if text, textOK := value.(string); textOK {
				if _, err := strconv.ParseInt(text, 10, 64); err == nil {
					return nil
				}
			}

			return fmt.Errorf("%s timestamp must be numeric", format)
		}
	default:
		return fmt.Errorf("unsupported timestamp format %q", format)
	}

	return nil
}
