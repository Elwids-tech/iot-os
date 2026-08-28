package definition

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

func (compiled *compilation) executeFixtures(ctx context.Context, fixtures []Fixture) {
	for index, fixture := range fixtures {
		if err := ensureContext(ctx); err != nil {
			compiled.error("COMPILATION_CANCELLED", fmt.Sprintf("/fixtures/%d", index), err.Error())

			return
		}

		preview := FixturePreview{
			Name:   fixture.Name,
			Kind:   fixture.Kind,
			Source: fixture.Input,
			Stages: []PreviewStage{},
		}
		path := fmt.Sprintf("/fixtures/%d", index)
		if strings.TrimSpace(fixture.Name) == "" {
			compiled.rejectFixture(&preview, path, "INVALID_FIXTURE", "Fixture name is required.")
			compiled.result.Previews = append(compiled.result.Previews, preview)

			continue
		}
		nodes := 0
		if err := validateValueDepth(fixture.Input, 0, &nodes); err != nil {
			compiled.rejectFixture(&preview, path+"/input", "FIXTURE_LIMIT_EXCEEDED", err.Error())
			compiled.result.Previews = append(compiled.result.Previews, preview)

			continue
		}

		var canonical any
		var generated any
		var err error
		switch fixture.Kind {
		case "telemetry":
			canonical, preview.Stages, err = compiled.previewTelemetry(ctx, fixture.Input)
		case "event":
			canonical, preview.Stages, err = compiled.previewEvents(ctx, fixture.Input)
		case "command_request":
			generated, preview.Stages, err = compiled.previewCommandRequest(ctx, fixture.Input)
		case "command_response":
			canonical, preview.Stages, err = compiled.previewCommandResponse(ctx, fixture.Input)
		case "reported_property":
			canonical, preview.Stages, err = compiled.previewReportedProperties(ctx, fixture.Input)
		case "desired_property":
			generated, preview.Stages, err = compiled.previewDesiredProperties(ctx, fixture.Input)
		default:
			err = fmt.Errorf("fixture kind %q is not supported", fixture.Kind)
		}

		if err != nil {
			compiled.rejectFixture(&preview, path, "FIXTURE_FAILED", err.Error())
			compiled.result.Previews = append(compiled.result.Previews, preview)

			continue
		}

		preview.Canonical = canonical
		preview.Generated = generated
		actual := canonical
		if generated != nil {
			actual = generated
		}
		if fixture.Expected != nil && !canonicalEqual(actual, fixture.Expected) {
			compiled.rejectFixture(&preview, path+"/expected", "FIXTURE_EXPECTATION_MISMATCH", "Compiler output does not match the expected fixture value.")
			compiled.result.Previews = append(compiled.result.Previews, preview)

			continue
		}

		preview.Valid = true
		compiled.result.Previews = append(compiled.result.Previews, preview)
	}
}

