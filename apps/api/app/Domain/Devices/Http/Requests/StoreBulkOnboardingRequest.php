<?php

declare(strict_types=1);

namespace App\Domain\Devices\Http\Requests;

use App\Domain\Devices\Models\SparkplugGateway;
use App\Domain\Devices\Permissions\DevicePermission;
use App\Domain\Devices\Services\BulkOnboarding;
use App\Domain\Devices\Services\DeviceAuthorization;
use Illuminate\Foundation\Http\FormRequest;

final class StoreBulkOnboardingRequest extends FormRequest
{
    /** People who may manage and activate devices; another organization's gateway is 404. */
    public function authorize(): bool
    {
        $authorization = app(DeviceAuthorization::class);
        $organization = $this->route('organization');
        $gateway = $this->route('gateway');
        $authorization->authorize($this->user(), DevicePermission::MANAGE, $organization, $gateway instanceof SparkplugGateway ? $gateway : null);
        $authorization->authorize($this->user(), DevicePermission::ACTIVATE, $organization);

        return true;
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            // Client-generated; repeating the same request returns the same run.
            'operation_uuid' => ['required', 'uuid'],
            // A published revision of one of the organization's profiles.
            'artifact_uuid' => ['required', 'uuid'],
            // Must contain {device_id}; may also use {gateway} and {n}.
            'name_pattern' => ['required', 'string', 'max:120', function (string $attribute, mixed $value, \Closure $fail): void {
                if (! is_string($value) || ! str_contains($value, '{device_id}')) {
                    $fail('The name pattern must contain {device_id}.');
                } elseif (preg_match_all('/\{[^}]*\}/', $value, $matches) && array_diff($matches[0], BulkOnboarding::PLACEHOLDERS)) {
                    $fail('The name pattern can use only {device_id}, {gateway} and {n}.');
                }
            }],
            // Device IDs of discovered sources of this gateway; the gateway's own source is onboarded on its own.
            'source_device_ids' => ['required', 'array', 'min:1', 'max:'.BulkOnboarding::MAX_SOURCES],
            'source_device_ids.*' => ['required', 'string', 'max:128', 'regex:/^[a-zA-Z0-9_.:-]+$/', 'distinct'],
        ];
    }

    /**
     * @return array<string, string>
     */
    public function messages(): array
    {
        return [
            'source_device_ids.max' => 'Onboard at most '.BulkOnboarding::MAX_SOURCES.' sources at a time. Split the selection.',
            'source_device_ids.*.required' => 'Choose sources with a device ID. The gateway’s own source is onboarded on its own.',
        ];
    }
}
