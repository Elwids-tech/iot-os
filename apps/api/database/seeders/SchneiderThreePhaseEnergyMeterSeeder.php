<?php

declare(strict_types=1);

namespace Database\Seeders;

use App\Domain\DeviceProfiles\Actions\ValidateDeviceProfile;
use App\Domain\DeviceProfiles\Enums\DeviceProfileStatus;
use App\Domain\DeviceProfiles\Models\DeviceProfile;
use App\Domain\DeviceProfiles\Models\ProfileParameter;
use App\Domain\Shared\Models\Organization;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use LogicException;

/** An optional authoring example, not a certified model definition or register map. */
final class SchneiderThreePhaseEnergyMeterSeeder extends Seeder
{
    public const PROFILE_CODE = 'schneider-three-phase-energy-meter';

    public function run(string $organizationSlug = 'acme-manufacturing'): void
    {
        if (app()->environment('production')) {
            throw new LogicException('The Schneider starter seeder cannot run in production.');
        }

        [$profile, $created] = DB::transaction(function () use ($organizationSlug): array {
            // Serialize concurrent seed runs for the selected tenant only.
            $organization = Organization::query()->where('slug', $organizationSlug)->lockForUpdate()->first();
            if ($organization === null) {
                throw new LogicException("Organization [{$organizationSlug}] does not exist. Select an existing organization; this seeder does not create accounts or tenants.");
            }

            $existing = DeviceProfile::withTrashed()
                ->where('organization_id', $organization->getKey())
                ->where('code', self::PROFILE_CODE)
                ->first();

            // Never overwrite author changes, published content, or a deliberate deletion.
            if ($existing !== null) {
                return [$existing, false];
            }

            $profile = DeviceProfile::query()->create([
                'uuid' => (string) Str::uuid(),
                'organization_id' => $organization->getKey(),
                'code' => self::PROFILE_CODE,
                'name' => 'Schneider Electric three-phase energy meter (starter)',
                'description' => 'Generic, editable starter for a Schneider Electric three-phase meter; no specific model is assumed. Confirm available readings, wiring, units, scaling and sign conventions against the exact meter manual. Line-to-neutral readings require an appropriate wiring configuration. Remove unsupported readings before publishing. No transport bindings or active alarms are included.',
                'category' => 'energy-metering',
                'status' => DeviceProfileStatus::DRAFT,
                'revision' => 0,
                'draft_revision' => 1,
                'extensions' => [
                    'manufacturer' => 'Schneider Electric',
                    'model' => null,
                    'starter' => [
                        'generic' => true,
                        'version' => 1,
                        'requires_model_verification' => true,
                        'stale_after_seconds_is_example' => true,
                    ],
                ],
            ]);

            $groups = [];
            foreach ([
                ['voltage', 'Voltage', 'RMS phase-to-neutral and phase-to-phase voltages; confirm the meter wiring mode.'],
                ['current', 'Current', 'RMS current in each phase, after the correct CT scaling.'],
                ['power', 'Power', 'Per-phase and meter-reported total power. Confirm import/export and reactive sign conventions.'],
                ['power-quality', 'Power quality', 'Frequency and signed power factor; no nominal frequency or electrical ratings are assumed.'],
                ['energy', 'Energy', 'Separate imported and exported cumulative active-energy registers.'],
                ['calculated', 'Calculated values', 'Platform calculations from reported values, not additional meter registers.'],
            ] as $sortOrder => [$code, $label, $description]) {
                $groups[$code] = $profile->parameterGroups()->create([
                    'uuid' => (string) Str::uuid(),
                    'code' => $code,
                    'label' => $label,
                    'description' => $description,
                    'sort_order' => $sortOrder,
                ]);
            }

            $parameters = [];
            foreach ($this->parameterDefinitions() as $sortOrder => $definition) {
                $group = $definition['group'];
                unset($definition['group']);
                $parameters[$definition['key']] = $profile->parameters()->create([
                    'uuid' => (string) Str::uuid(),
                    'parameter_group_id' => $groups[$group]->getKey(),
                    'data_type' => 'number',
                    'accepts_command' => false,
                    'reports_state' => $definition['kind'] !== 'derived',
                    'reporting_config' => $definition['kind'] === 'derived' ? null : ['stale_after_seconds' => 300],
                    'sort_order' => $sortOrder,
                    ...$definition,
                ]);
            }

            $average = ['/' => [['+' => [['var' => 'l1'], ['var' => 'l2'], ['var' => 'l3']]], 3]];
            foreach (['voltage', 'current'] as $quantity) {
                $this->calculation($profile, $parameters, $quantity.'.average', $average, [
                    'l1' => $quantity.'.l1', 'l2' => $quantity.'.l2', 'l3' => $quantity.'.l3',
                ]);
            }
            $this->calculation($profile, $parameters, 'energy.net', ['-' => [['var' => 'imported'], ['var' => 'exported']]], [
                'imported' => 'energy.imported', 'exported' => 'energy.exported',
            ]);

            $alarm = $profile->alarmTemplates()->create([
                'uuid' => (string) Str::uuid(),
                'code' => 'meter-reading-stale',
                'name' => 'Total active power reading stale (example: 5 minutes)',
                'type' => 'staleness',
                'severity' => 'warning',
                'condition_config' => ['max_age_seconds' => 300],
                'enabled_by_default' => false,
            ]);
            $alarm->parameterReferences()->create([
                'profile_parameter_id' => $parameters['power.active.total']->getKey(),
                'role' => 'subject',
            ]);

            // Roll back the entire example if authoring rules change and it no longer validates.
            app(ValidateDeviceProfile::class)->handle($profile->fresh());

            return [$profile, true];
        });

        $this->command?->info($created
            ? "Created Schneider starter draft [{$profile->uuid}] in [{$organizationSlug}]. Review model capabilities before publishing."
            : "Schneider profile [{$profile->uuid}] already exists in [{$organizationSlug}] (including deleted profiles); left unchanged.");
    }