func (compiled *compilation) previewTelemetry(ctx context.Context, input any) (any, []PreviewStage, error) {
	channel, err := compiled.fixtureChannel("telemetry", input)
	if err != nil {
		return nil, nil, err
	}
	records, stage, err := selectRecords(channel, input)
	stages := []PreviewStage{stage}
	if err != nil {
		return nil, stages, err
	}

	mappings := make([]TelemetryMapping, 0)
	for _, mapping := range compiled.binding.Version.TelemetryMappings {
		if mapping.Channel == channel.Key {
			mappings = append(mappings, mapping)
		}
	}
	if len(mappings) == 0 {
		return nil, stages, fmt.Errorf("channel %q has no telemetry mappings", channel.Key)
	}

	canonicalRecords := make([]map[string]any, 0, len(records))
	for _, record := range records {
		envelope, envelopeStages, err := extractEnvelope(channel, input, record)
		stages = append(stages, envelopeStages...)
		if err != nil {
			return nil, stages, err
		}

		qualifiedValues := map[string]any{}
		outputValues := map[string]any{}
		for _, mapping := range mappings {
			entry := compiled.catalog.Telemetry[mapping.Target]
			value, mappingStages, omitted, err := compiled.extractMappedValue(
				ctx,
				mapping.Target,
				mapping.Source,
				mapping.WireDataType,
				mapping.Transform,
				mapping.MissingPolicy,
				mapping.DefaultValue,
				*entry.ValueSchema,
				input,
				record,
				qualifiedValues,
			)
			stages = append(stages, mappingStages...)
			if err != nil {
				return nil, stages, err
			}
			if omitted {
				continue
			}
			qualifiedValues[mapping.Target] = value
			outputValues[compiled.outputKey(mapping.Target)] = value
		}

		for _, target := range compiled.catalog.Derivations {
			telemetry := compiled.telemetryDefinition(target)
			if telemetry == nil || telemetry.Derivation == nil {
				continue
			}
			value, err := compiled.expressions.Evaluate(ctx, telemetry.Derivation.CEL, celVariables(input, record, nil, qualifiedValues, envelope))
			stage := PreviewStage{Stage: "derivation", Target: stringPointer(target)}
			if err != nil {
				stage.Status = "failed"
				stage.DiagnosticCode = stringPointer("CEL_EVALUATION_FAILED")
				stages = append(stages, stage)

				return nil, stages, fmt.Errorf("derive %s: %w", target, err)
			}
			entry := compiled.catalog.Telemetry[target]
			if err := validateSemanticValue(value, *entry.ValueSchema); err != nil {
				stage.Status = "failed"
				stage.DiagnosticCode = stringPointer("CONSTRAINT_VIOLATION")
				stages = append(stages, stage)

				return nil, stages, fmt.Errorf("derive %s: %w", target, err)
			}
			stage.Status = "passed"
			stage.Result = value
			stages = append(stages, stage)
			qualifiedValues[target] = value
			outputValues[compiled.outputKey(target)] = value
		}

		canonical := map[string]any{"values": outputValues}
		mergeEnvelope(canonical, envelope)
		canonicalRecords = append(canonicalRecords, canonical)
	}

	if len(canonicalRecords) == 1 {
		return canonicalRecords[0], stages, nil
	}

	return map[string]any{"records": canonicalRecords}, stages, nil
}

func (compiled *compilation) previewEvents(ctx context.Context, input any) (any, []PreviewStage, error) {
	channel, err := compiled.fixtureChannel("event", input)
	if err != nil {
		return nil, nil, err
	}
	records, stage, err := selectRecords(channel, input)
	stages := []PreviewStage{stage}
	if err != nil {
		return nil, stages, err
	}

	events := make([]map[string]any, 0)
	for _, record := range records {
		envelope, envelopeStages, err := extractEnvelope(channel, input, record)
		stages = append(stages, envelopeStages...)
		if err != nil {
			return nil, stages, err
		}
		for _, mapping := range compiled.binding.Version.EventMappings {
			if mapping.Channel != channel.Key {
				continue
			}
			matches, discriminatorStage, err := eventMatches(mapping, input, record)
			if discriminatorStage != nil {
				stages = append(stages, *discriminatorStage)
			}
			if err != nil {
				return nil, stages, err
			}
			if !matches {
				continue
			}

			entry := compiled.catalog.Events[mapping.Target]
			fields := map[string]any{}
			fieldSchemas := eventFieldSchemas(entry.Event)
			for _, fieldMapping := range mapping.FieldMappings {
				value, mappingStages, omitted, err := compiled.extractMappedValue(
					ctx,
					mapping.Target+"."+fieldMapping.Target,
					fieldMapping.Source,
					fieldMapping.WireDataType,
					fieldMapping.Transform,
					fieldMapping.MissingPolicy,
					fieldMapping.DefaultValue,
					fieldSchemas[fieldMapping.Target],
					input,
					record,
					fields,
				)
				stages = append(stages, mappingStages...)
				if err != nil {
					return nil, stages, err
				}
				if !omitted {
					fields[fieldMapping.Target] = value
				}
			}

			canonicalEvent := map[string]any{
				"target":   mapping.Target,
				"mode":     entry.Event.Mode,
				"severity": entry.Event.DefaultSeverity,
				"fields":   fields,
			}
			mergeEnvelope(canonicalEvent, envelope)
			if mapping.EventID != nil {
				if eventID, found, pathErr := scopedValue(*mapping.EventID, input, record); pathErr != nil {
					return nil, stages, pathErr
				} else if found {
					canonicalEvent["event_id"] = eventID
				}
			}
			if mapping.State != nil {
				state, found, pathErr := scopedValue(mapping.State.Path, input, record)
				if pathErr != nil {
					return nil, stages, pathErr
				}
				if found {
					state, pathErr = compiled.expressions.ApplyTransform(ctx, mapping.State.Transform, state, celVariables(input, record, state, fields, envelope))
					if pathErr != nil {
						return nil, stages, pathErr
					}
					canonicalEvent["state"] = state
				}
			}
			events = append(events, canonicalEvent)
		}
	}
	if len(events) == 0 {
		return nil, stages, errors.New("event fixture did not match any event mapping")
	}

	return map[string]any{"events": events}, stages, nil
}

