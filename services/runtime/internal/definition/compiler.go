package definition

import (
	"context"
	"fmt"
	"sort"
)

type Compiler struct {
	expressions *expressionCompiler
}

type compilePlan struct {
	parameters       map[string]Parameter
	derived          map[string]DerivedParameter
	derivedOrder     []DerivedParameter
	properties       map[string]Property
	events           map[string]Event
	eventFields      map[string]EventField
	commands         map[string]Command
	commandFields    map[string]commandFieldTarget
	channels         map[string]Channel
	inboundScopes    map[string]InboundScope
	resolvedChannels []ResolvedChannel
}

type commandFieldTarget struct {
	CommandUUID string
	Field       CommandField
}

func NewCompiler() (*Compiler, error) {
	expressions, err := newExpressionCompiler()
	if err != nil {
		return nil, err
	}

	return &Compiler{expressions: expressions}, nil
}

func DecodeCompileRequest(payload []byte) (CompileRequest, error) {
	var request CompileRequest
	if err := decodeStrict(payload, &request); err != nil {
		return CompileRequest{}, err
	}

	return request, nil
}

func (compiler *Compiler) Compile(ctx context.Context, request CompileRequest) (CompileResult, error) {
	if err := ctx.Err(); err != nil {
		return CompileResult{}, err
	}

	if err := validateJSONStructure(request); err != nil {
		return CompileResult{}, err
	}

	inputHash, err := canonicalHash(request)
	if err != nil {
		return CompileResult{}, fmt.Errorf("hash compile request: %w", err)
	}

	metadata := compilerMetadata()
	result := CompileResult{
		Schema:      CompileResultSchema,
		InputHash:   inputHash,
		Compiler:    metadata,
		Diagnostics: []Diagnostic{},
		Previews:    []FixturePreview{},
	}

	collector := &diagnosticCollector{}
	plan := compiler.validate(request, collector)
	if collector.hasErrors() {
		result.Diagnostics = collector.sorted()

		return result, nil
	}

	profileSourceHash, err := canonicalHash(request.Profile)
	if err != nil {
		return CompileResult{}, fmt.Errorf("hash Profile source: %w", err)
	}
	profileArtifact := buildProfileArtifact(request.Profile, metadata, profileSourceHash)
	profileArtifactHash, err := canonicalHash(profileArtifact)
	if err != nil {
		return CompileResult{}, fmt.Errorf("hash Profile artifact: %w", err)
	}

	bindingSourceHash, err := canonicalHash(request.Binding)
	if err != nil {
		return CompileResult{}, fmt.Errorf("hash Binding source: %w", err)
	}
	bindingArtifact := buildBindingArtifact(
		request.Binding,
		metadata,
		profileArtifactHash,
		bindingSourceHash,
	)
	bindingArtifactHash, err := canonicalHash(bindingArtifact)
	if err != nil {
		return CompileResult{}, fmt.Errorf("hash Binding artifact: %w", err)
	}

	routeSource := struct {
		OrganizationUUID string               `json:"organization_uuid"`
		Gateway          GatewayDocument      `json:"gateway"`
		Route            GatewayRouteDocument `json:"route"`
	}{
		OrganizationUUID: request.OrganizationUUID,
		Gateway:          request.Gateway,
		Route:            request.Route,
	}
	routeSourceHash, err := canonicalHash(routeSource)
	if err != nil {
		return CompileResult{}, fmt.Errorf("hash Gateway Route source: %w", err)
	}

	runtimeBundle, err := buildRuntimeBundle(
		request,
		metadata,
		profileArtifactHash,
		bindingArtifactHash,
		routeSourceHash,
		plan,
	)
	if err != nil {
		return CompileResult{}, fmt.Errorf("build Runtime Bundle: %w", err)
	}
	runtimeBundleHash, err := canonicalHash(runtimeBundle)
	if err != nil {
		return CompileResult{}, fmt.Errorf("hash Runtime Bundle: %w", err)
	}
	runtimeBundle.RuntimeBundleHash = runtimeBundleHash

	result.ProfileArtifact = &profileArtifact
	result.BindingArtifact = &bindingArtifact
	result.RuntimeBundle = &runtimeBundle
	result.ArtifactHashes = ArtifactHashes{
		Profile:       stringPointer(profileArtifactHash),
		Binding:       stringPointer(bindingArtifactHash),
		RuntimeBundle: stringPointer(runtimeBundleHash),
	}

	for index, fixture := range request.Fixtures {
		preview := compiler.previewFixture(ctx, request, profileArtifact, runtimeBundle, plan, index, fixture)
		result.Previews = append(result.Previews, preview)
	}

	result.Diagnostics = collector.sorted()
	result.Valid = !collector.hasErrors()
	for _, preview := range result.Previews {
		if !preview.Accepted {
			result.Valid = false
			break
		}
	}

	return result, nil
}

