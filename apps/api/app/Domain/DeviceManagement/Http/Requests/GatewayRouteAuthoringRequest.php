<?php

declare(strict_types=1);

namespace App\Domain\DeviceManagement\Http\Requests;

use App\Domain\DeviceManagement\Data\GatewayRouteAuthoringData;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Validator;
use InvalidArgumentException;

final class GatewayRouteAuthoringRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /** @return array<string, list<string>> */
    public function rules(): array
    {
        return [
            'schema' => ['required', 'in:iot.gateway-route.authoring.v2'],
            'route' => [
                'required',
                'array:uuid,revision,gateway_uuid,device_uuid,profile_version_uuid,binding_version_uuid,route_path,topic_variables,inbound_scopes,enabled',
            ],
            'route.uuid' => ['required', 'uuid'],
            'route.revision' => ['required', 'integer', 'min:1'],
            'route.gateway_uuid' => ['required', 'uuid'],
            'route.device_uuid' => ['required', 'uuid'],
            'route.profile_version_uuid' => ['required', 'uuid'],
            'route.binding_version_uuid' => ['required', 'uuid'],
            'route.route_path' => ['required', 'string', 'max:512', 'regex:/^[A-Za-z0-9][A-Za-z0-9._:\/-]*$/'],
            'route.topic_variables' => ['present', 'array', 'max:32'],
            'route.topic_variables.*' => ['string', 'min:1', 'max:512'],
            'route.inbound_scopes' => ['present', 'array', 'max:32'],
            'route.inbound_scopes.*' => ['array:channel,payload_path,selector'],
            'route.inbound_scopes.*.channel' => ['required', 'string', 'max:100', 'regex:/^[a-z][a-z0-9_]{0,99}$/'],
            'route.inbound_scopes.*.payload_path' => ['required', 'string', 'max:512'],
            'route.inbound_scopes.*.selector' => ['sometimes', 'array:source,equals'],
            'route.inbound_scopes.*.selector.source' => ['required_with:route.inbound_scopes.*.selector', 'array:scope,json_path'],
            'route.inbound_scopes.*.selector.source.scope' => ['required_with:route.inbound_scopes.*.selector', 'in:message,route,record'],
            'route.inbound_scopes.*.selector.source.json_path' => ['required_with:route.inbound_scopes.*.selector', 'string', 'max:512'],
            'route.inbound_scopes.*.selector.equals' => ['present_with:route.inbound_scopes.*.selector'],
            'route.enabled' => ['required', 'boolean'],
        ];
    }

    /** @return list<callable> */
    public function after(): array
    {
        return [function (Validator $validator): void {
            if ($validator->errors()->isNotEmpty()) {
                return;
            }

            try {
                GatewayRouteAuthoringData::fromArray($this->all());
            } catch (InvalidArgumentException $exception) {
                $validator->errors()->add('route', $exception->getMessage());
            }
        }];
    }
}