func (compiled *compilation) previewCommandRequest(ctx context.Context, input any) (any, []PreviewStage, error) {
	object, ok := input.(map[string]any)
	if !ok {
		return nil, nil, errors.New("command request fixture input must be an object")
	}
	mapping, entry, err := compiled.commandMappingForFixture(object)
	if err != nil {
		return nil, nil, err
	}
	generated, err := deepCopyMap(mapping.RequestTemplate)
	if err != nil {
		return nil, nil, err
	}
	stages := []PreviewStage{}

	envelopeValues := []struct {
		name string
		path string
	}{
		{"command_id", mapping.RequestEnvelope.CommandIDPath},
		{"device_id", mapping.RequestEnvelope.DeviceIDPath},
		{"requested_at", mapping.RequestEnvelope.RequestedAtPath},
		{"expires_at", mapping.RequestEnvelope.ExpiresAtPath},
	}
	for _, envelopeValue := range envelopeValues {
		if envelopeValue.path == "" {
			continue
		}
		value, exists := object[envelopeValue.name]
		if !exists {
			if envelopeValue.name == "command_id" {
				return nil, stages, errors.New("command request fixture requires command_id")
			}
			continue
		}
		path, pathErr := parseRestrictedPath(envelopeValue.path, false)
		if pathErr != nil {
			return nil, stages, pathErr
		}
		if pathErr = path.Set(generated, value); pathErr != nil {
			return nil, stages, pathErr
		}
		stages = append(stages, PreviewStage{Stage: "placement", Status: "passed", Target: stringPointer(envelopeValue.name), Result: value})
	}

	fields, _ := object["fields"].(map[string]any)
	fieldSchemas := commandFieldSchemas(entry.Command)
	values := map[string]any{}
	for _, fieldMapping := range mapping.FieldMappings {
		if fieldMapping.Direction != "input" {
			continue
		}
		field := fieldSchemas[fieldMapping.Target]
		value, found := fields[fieldMapping.Target]
		if !found {
			value, found = object[fieldMapping.Target]
		}
		value, omitted, err := missingValue(value, found, fieldMapping.MissingPolicy, fieldMapping.DefaultValue)
		if err != nil {
			return nil, stages, fmt.Errorf("command field %s: %w", fieldMapping.Target, err)
		}
		if omitted {
			continue
		}
		if err := validateSemanticValue(value, field.ValueSchema); err != nil {
			return nil, stages, fmt.Errorf("command field %s: %w", fieldMapping.Target, err)
		}
		value, err = compiled.expressions.ApplyTransform(ctx, fieldMapping.Transform, value, celVariables(object, object, value, values, map[string]any{}))
		if err != nil {
			return nil, stages, fmt.Errorf("transform command field %s: %w", fieldMapping.Target, err)
		}
		value, err = coerceWireValue(value, fieldMapping.WireDataType)
		if err != nil {
			return nil, stages, fmt.Errorf("encode command field %s: %w", fieldMapping.Target, err)
		}
		path, err := parseRestrictedPath(fieldMapping.JSONPath, false)
		if err != nil {
			return nil, stages, err
		}
		if err := path.Set(generated, value); err != nil {
			return nil, stages, err
		}
		values[fieldMapping.Target] = value
		stages = append(stages,
			PreviewStage{Stage: "validation", Status: "passed", Target: stringPointer(fieldMapping.Target), Result: value},
			PreviewStage{Stage: "placement", Status: "passed", Target: stringPointer(fieldMapping.Target), Result: fieldMapping.JSONPath},
		)
	}

	return generated, stages, nil
}

