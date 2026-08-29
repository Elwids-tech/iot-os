package definition

import (
	"context"
	"errors"
	"fmt"
	"time"
)

func (compiler *Compiler) EncodeCommand(
	ctx context.Context,
	profile ProfileArtifact,
	bundle RuntimeBundle,
	commandUUID string,
	invocation CommandInvocation,
) (map[string]any, error) {
	command, pipeline, err := commandDefinition(profile, bundle, commandUUID)
	if err != nil {
		return nil, err
	}
	if invocation.CommandID == "" {
		return nil, errors.New("command ID is required")
	}

	payload := map[string]any{}
	if pipeline.Mapping.RequestTemplate != nil {
		payload, err = deepCopyMap(pipeline.Mapping.RequestTemplate)
		if err != nil {
			return nil, fmt.Errorf("copy Command request template: %w", err)
		}
	}

	if err := placeValue(payload, pipeline.Mapping.RequestEnvelope.CommandIDPath, invocation.CommandID); err != nil {
		return nil, fmt.Errorf("place command ID: %w", err)
	}
	if path := pipeline.Mapping.RequestEnvelope.RequestedAtPath; path != nil {
		if invocation.RequestedAt == "" {
			return nil, errors.New("requested_at is required by the Command request envelope")
		}
		if _, err := time.Parse(time.RFC3339Nano, invocation.RequestedAt); err != nil {
			return nil, fmt.Errorf("requested_at must be RFC3339: %w", err)
		}
		if err := placeValue(payload, *path, invocation.RequestedAt); err != nil {
			return nil, fmt.Errorf("place requested_at: %w", err)
		}
	}
	if path := pipeline.Mapping.RequestEnvelope.ExpiresAtPath; path != nil {
		if invocation.ExpiresAt == "" {
			return nil, errors.New("expires_at is required by the Command request envelope")
		}
		if _, err := time.Parse(time.RFC3339Nano, invocation.ExpiresAt); err != nil {
			return nil, fmt.Errorf("expires_at must be RFC3339: %w", err)
		}
		if err := placeValue(payload, *path, invocation.ExpiresAt); err != nil {
			return nil, fmt.Errorf("place expires_at: %w", err)
		}
	}
	if path := pipeline.Mapping.RequestEnvelope.RoutePathPath; path != nil {
		if err := placeValue(payload, *path, bundle.RoutePath); err != nil {
			return nil, fmt.Errorf("place route path: %w", err)
		}
	}
	for key, path := range pipeline.Mapping.RequestEnvelope.RouteVariablePaths {
		value, exists := routeVariableValue(bundle, key)
		if !exists {
			return nil, fmt.Errorf("route variable %s is not available in the Runtime Bundle", key)
		}
		if err := placeValue(payload, path, value); err != nil {
			return nil, fmt.Errorf("place route variable %s: %w", key, err)
		}
	}

	fields := make(map[string]CommandField, len(command.Fields))
	for _, field := range command.Fields {
		fields[field.UUID] = field
	}
	for _, mapping := range pipeline.Mapping.FieldMappings {
		if mapping.Direction != "input" {
			continue
		}
		field, exists := fields[mapping.TargetCommandFieldUUID]
		if !exists {
			return nil, fmt.Errorf("Command input field %s is not present in Profile artifact", mapping.TargetCommandFieldUUID)
		}
		value, present := invocation.Inputs[field.UUID]
		if !present {
			value, present = invocation.Inputs[field.Key]
		}
		if !present {
			value, present, err = missingMappedValue(mapping.OnMissing, mapping.DefaultValue)
			if err != nil || field.Required {
				return nil, fmt.Errorf("required Command input %s is missing", field.UUID)
			}
			if !present {
				continue
			}
		}

		semantic, err := validateSemanticValue(value, field.ValueSchema)
		if err != nil {
			if mapping.OnInvalid == "accept_with_bad_quality" {
				return nil, fmt.Errorf("validate Command input %s: invalid values cannot be published with bad quality", field.UUID)
			}
			semantic, present, err = invalidMappedValue(mapping.OnInvalid, mapping.DefaultValue, value, field.ValueSchema)
			if err != nil {
				return nil, fmt.Errorf("validate Command input %s: %w", field.UUID, err)
			}
			if !present {
				continue
			}
		}
		wire, err := applyOperations(ctx, compiler.expressions, mapping.Operations, semantic, map[string]any{
			"command":         invocation.Inputs,
			"route_variables": map[string]string{},
		})
		if err != nil {
			return nil, fmt.Errorf("encode Command input %s: %w", field.UUID, err)
		}
		wire, err = coerceValue(wire, mapping.WireDataType)
		if err != nil {
			return nil, fmt.Errorf("coerce Command input %s to wire type: %w", field.UUID, err)
		}
		if err := placeValue(payload, mapping.JSONPath, wire); err != nil {
			return nil, fmt.Errorf("place Command input %s: %w", field.UUID, err)
		}
	}

	return payload, nil
}

