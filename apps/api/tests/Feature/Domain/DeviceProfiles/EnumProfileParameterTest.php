<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\DeviceProfiles;

use App\Domain\DeviceProfiles\Enums\ProfileParameterDataType;
use App\Domain\DeviceProfiles\Services\ProfileConfigurationValidator;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

final class EnumProfileParameterTest extends TestCase
{
    use RefreshDatabase;

    public function test_enum_parameters_require_unique_string_allowed_values(): void
    {
        $this->assertArrayHasKey(
            'validation_logic',
            app(ProfileConfigurationValidator::class)->errors([
                'data_type' => ProfileParameterDataType::ENUM,
                'validation_logic' => null,
            ]),
        );

        $this->seed(DatabaseSeeder::class);
        $organization = Organization::where('slug', 'acme-manufacturing')->firstOrFail();
        $this->actingAs(User::where('email', 'shared.operator@example.test')->firstOrFail());

        $root = '/api/v1/organizations/'.$organization->uuid.'/device-profiles';
        $profile = $this->postJson($root, [
            'code' => 'enum-contract',
            'name' => 'Enum contract',
        ])->assertCreated()->json('data');
        $parameters = $root.'/'.$profile['uuid'].'/parameters';
        $base = [
            'key' => 'mode',
            'label' => 'Mode',
            'kind' => 'state',
            'data_type' => 'enum',
            'draft_revision' => $profile['draft_revision'],
        ];

        $this->postJson($parameters, $base)
            ->assertUnprocessable()
            ->assertJsonValidationErrors('validation_logic');
        $this->postJson($parameters, $base + [
            'validation_logic' => $this->allowedValues(['solid', 'solid']),
        ])->assertUnprocessable()->assertJsonValidationErrors('validation_logic');
        $this->postJson($parameters, $base + [
            'validation_logic' => $this->allowedValues(['solid', 1]),
        ])->assertUnprocessable()->assertJsonValidationErrors('validation_logic');

        $this->postJson($parameters, $base + [
            'validation_logic' => $this->allowedValues([
                'solid',
                'blink',
                'strobe',
            ]),
            'display_config' => ['widget' => 'toggle_group'],
        ])->assertCreated()
            ->assertJsonPath('data.data_type', 'enum')
            ->assertJsonPath('data.validation_logic.rule.in.1.1', 'blink')
            ->assertJsonPath('data.display_config.widget', 'toggle_group');
    }

    private function allowedValues(array $values): array
    {
        return [
            'engine' => 'json_logic',
            'rule' => ['in' => [['var' => 'value'], $values]],
        ];
    }
}