func (compiled *compilation) previewCommandResponse(ctx context.Context, input any) (any, []PreviewStage, error) {
	object, ok := input.(map[string]any)
	if !ok {
		return nil, nil, errors.New("command response fixture input must be an object")
	}
	mapping, entry, err := compiled.commandMappingForFixture(object)
	if err != nil {
		return nil, nil, err
	}
	if mapping.Response == nil {
		return nil, nil, fmt.Errorf("command %q does not define a response", mapping.Target)
	}
	stages := []PreviewStage{}
	correlation, found, err := scopedValue(mapping.Response.Correlation, object, object)
	if err != nil || !found {
		return nil, stages, fmt.Errorf("command response correlation is missing")
	}
	stages = append(stages, PreviewStage{Stage: "correlation", Status: "passed", Target: stringPointer(mapping.Target), Result: correlation})
	statusValue, found, err := scopedValue(mapping.Response.Status.Path, object, object)
	if err != nil || !found {
		return nil, stages, errors.New("command response status is missing")
	}
	statusValue, err = compiled.expressions.ApplyTransform(ctx, mapping.Response.Status.Transform, statusValue, celVariables(object, object, statusValue, map[string]any{}, map[string]any{}))
	if err != nil {
		return nil, stages, fmt.Errorf("transform command status: %w", err)
	}
	status, ok := normalizeCommandStatus(statusValue, mapping.Response.Status.Values)
	if !ok {
		return nil, stages, fmt.Errorf("wire command status %q is not mapped", statusValue)
	}
	stages = append(stages, PreviewStage{Stage: "status", Status: "passed", Target: stringPointer(mapping.Target), Raw: statusValue, Result: status})

	fields := map[string]any{}
	fieldSchemas := commandFieldSchemas(entry.Command)
	for _, fieldMapping := range mapping.FieldMappings {
		if fieldMapping.Direction != "output" {
			continue
		}
		path, pathErr := parseRestrictedPath(fieldMapping.JSONPath, false)
		if pathErr != nil {
			return nil, stages, pathErr
		}
		raw, found := path.Get(object)
		value, omitted, pathErr := missingValue(raw, found, fieldMapping.MissingPolicy, fieldMapping.DefaultValue)
		if pathErr != nil {
			return nil, stages, fmt.Errorf("command output %s: %w", fieldMapping.Target, pathErr)
		}
		if omitted {
			continue
		}
		value, pathErr = coerceWireValue(value, fieldMapping.WireDataType)
		if pathErr != nil {
			return nil, stages, pathErr
		}
		value, pathErr = compiled.expressions.ApplyTransform(ctx, fieldMapping.Transform, value, celVariables(object, object, value, fields, map[string]any{}))
		if pathErr != nil {
			return nil, stages, pathErr
		}
		if pathErr = validateSemanticValue(value, fieldSchemas[fieldMapping.Target].ValueSchema); pathErr != nil {
			return nil, stages, pathErr
		}
		fields[fieldMapping.Target] = value
		stages = append(stages, PreviewStage{Stage: "extraction", Status: "passed", Target: stringPointer(fieldMapping.Target), Raw: raw, Result: value})
	}

	return map[string]any{
		"target":     mapping.Target,
		"command_id": correlation,
		"status":     status,
		"fields":     fields,
	}, stages, nil
}

func (compiled *compilation) previewReportedProperties(ctx context.Context, input any) (any, []PreviewStage, error) {
	channel, err := compiled.fixtureChannel("reported_properties", input)
	if err != nil {
		return nil, nil, err
	}
	records, stage, err := selectRecords(channel, input)
	stages := []PreviewStage{stage}
	if err != nil {
		return nil, stages, err
	}
	if len(records) != 1 {
		return nil, stages, errors.New("reported property fixture must select exactly one record")
	}
	values := map[string]any{}
	for _, mapping := range compiled.binding.Version.PropertyMappings {
		if mapping.Channel != channel.Key || mapping.Direction != "extract" {
			continue
		}
		scope := mapping.SourceScope
		if scope == "" {
			scope = "record"
		}
		entry := compiled.catalog.Properties[mapping.Target]
		value, mappingStages, omitted, mappingErr := compiled.extractMappedValue(
			ctx,
			mapping.Target,
			PathRef{Scope: scope, JSONPath: mapping.JSONPath},
			mapping.WireDataType,
			mapping.Transform,
			mapping.MissingPolicy,
			mapping.DefaultValue,
			*entry.ValueSchema,
			input,
			records[0],
			values,
		)
		stages = append(stages, mappingStages...)
		if mappingErr != nil {
			return nil, stages, mappingErr
		}
		if !omitted {
			values[compiled.outputKey(mapping.Target)] = value
		}
	}

	return map[string]any{"values": values}, stages, nil
}

