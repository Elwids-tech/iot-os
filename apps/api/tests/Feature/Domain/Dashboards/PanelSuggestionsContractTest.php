<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Dashboards;

use App\Domain\Dashboards\Services\DashboardLayout;
use App\Domain\Dashboards\Services\PanelSuggestions;
use Tests\TestCase;

final class PanelSuggestionsContractTest extends TestCase
{
    public function test_php_matches_the_shared_panel_suggestion_cases(): void
    {
        $fixture = $this->fixture();
        $suggestions = app(PanelSuggestions::class);
        foreach ($fixture['suggestions'] as $case) {
            $this->assertSame($case['expected'], $suggestions->suggest($case['candidates']), $case['id']);
            $types = [...PanelSuggestions::PARAMETER_PANELS, ...PanelSuggestions::OTHER_PANELS];
            $this->assertSame($case['incompatible'], array_combine($types, array_map(fn (string $type): ?string => $suggestions->incompatibility($type, $case['candidates']), $types)), $case['id']);
            foreach ($case['candidates'] as $index => $candidate) {
                $this->assertSame($case['sources'][$index], $suggestions->source($candidate['device'], $candidate['parameter'], $index), $case['id']);
            }
        }
    }

    public function test_php_places_panels_as_the_portal_does(): void
    {
        foreach ($this->fixture()['layouts'] as $case) {
            $layouts = $case['existing'];
            foreach ($case['add'] as $id) {
                $layouts = app(DashboardLayout::class)->append($layouts, $id, $case['placement']);
            }
            $this->assertSame($case['expected'], $layouts, $case['id']);
        }
    }

    public function test_palette_neutral_band_and_tones_match_the_fixture(): void
    {
        $fixture = $this->fixture();
        $this->assertSame($fixture['palette'], PanelSuggestions::PALETTE);
        $this->assertSame($fixture['neutral'], PanelSuggestions::NEUTRAL);
        $this->assertSame($fixture['tones'], PanelSuggestions::TONES);
    }

    /** @return array<string, mixed> */
    private function fixture(): array
    {
        return json_decode(file_get_contents(base_path('../../contracts/dashboards/v1/panel-suggestions.fixture.json')), true, 512, JSON_THROW_ON_ERROR);
    }
}