func compilerMetadata() CompilerMetadata {
	return CompilerMetadata{
		Name:            compilerName,
		Version:         compilerVersion,
		CELEnvironment:  celEnvironment,
		JSONPathVersion: jsonPathVersion,
		UnitRegistry:    unitRegistry,
	}
}

func buildProfileArtifact(
	document ProfileDocument,
	metadata CompilerMetadata,
	sourceHash string,
) ProfileArtifact {
	return ProfileArtifact{
		Schema:             ProfileArtifactSchema,
		ProfileUUID:        document.Profile.UUID,
		ProfileKey:         document.Profile.Key,
		ProfileVersionUUID: document.Version.UUID,
		Version:            document.Version.Version,
		SourceHash:         sourceHash,
		Compiler:           metadata,
		Parameters:         nonNil(document.Version.Parameters),
		DerivedParameters:  nonNil(document.Version.DerivedParameters),
		Properties:         nonNil(document.Version.Properties),
		Events:             nonNil(document.Version.Events),
		Commands:           nonNil(document.Version.Commands),
	}
}

func buildBindingArtifact(
	document BindingDocument,
	metadata CompilerMetadata,
	profileArtifactHash string,
	sourceHash string,
) BindingArtifact {
	return BindingArtifact{
		Schema:              BindingArtifactSchema,
		BindingUUID:         document.Binding.UUID,
		BindingKey:          document.Binding.Key,
		BindingVersionUUID:  document.Version.UUID,
		Version:             document.Version.Version,
		ProfileUUID:         document.Binding.ProfileUUID,
		ProfileVersionUUID:  document.Version.ProfileVersionUUID,
		ProfileArtifactHash: profileArtifactHash,
		SourceHash:          sourceHash,
		Compiler:            metadata,
		Channels:            nonNil(document.Version.Channels),
		ParameterMappings:   nonNil(document.Version.ParameterMappings),
		PropertyMappings:    nonNil(document.Version.PropertyMappings),
		EventMappings:       nonNil(document.Version.EventMappings),
		CommandMappings:     nonNil(document.Version.CommandMappings),
	}
}