func (compiled *compilation) previewDesiredProperties(ctx context.Context, input any) (any, []PreviewStage, error) {
	object, ok := input.(map[string]any)
	if !ok {
		return nil, nil, errors.New("desired property fixture input must be an object")
	}
	channel, err := compiled.fixtureChannel("desired_properties", input)
	if err != nil {
		return nil, nil, err
	}
	generated := map[string]any{}
	stages := []PreviewStage{}
	values, _ := object["values"].(map[string]any)
	for _, mapping := range compiled.binding.Version.PropertyMappings {
		if mapping.Channel != channel.Key || mapping.Direction != "place" {
			continue
		}
		entry := compiled.catalog.Properties[mapping.Target]
		value, found := values[compiled.outputKey(mapping.Target)]
		if !found {
			value, found = object[compiled.outputKey(mapping.Target)]
		}
		value, omitted, mappingErr := missingValue(value, found, mapping.MissingPolicy, mapping.DefaultValue)
		if mappingErr != nil {
			return nil, stages, mappingErr
		}
		if omitted {
			continue
		}
		if mappingErr = validateSemanticValue(value, *entry.ValueSchema); mappingErr != nil {
			return nil, stages, mappingErr
		}
		value, mappingErr = compiled.expressions.ApplyTransform(ctx, mapping.Transform, value, celVariables(object, object, value, values, map[string]any{}))
		if mappingErr != nil {
			return nil, stages, mappingErr
		}
		value, mappingErr = coerceWireValue(value, mapping.WireDataType)
		if mappingErr != nil {
			return nil, stages, mappingErr
		}
		path, mappingErr := parseRestrictedPath(mapping.JSONPath, false)
		if mappingErr != nil {
			return nil, stages, mappingErr
		}
		if mappingErr = path.Set(generated, value); mappingErr != nil {
			return nil, stages, mappingErr
		}
		stages = append(stages, PreviewStage{Stage: "placement", Status: "passed", Target: stringPointer(mapping.Target), Result: value})
	}

	return generated, stages, nil
}

func (compiled *compilation) extractMappedValue(
	ctx context.Context,
	target string,
	source PathRef,
	wireDataType string,
	transform *Transform,
	missingPolicy string,
	defaultValue any,
	valueSchema ValueSchema,
	payload any,
	record any,
	values map[string]any,
) (any, []PreviewStage, bool, error) {
	stages := []PreviewStage{}
	raw, found, err := scopedValue(source, payload, record)
	if err != nil {
		return nil, stages, false, err
	}
	value, omitted, err := missingValue(raw, found, missingPolicy, defaultValue)
	if err != nil {
		stages = append(stages, failedStage("extraction", target, "REQUIRED_VALUE_MISSING"))

		return nil, stages, false, fmt.Errorf("extract %s: %w", target, err)
	}
	if omitted {
		stages = append(stages, PreviewStage{Stage: "extraction", Status: "skipped", Target: stringPointer(target)})

		return nil, stages, true, nil
	}
	stages = append(stages, PreviewStage{Stage: "extraction", Status: "passed", Target: stringPointer(target), Raw: raw, Result: value})

	value, err = coerceWireValue(value, wireDataType)
	if err != nil {
		stages = append(stages, failedStage("coercion", target, "WIRE_TYPE_COERCION_FAILED"))

		return nil, stages, false, fmt.Errorf("coerce %s: %w", target, err)
	}
	stages = append(stages, PreviewStage{Stage: "coercion", Status: "passed", Target: stringPointer(target), Result: value})

	value, err = compiled.expressions.ApplyTransform(ctx, transform, value, celVariables(payload, record, value, values, map[string]any{}))
	if err != nil {
		stages = append(stages, failedStage("transformation", target, "CEL_EVALUATION_FAILED"))

		return nil, stages, false, fmt.Errorf("transform %s: %w", target, err)
	}
	transformationStatus := "skipped"
	if transform != nil {
		transformationStatus = "passed"
	}
	stages = append(stages, PreviewStage{Stage: "transformation", Status: transformationStatus, Target: stringPointer(target), Result: value})

	if err := validateSemanticValue(value, valueSchema); err != nil {
		stages = append(stages, failedStage("validation", target, "CONSTRAINT_VIOLATION"))

		return nil, stages, false, fmt.Errorf("validate %s: %w", target, err)
	}
	stages = append(stages, PreviewStage{Stage: "validation", Status: "passed", Target: stringPointer(target), Result: value})

	return value, stages, false, nil
}

