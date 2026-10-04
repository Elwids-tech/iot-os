<?php

declare(strict_types=1);

namespace App\Domain\Automation\Http\Controllers;

use App\Domain\Automation\Models\Scenario;
use App\Domain\Automation\Models\Workflow;
use App\Domain\Automation\Services\DagAuthorization;
use App\Domain\Automation\Services\ScenarioSimulation;
use App\Domain\Devices\Services\RuntimeClient;
use App\Domain\Shared\Models\Organization;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

final class ScenarioController
{
    public function __construct(private DagAuthorization $auth, private ScenarioSimulation $simulation, private RuntimeClient $runtime) {}

    private function authorize(Request $r, Organization $organization, Workflow $workflow, ?Scenario $scenario = null): void
    {
        $this->auth->authorize($r->user(), $organization, $r->isMethod('GET') ? 'view' : 'manage', $workflow);
        $this->auth->enabled($organization);
        abort_unless(($workflow->workflow['schema_version'] ?? '') === 'automation-workflow.v2', 422, 'Scenarios require a v2 workflow.');
        if ($scenario) {
            abort_unless($scenario->automation_workflow_id === $workflow->id, 404);
        }
    }

    public function index(Request $r, Organization $organization, Workflow $workflow): array
    {
        $this->authorize($r, $organization, $workflow);

        return ['data' => Scenario::where('automation_workflow_id', $workflow->id)->orderByDesc('updated_at')->get()];
    }

    public function save(Request $r, Organization $organization, Workflow $workflow, ?Scenario $scenario = null)
    {
        $this->authorize($r, $organization, $workflow, $scenario);
        $v = $r->validate(['name' => 'required|string|max:120', 'draft_revision' => 'required|integer|min:1', 'revision' => 'required|integer|min:0', 'definition' => 'required|array:steps']);
        abort_if(strlen(json_encode($v['definition'])) > 262144, 422, 'Scenario is too large.');

        return DB::transaction(function () use ($workflow, $scenario, $v, $r) {
            $w = Workflow::whereKey($workflow->id)->lockForUpdate()->firstOrFail();
            abort_unless($w->draft_revision === $v['draft_revision'], 409, 'Workflow changed. Reload before saving this scenario.');
            $s = $scenario ? Scenario::whereKey($scenario->id)->lockForUpdate()->firstOrFail() : new Scenario(['automation_workflow_id' => $w->id, 'revision' => 0]);
            abort_unless($s->revision === $v['revision'], 409, 'Scenario changed. Reload before saving.');
            abort_if(! $s->exists && Scenario::where('automation_workflow_id', $w->id)->count() >= 50, 422, 'A workflow supports up to 50 scenarios.');
            $this->simulation->steps($v['definition'], $w);
            $s->fill([...$v, 'revision' => $s->revision + 1, 'updated_by' => $r->user()->id])->save();

            return response()->json(['data' => $s], $scenario ? 200 : 201);
        });
    }

    public function destroy(Request $r, Organization $organization, Workflow $workflow, Scenario $scenario): array
    {
        $this->authorize($r, $organization, $workflow, $scenario);
        $v = $r->validate(['revision' => 'required|integer|min:1']);
        abort_unless(Scenario::whereKey($scenario->id)->where('revision', $v['revision'])->delete() === 1, 409, 'Scenario changed.');

        return ['deleted' => true];
    }

    public function run(Request $r, Organization $organization, Workflow $workflow, Scenario $scenario): array
    {
        $this->authorize($r, $organization, $workflow, $scenario);
        $v = $r->validate(['revision' => 'required|integer|min:1', 'draft_revision' => 'required|integer|min:1']);
        abort_unless($scenario->revision === $v['revision'] && $workflow->draft_revision === $v['draft_revision'], 409, 'Workflow or scenario changed. Reload before running.');
        $steps = $this->simulation->steps($scenario->definition, $workflow);
        $output = $this->runtime->request('POST', '/internal/dag/simulate', ['workflow' => $workflow->workflow, 'steps' => $steps]);
        $result = $this->simulation->evaluate($scenario->definition, $workflow->workflow, $output);
        $run = ['uuid' => (string) Str::uuid(), 'automation_scenario_id' => $scenario->id, 'scenario_revision' => $scenario->revision,
            'draft_revision' => $workflow->draft_revision, 'definition_hash' => $workflow->definition_hash,
            'scenario' => $scenario->definition, 'result' => $result, 'created_by' => $r->user()->id, 'created_at' => now()->toIso8601String()];
        DB::transaction(function () use ($run, $scenario) {
            Scenario::whereKey($scenario->id)->lockForUpdate()->firstOrFail();
            DB::table('automation_scenario_runs')->insert([...$run, 'scenario' => json_encode($run['scenario']), 'result' => json_encode($run['result'])]);
            $keep = DB::table('automation_scenario_runs')->where('automation_scenario_id', $scenario->id)->orderByDesc('id')->limit(20)->pluck('id');
            DB::table('automation_scenario_runs')->where('automation_scenario_id', $scenario->id)->whereNotIn('id', $keep)->delete();
        });

        return ['data' => $run];
    }

    public function history(Request $r, Organization $organization, Workflow $workflow, Scenario $scenario): array
    {
        $this->authorize($r, $organization, $workflow, $scenario);

        return ['data' => DB::table('automation_scenario_runs')->where('automation_scenario_id', $scenario->id)->orderByDesc('id')->limit(20)->get()->map(fn ($run) => [...(array) $run, 'scenario' => json_decode($run->scenario, true), 'result' => json_decode($run->result, true)])];
    }
}
