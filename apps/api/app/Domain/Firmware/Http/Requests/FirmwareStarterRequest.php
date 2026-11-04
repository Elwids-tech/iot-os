<?php

declare(strict_types=1);

namespace App\Domain\Firmware\Http\Requests;

use App\Domain\Firmware\Services\MetricTables;
use App\Domain\Firmware\Services\TargetRegistry;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

/** POST firmware/starters (spec 027 platform API). Permissions are checked by the controller. */
final class FirmwareStarterRequest extends FormRequest
{
    public function rules(): array
    {
        return [
            'target' => ['required', 'string', Rule::in(array_column(app(TargetRegistry::class)->available(), 'id'))],
            'role' => ['required', Rule::in(TargetRegistry::ROLES)],
            'node_artifact_uuid' => ['required_if:role,direct', 'nullable', 'uuid'],
            'device_type_artifact_uuids' => ['prohibited_if:role,direct', 'required_if:role,gateway', 'array', 'min:1', 'max:'.MetricTables::MAX_TYPES],
            'device_type_artifact_uuids.*' => ['uuid', 'distinct'],
            'gateway_uuid' => ['prohibited_if:role,direct', 'nullable', 'uuid'],
        ];
    }

    public function messages(): array
    {
        return [
            'target.in' => 'Choose one of the available firmware targets.',
            'device_type_artifact_uuids.max' => 'A gateway starter holds at most '.MetricTables::MAX_TYPES.' device types (IOTOS_MAX_DEVICE_TYPES).',
            'device_type_artifact_uuids.*.distinct' => 'Each device type can appear only once.',
        ];
    }

    public function after(): array
    {
        return [function (Validator $validator): void {
            $target = app(TargetRegistry::class)->find((string) $this->input('target'));
            if ($target && ! in_array($this->input('role'), $target['roles'], true)) {
                $validator->errors()->add('role', $target['name'].' does not support the '.$this->input('role').' role.');
            }
        }];
    }
}