func (compiler *Compiler) DecodeCommandResponse(
	ctx context.Context,
	profile ProfileArtifact,
	bundle RuntimeBundle,
	commandUUID string,
	payload any,
) (DecodedCommandResponse, error) {
	command, pipeline, err := commandDefinition(profile, bundle, commandUUID)
	if err != nil {
		return DecodedCommandResponse{}, err
	}
	if pipeline.Mapping.Response == nil || pipeline.ResponseTopic == nil {
		return DecodedCommandResponse{}, errors.New("Command has no correlated Device response mapping")
	}

	response := pipeline.Mapping.Response
	correlation, found, err := scopedValue(response.Correlation, payload, payload, payload)
	if err != nil {
		return DecodedCommandResponse{}, fmt.Errorf("extract response correlation: %w", err)
	}
	if !found {
		return DecodedCommandResponse{}, errors.New("correlated Device response is missing command ID")
	}
	correlationID, ok := correlation.(string)
	if !ok || correlationID == "" {
		return DecodedCommandResponse{}, errors.New("correlated Device response command ID must be a non-empty string")
	}

	statusValue, found, err := scopedValue(response.Status.Path, payload, payload, payload)
	if err != nil {
		return DecodedCommandResponse{}, fmt.Errorf("extract Device response status: %w", err)
	}
	if !found {
		return DecodedCommandResponse{}, errors.New("correlated Device response is missing status")
	}
	status, ok := mappedCommandStatus(response.Status.Values, statusValue)
	if !ok {
		return DecodedCommandResponse{}, fmt.Errorf("Device response status value %v is not mapped", statusValue)
	}

	fields := make(map[string]CommandField, len(command.Fields))
	for _, field := range command.Fields {
		fields[field.UUID] = field
	}
	outputs := map[string]any{}
	for _, mapping := range pipeline.Mapping.FieldMappings {
		if mapping.Direction != "output" {
			continue
		}
		field, exists := fields[mapping.TargetCommandFieldUUID]
		if !exists {
			return DecodedCommandResponse{}, fmt.Errorf("Command output field %s is not present in Profile artifact", mapping.TargetCommandFieldUUID)
		}
		path, err := parseRestrictedPath(mapping.JSONPath, false)
		if err != nil {
			return DecodedCommandResponse{}, fmt.Errorf("parse Command output path: %w", err)
		}
		value, found := path.Get(payload)
		if !found {
			value, found, err = missingMappedValue(mapping.OnMissing, mapping.DefaultValue)
			if err != nil || field.Required {
				return DecodedCommandResponse{}, fmt.Errorf("required Command output %s is missing", field.UUID)
			}
			if !found {
				continue
			}
		}
		candidate := value
		wire, err := coerceValue(value, mapping.WireDataType)
		if err != nil {
			return DecodedCommandResponse{}, fmt.Errorf("coerce Command output %s from wire type: %w", field.UUID, err)
		}
		candidate = wire
		semantic, err := applyOperations(ctx, compiler.expressions, mapping.Operations, wire, map[string]any{
			"message": payload,
			"record":  payload,
			"route":   payload,
		})
		if err == nil {
			candidate = semantic
		}
		if err == nil {
			semantic, err = validateSemanticValue(semantic, field.ValueSchema)
		}
		if err != nil {
			semantic, found, err = invalidMappedValue(mapping.OnInvalid, mapping.DefaultValue, candidate, field.ValueSchema)
			if err != nil {
				return DecodedCommandResponse{}, fmt.Errorf("validate Command output %s: %w", field.UUID, err)
			}
			if !found {
				continue
			}
		}
		outputs[field.UUID] = semantic
	}

	return DecodedCommandResponse{
		CorrelationID: correlationID,
		Status:        status,
		Terminal:      status == "succeeded" || status == "failed",
		Succeeded:     status == "succeeded",
		Outputs:       outputs,
	}, nil
}