func (compiled *compilation) fixtureChannel(purpose string, input any) (Channel, error) {
	candidates := make([]Channel, 0)
	for _, channel := range compiled.channels {
		if channel.Purpose == purpose {
			candidates = append(candidates, channel)
		}
	}
	sort.Slice(candidates, func(left, right int) bool { return candidates[left].Key < candidates[right].Key })
	if len(candidates) == 0 {
		return Channel{}, fmt.Errorf("no %s channel is defined", purpose)
	}
	if len(candidates) == 1 {
		return candidates[0], nil
	}

	matched := make([]Channel, 0)
	for _, channel := range candidates {
		if _, _, err := selectRecords(channel, input); err == nil {
			matched = append(matched, channel)
		}
	}
	if len(matched) == 1 {
		return matched[0], nil
	}

	return Channel{}, fmt.Errorf("fixture is ambiguous across %d %s channels", len(candidates), purpose)
}

func selectRecords(channel Channel, input any) ([]any, PreviewStage, error) {
	path, err := parseRestrictedPath(channel.RecordPath, true)
	stage := PreviewStage{Stage: "record_selection", Target: stringPointer(channel.Key), Raw: channel.RecordPath}
	if err != nil {
		stage.Status = "failed"
		stage.DiagnosticCode = stringPointer("UNSUPPORTED_JSONPATH")

		return nil, stage, err
	}
	selected, found := path.Get(input)
	if !found {
		stage.Status = "failed"
		stage.DiagnosticCode = stringPointer("RECORD_SELECTION_FAILED")

		return nil, stage, fmt.Errorf("record path %s did not match input", channel.RecordPath)
	}
	records := []any{selected}
	if path.Wildcard {
		array, ok := selected.([]any)
		if !ok {
			stage.Status = "failed"
			stage.DiagnosticCode = stringPointer("RECORD_SELECTION_FAILED")

			return nil, stage, errors.New("wildcard record path did not select an array")
		}
		records = array
	}
	if len(records) == 0 || len(records) > channel.MaxRecords || len(records) > maximumRecords {
		stage.Status = "failed"
		stage.DiagnosticCode = stringPointer("RECORD_LIMIT_EXCEEDED")

		return nil, stage, fmt.Errorf("selected %d records; channel limit is %d", len(records), channel.MaxRecords)
	}
	stage.Status = "passed"
	stage.Result = len(records)

	return records, stage, nil
}

func extractEnvelope(channel Channel, payload, record any) (map[string]any, []PreviewStage, error) {
	envelope := map[string]any{}
	stages := []PreviewStage{}
	if channel.Envelope.DeviceID != nil {
		value, found, err := scopedValue(*channel.Envelope.DeviceID, payload, record)
		if err != nil || !found {
			stages = append(stages, failedStage("envelope", "device_id", "ENVELOPE_EXTRACTION_FAILED"))

			return nil, stages, errors.New("device_id envelope value is missing")
		}
		envelope["device_id"] = value
		stages = append(stages, PreviewStage{Stage: "envelope", Status: "passed", Target: stringPointer("device_id"), Result: value})
	}
	if channel.Envelope.ObservedAt != nil {
		value, found, err := scopedValue(channel.Envelope.ObservedAt.Path, payload, record)
		if err != nil || !found {
			stages = append(stages, failedStage("envelope", "observed_at", "ENVELOPE_EXTRACTION_FAILED"))

			return nil, stages, errors.New("observed_at envelope value is missing")
		}
		observedAt, err := normalizeTimestamp(value, channel.Envelope.ObservedAt.Format)
		if err != nil {
			stages = append(stages, failedStage("envelope", "observed_at", "TIMESTAMP_COERCION_FAILED"))

			return nil, stages, err
		}
		envelope["observed_at"] = observedAt
		stages = append(stages, PreviewStage{Stage: "envelope", Status: "passed", Target: stringPointer("observed_at"), Raw: value, Result: observedAt})
	}
	if channel.Envelope.MessageID != nil {
		value, found, err := scopedValue(*channel.Envelope.MessageID, payload, record)
		if err != nil || !found {
			stages = append(stages, failedStage("envelope", "message_id", "ENVELOPE_EXTRACTION_FAILED"))

			return nil, stages, errors.New("message_id envelope value is missing")
		}
		envelope["message_id"] = value
		stages = append(stages, PreviewStage{Stage: "envelope", Status: "passed", Target: stringPointer("message_id"), Result: value})
	}

	return envelope, stages, nil
}