    /** @return list<array<string, mixed>> */
    private function parameterDefinitions(): array
    {
        $parameters = [];
        foreach (['l1' => 'L1', 'l2' => 'L2', 'l3' => 'L3'] as $phase => $label) {
            $parameters[] = $this->parameter('voltage', 'voltage.'.$phase, 'Voltage '.$label.'–N', 'RMS voltage from '.$label.' to neutral, where supported by the wiring mode.', 'V', 1, nonNegative: true);
        }
        foreach (['l1_l2' => 'L1–L2', 'l2_l3' => 'L2–L3', 'l3_l1' => 'L3–L1'] as $pair => $label) {
            $parameters[] = $this->parameter('voltage', 'voltage.'.$pair, 'Voltage '.$label, 'RMS line-to-line voltage '.$label.'.', 'V', 1, nonNegative: true);
        }
        foreach (['l1' => 'L1', 'l2' => 'L2', 'l3' => 'L3'] as $phase => $label) {
            $parameters[] = $this->parameter('current', 'current.'.$phase, 'Current '.$label, 'RMS phase '.$label.' current; verify CT ratio and scaling at ingestion.', 'A', 2, nonNegative: true);
        }
        foreach (['active' => ['Active', 'kW'], 'reactive' => ['Reactive', 'kvar'], 'apparent' => ['Apparent', 'kVA']] as $type => [$label, $unit]) {
            foreach (['l1' => 'L1', 'l2' => 'L2', 'l3' => 'L3', 'total' => 'total'] as $phase => $phaseLabel) {
                $parameters[] = $this->parameter('power', 'power.'.$type.'.'.$phase, $label.' power '.$phaseLabel,
                    'Meter-reported '.strtolower($label).' power '.$phaseLabel.'. Confirm availability, unit scaling and sign convention in the model manual.',
                    $unit, 3, nonNegative: $type === 'apparent');
            }
        }
        $parameters[] = $this->parameter('power-quality', 'frequency', 'Frequency', 'Measured mains frequency; configure site-specific limits separately.', 'Hz', 2, nonNegative: true);
        foreach (['l1' => 'L1', 'l2' => 'L2', 'l3' => 'L3', 'total' => 'total'] as $phase => $label) {
            $parameters[] = [
                ...$this->parameter('power-quality', 'power_factor.'.$phase, 'Power factor '.$label, 'Dimensionless signed power factor. Confirm the model uses this representation and how it encodes leading/lagging.', null, 3),
                'validation_logic' => $this->validation(['and' => [
                    ['>=' => [['var' => 'value'], -1]], ['<=' => [['var' => 'value'], 1]],
                ]], 'power_factor_out_of_range', 'Power factor must be between -1 and 1.'),
            ];
        }
        foreach (['imported' => 'Imported', 'exported' => 'Exported'] as $direction => $label) {
            $parameters[] = [
                ...$this->parameter('energy', 'energy.'.$direction, $label.' active energy', 'Cumulative '.strtolower($label).' active energy. Verify register availability and reset/rollover behavior; never treat a reset as negative consumption.', 'kWh', 3, 'counter', true),
                'counter_config' => ['monotonic' => true, 'reset_behavior' => 'diagnose'],
            ];
        }
        $parameters[] = $this->parameter('calculated', 'voltage.average', 'Average phase voltage', 'Arithmetic mean of L1–N, L2–N and L3–N. Requires all three phase-to-neutral readings.', 'V', 1, 'derived', true);
        $parameters[] = $this->parameter('calculated', 'current.average', 'Average phase current', 'Arithmetic mean of the three phase currents.', 'A', 2, 'derived', true);
        $parameters[] = $this->parameter('calculated', 'energy.net', 'Net active energy', 'Imported minus exported cumulative active energy; can be negative. Requires registers with a common accumulation/reset basis. This is not interval consumption.', 'kWh', 3, 'derived');

        return $parameters;
    }

    /** @return array<string, mixed> */
    private function parameter(string $group, string $key, string $label, string $description, ?string $unit, int $precision, string $kind = 'measurement', bool $nonNegative = false): array
    {
        return [
            'group' => $group,
            'key' => $key,
            'label' => $label,
            'description' => $description,
            'unit' => $unit,
            'kind' => $kind,
            'display_config' => ['widget' => 'number', 'precision' => $precision],
            'validation_logic' => $nonNegative
                ? $this->validation(['>=' => [['var' => 'value'], 0]], 'negative_value', $label.' must not be negative.')
                : null,
        ];
    }

    /** @return array<string, mixed> */
    private function validation(array $rule, string $code, string $message): array
    {
        return ['engine' => 'json_logic', 'rule' => $rule, 'diagnostic_code' => $code, 'message' => $message];
    }

    /** @param array<string, ProfileParameter> $parameters */
    private function calculation(DeviceProfile $profile, array $parameters, string $targetKey, array $expression, array $inputs): void
    {
        $calculation = $profile->calculations()->create([
            'uuid' => (string) Str::uuid(),
            'target_profile_parameter_id' => $parameters[$targetKey]->getKey(),
            'engine' => 'json_logic',
            'expression' => $expression,
            'trigger' => 'on_input_change',
            'failure_policy' => 'mark_invalid',
        ]);
        foreach ($inputs as $alias => $key) {
            $calculation->inputs()->create([
                'profile_parameter_id' => $parameters[$key]->getKey(),
                'alias' => $alias,
            ]);
        }
    }
}