func commandDefinition(
	profile ProfileArtifact,
	bundle RuntimeBundle,
	commandUUID string,
) (Command, CommandPipeline, error) {
	var command Command
	foundCommand := false
	for _, candidate := range profile.Commands {
		if candidate.UUID == commandUUID {
			command = candidate
			foundCommand = true
			break
		}
	}
	if !foundCommand {
		return Command{}, CommandPipeline{}, fmt.Errorf("Command %s is not present in Profile artifact", commandUUID)
	}
	for _, pipeline := range bundle.CommandPipelines {
		if pipeline.CommandUUID == commandUUID {
			return command, pipeline, nil
		}
	}

	return Command{}, CommandPipeline{}, fmt.Errorf("Command %s has no Runtime Bundle pipeline", commandUUID)
}

func placeValue(payload map[string]any, pathValue string, value any) error {
	path, err := parseRestrictedPath(pathValue, false)
	if err != nil {
		return err
	}

	return path.Set(payload, value)
}

func routeVariableValue(bundle RuntimeBundle, key string) (string, bool) {
	switch key {
	case "route_path":
		return bundle.RoutePath, true
	case "device_uuid":
		return bundle.DeviceUUID, true
	case "gateway_uuid":
		return bundle.GatewayUUID, true
	case "organization_uuid":
		return bundle.OrganizationUUID, true
	default:
		return "", false
	}
}

func missingMappedValue(policy string, defaultValue any) (any, bool, error) {
	switch policy {
	case "omit_value":
		return nil, false, nil
	case "use_default":
		return defaultValue, true, nil
	case "reject_message":
		return nil, false, errors.New("mapping rejects a missing value")
	default:
		return nil, false, fmt.Errorf("unsupported missing-value policy %q", policy)
	}
}

func invalidMappedValue(
	policy string,
	defaultValue any,
	value any,
	schema ValueSchema,
) (any, bool, error) {
	switch policy {
	case "omit_value":
		return nil, false, nil
	case "use_default":
		validated, err := validateSemanticValue(defaultValue, schema)

		return validated, err == nil, err
	case "clamp":
		clamped, err := clampToSchema(value, schema)

		return clamped, err == nil, err
	case "accept_with_bad_quality":
		coerced, err := coerceValue(value, schema.DataType)

		return coerced, err == nil, err
	case "reject_message":
		return nil, false, errors.New("mapping rejects an invalid value")
	default:
		return nil, false, fmt.Errorf("unsupported invalid-value policy %q", policy)
	}
}

func mappedCommandStatus(values CommandStatusValues, value any) (string, bool) {
	sets := []struct {
		status string
		items  []any
	}{
		{status: "accepted", items: values.Accepted},
		{status: "running", items: values.Running},
		{status: "succeeded", items: values.Succeeded},
		{status: "failed", items: values.Failed},
	}
	for _, set := range sets {
		for _, candidate := range set.items {
			if scalarEqual(value, candidate) {
				return set.status, true
			}
		}
	}

	return "", false
}