func eventMatches(mapping EventMapping, payload, record any) (bool, *PreviewStage, error) {
	if mapping.Discriminator == nil {
		return true, nil, nil
	}
	value, found, err := scopedValue(mapping.Discriminator.Path, payload, record)
	stage := PreviewStage{Stage: "extraction", Target: stringPointer(mapping.Target), Raw: value}
	if err != nil {
		stage.Status = "failed"
		stage.DiagnosticCode = stringPointer("EVENT_DISCRIMINATOR_FAILED")

		return false, &stage, err
	}
	if !found || !scalarEqual(value, mapping.Discriminator.Equals) {
		stage.Status = "skipped"

		return false, &stage, nil
	}
	stage.Status = "passed"
	stage.Result = mapping.Discriminator.Equals

	return true, &stage, nil
}

func (compiled *compilation) commandMappingForFixture(input map[string]any) (CommandMapping, capability, error) {
	target, _ := input["target"].(string)
	if target != "" {
		for _, mapping := range compiled.binding.Version.CommandMappings {
			if mapping.Target == target {
				return mapping, compiled.catalog.Commands[target], nil
			}
		}

		return CommandMapping{}, capability{}, fmt.Errorf("command target %q is not mapped", target)
	}
	if len(compiled.binding.Version.CommandMappings) != 1 {
		return CommandMapping{}, capability{}, errors.New("command fixture requires target when more than one Command is mapped")
	}
	mapping := compiled.binding.Version.CommandMappings[0]

	return mapping, compiled.catalog.Commands[mapping.Target], nil
}

func normalizeCommandStatus(value any, statuses StatusValues) (string, bool) {
	text, ok := value.(string)
	if !ok {
		return "", false
	}
	groups := []struct {
		name   string
		values []string
	}{
		{"accepted", statuses.Accepted},
		{"running", statuses.Running},
		{"succeeded", statuses.Succeeded},
		{"failed", statuses.Failed},
	}
	for _, group := range groups {
		for _, candidate := range group.values {
			if text == candidate {
				return group.name, true
			}
		}
	}

	return "", false
}

func missingValue(value any, found bool, policy string, defaultValue any) (any, bool, error) {
	if found && value != nil {
		return value, false, nil
	}
	switch policy {
	case "omit_value":
		return nil, true, nil
	case "use_default":
		return defaultValue, false, nil
	case "reject_message":
		return nil, false, errors.New("required wire value is missing")
	default:
		return nil, false, fmt.Errorf("unsupported missing policy %q", policy)
	}
}

func coerceWireValue(value any, dataType string) (any, error) {
	switch dataType {
	case "float64":
		number, ok := numericValue(value)
		if !ok {
			if text, textOK := value.(string); textOK {
				parsed, err := strconv.ParseFloat(text, 64)
				if err == nil {
					return parsed, nil
				}
			}

			return nil, errors.New("value is not coercible to float64")
		}

		return number, nil
	case "int64":
		switch typed := value.(type) {
		case json.Number:
			return typed.Int64()
		case int64:
			return typed, nil
		case int:
			return int64(typed), nil
		case float64:
			if math.Trunc(typed) == typed && typed >= math.MinInt64 && typed <= math.MaxInt64 {
				return int64(typed), nil
			}
		case string:
			return strconv.ParseInt(typed, 10, 64)
		}

		return nil, errors.New("value is not coercible to int64")
	case "uint64":
		switch typed := value.(type) {
		case json.Number:
			return strconv.ParseUint(typed.String(), 10, 64)
		case uint64:
			return typed, nil
		case int64:
			if typed >= 0 {
				return uint64(typed), nil
			}
		case int:
			if typed >= 0 {
				return uint64(typed), nil
			}
		case float64:
			if math.Trunc(typed) == typed && typed >= 0 && typed <= math.MaxUint64 {
				return uint64(typed), nil
			}
		case string:
			return strconv.ParseUint(typed, 10, 64)
		}

		return nil, errors.New("value is not coercible to uint64")
	case "boolean":
		if boolean, ok := value.(bool); ok {
			return boolean, nil
		}
		if text, ok := value.(string); ok {
			return strconv.ParseBool(text)
		}

		return nil, errors.New("value is not coercible to boolean")
	case "string", "state":
		if text, ok := value.(string); ok {
			return text, nil
		}

		return nil, errors.New("value is not a string")
	case "bytes":
		text, ok := value.(string)
		if !ok {
			return nil, errors.New("bytes value must be base64 text")
		}
		if _, err := base64.StdEncoding.DecodeString(text); err != nil {
			return nil, errors.New("bytes value is not valid base64")
		}

		return text, nil
	default:
		return nil, fmt.Errorf("unsupported wire data type %q", dataType)
	}
}