func buildRuntimeBundle(
	request CompileRequest,
	metadata CompilerMetadata,
	profileArtifactHash string,
	bindingArtifactHash string,
	routeSourceHash string,
	plan compilePlan,
) (RuntimeBundle, error) {
	parameterPipelines := make([]ParameterPipeline, 0, len(request.Binding.Version.ParameterMappings))
	for _, mapping := range request.Binding.Version.ParameterMappings {
		parameter, exists := plan.parameters[mapping.TargetParameterUUID]
		if !exists {
			continue
		}
		parameterPipelines = append(parameterPipelines, ParameterPipeline{
			Mapping:        mapping,
			TargetDataType: parameter.ValueSchema.DataType,
		})
	}
	sort.SliceStable(parameterPipelines, func(left, right int) bool {
		return parameterPipelines[left].Mapping.UUID < parameterPipelines[right].Mapping.UUID
	})

	derivedPipelines := make([]DerivedPipeline, 0, len(plan.derivedOrder))
	for index, parameter := range plan.derivedOrder {
		derivedPipelines = append(derivedPipelines, DerivedPipeline{
			ParameterUUID:            parameter.UUID,
			TargetDataType:           parameter.ValueSchema.DataType,
			Expression:               parameter.Expression,
			DependencyParameterUUIDs: nonNil(parameter.Dependencies),
			EvaluationOrder:          index,
		})
	}

	resolvedTopicByChannel := make(map[string]string, len(plan.resolvedChannels))
	for _, channel := range plan.resolvedChannels {
		resolvedTopicByChannel[channel.Key] = channel.Topic
	}
	commandPipelines := make([]CommandPipeline, 0, len(request.Binding.Version.CommandMappings))
	for _, mapping := range request.Binding.Version.CommandMappings {
		compiledMapping := mapping
		var err error
		compiledMapping.RequestTemplate, err = deepCopyMap(mapping.RequestTemplate)
		if err != nil {
			return RuntimeBundle{}, fmt.Errorf("copy Command request template %s: %w", mapping.UUID, err)
		}
		for key, path := range mapping.RequestEnvelope.RouteVariablePaths {
			value, _ := commandEnvelopeRouteValue(request, key)
			if err := placeValue(compiledMapping.RequestTemplate, path, value); err != nil {
				return RuntimeBundle{}, fmt.Errorf("place Command route variable %s: %w", key, err)
			}
		}
		compiledMapping.RequestEnvelope.RouteVariablePaths = nil
		pipeline := CommandPipeline{
			CommandUUID:  mapping.TargetCommandUUID,
			MappingUUID:  mapping.UUID,
			RequestTopic: resolvedTopicByChannel[mapping.RequestChannel],
			Mapping:      compiledMapping,
		}
		if mapping.ResponseChannel != nil {
			responseTopic := resolvedTopicByChannel[*mapping.ResponseChannel]
			pipeline.ResponseTopic = &responseTopic
		}
		commandPipelines = append(commandPipelines, pipeline)
	}
	sort.SliceStable(commandPipelines, func(left, right int) bool {
		return commandPipelines[left].MappingUUID < commandPipelines[right].MappingUUID
	})

	return RuntimeBundle{
		Schema:              RuntimeBundleSchema,
		OrganizationUUID:    request.OrganizationUUID,
		GatewayUUID:         request.Gateway.Gateway.UUID,
		GatewayRouteUUID:    request.Route.Route.UUID,
		RouteRevision:       request.Route.Route.Revision,
		RoutePath:           request.Route.Route.RoutePath,
		DeviceUUID:          request.Route.Route.DeviceUUID,
		ProfileUUID:         request.Profile.Profile.UUID,
		ProfileVersionUUID:  request.Profile.Version.UUID,
		BindingUUID:         request.Binding.Binding.UUID,
		BindingVersionUUID:  request.Binding.Version.UUID,
		ProfileArtifactHash: profileArtifactHash,
		BindingArtifactHash: bindingArtifactHash,
		RouteSourceHash:     routeSourceHash,
		Compiler:            metadata,
		Channels:            nonNil(plan.resolvedChannels),
		ParameterPipelines:  parameterPipelines,
		DerivedPipelines:    derivedPipelines,
		CommandPipelines:    commandPipelines,
	}, nil
}

func commandEnvelopeRouteValue(request CompileRequest, key string) (string, bool) {
	switch key {
	case "route_path":
		return request.Route.Route.RoutePath, true
	case "device_uuid":
		return request.Route.Route.DeviceUUID, true
	case "gateway_uuid":
		return request.Gateway.Gateway.UUID, true
	case "organization_uuid":
		return request.OrganizationUUID, true
	default:
		value, exists := request.Route.Route.TopicVariables[key]

		return value, exists
	}
}

func stringPointer(value string) *string {
	return &value
}

func nonNil[T any](values []T) []T {
	if values == nil {
		return []T{}
	}

	return values
}