func validateSemanticValue(value any, schema ValueSchema) error {
	coerced, err := coerceWireValue(value, schema.DataType)
	if err != nil {
		return err
	}
	constraints := schema.Constraints
	if number, ok := numericValue(coerced); ok {
		if constraints.Minimum != nil {
			if constraints.ExclusiveMinimum && number <= *constraints.Minimum || !constraints.ExclusiveMinimum && number < *constraints.Minimum {
				return fmt.Errorf("value %v is below minimum %v", number, *constraints.Minimum)
			}
		}
		if constraints.Maximum != nil {
			if constraints.ExclusiveMaximum && number >= *constraints.Maximum || !constraints.ExclusiveMaximum && number > *constraints.Maximum {
				return fmt.Errorf("value %v is above maximum %v", number, *constraints.Maximum)
			}
		}
		if constraints.MultipleOf != nil {
			quotient := number / *constraints.MultipleOf
			if math.Abs(quotient-math.Round(quotient)) > 1e-9 {
				return fmt.Errorf("value %v is not a multiple of %v", number, *constraints.MultipleOf)
			}
		}
	}
	if text, ok := coerced.(string); ok {
		length := len([]rune(text))
		if constraints.MinLength != nil && length < *constraints.MinLength {
			return fmt.Errorf("string length %d is below minimum %d", length, *constraints.MinLength)
		}
		if constraints.MaxLength != nil && length > *constraints.MaxLength {
			return fmt.Errorf("string length %d exceeds maximum %d", length, *constraints.MaxLength)
		}
		if constraints.Pattern != "" {
			pattern, patternErr := regexp.Compile(constraints.Pattern)
			if patternErr != nil || !pattern.MatchString(text) {
				return fmt.Errorf("string does not match pattern %q", constraints.Pattern)
			}
		}
	}
	if len(constraints.AllowedValues) > 0 {
		allowed := false
		for _, candidate := range constraints.AllowedValues {
			if scalarEqual(coerced, candidate) {
				allowed = true
				break
			}
		}
		if !allowed {
			return errors.New("value is not in allowed_values")
		}
	}

	return nil
}

func normalizeTimestamp(value any, format string) (string, error) {
	var timestamp time.Time
	var err error
	switch format {
	case "rfc3339":
		text, ok := value.(string)
		if !ok {
			return "", errors.New("RFC3339 timestamp must be a string")
		}
		timestamp, err = time.Parse(time.RFC3339Nano, text)
	case "unix_seconds", "unix_milliseconds":
		number, ok := numericValue(value)
		if !ok {
			return "", errors.New("Unix timestamp must be numeric")
		}
		seconds := number
		if format == "unix_milliseconds" {
			seconds /= 1000
		}
		whole, fraction := math.Modf(seconds)
		timestamp = time.Unix(int64(whole), int64(fraction*float64(time.Second)))
	default:
		return "", fmt.Errorf("unsupported timestamp format %q", format)
	}
	if err != nil {
		return "", err
	}

	return timestamp.UTC().Format(time.RFC3339Nano), nil
}

func celVariables(payload, record, value any, values, envelope map[string]any) map[string]any {
	return map[string]any{
		"payload":     normalizeForCEL(payload),
		"record":      normalizeForCEL(record),
		"value":       normalizeForCEL(value),
		"values":      normalizeForCEL(values),
		"topic":       "",
		"observed_at": envelope["observed_at"],
		"received_at": nil,
		"device":      map[string]any{"id": envelope["device_id"]},
		"message":     envelope,
		"bundle":      map[string]any{},
	}
}

func mergeEnvelope(target, envelope map[string]any) {
	for key, value := range envelope {
		target[key] = value
	}
}

func (compiled *compilation) outputKey(target string) string {
	local := localKey(target)
	count := 0
	for qualified := range compiled.catalog.Capabilities {
		if localKey(qualified) == local {
			count++
		}
	}
	if count == 1 {
		return local
	}

	return target
}

func (compiled *compilation) rejectFixture(preview *FixturePreview, path, code, message string) {
	preview.Valid = false
	preview.Stages = append(preview.Stages, PreviewStage{
		Stage:          "validation",
		Status:         "failed",
		DiagnosticCode: stringPointer(code),
	})
	compiled.error(code, path, message)
}

func failedStage(stage, target, code string) PreviewStage {
	return PreviewStage{
		Stage:          stage,
		Status:         "failed",
		Target:         stringPointer(target),
		DiagnosticCode: stringPointer(code),
	}
}

func stringPointer(value string) *string {
	return &value
}
