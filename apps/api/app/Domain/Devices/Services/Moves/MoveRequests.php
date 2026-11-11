<?php

declare(strict_types=1);

namespace App\Domain\Devices\Services\Moves;

use App\Domain\Audit\Services\ActivityLog;
use App\Domain\DeviceProfiles\Support\CanonicalJson;
use App\Domain\Devices\Models\DeviceMove;
use App\Domain\Devices\Models\DeviceMoveDevice;
use App\Domain\Devices\Models\DeviceMoveItem;
use App\Domain\Devices\Models\DeviceOperation;
use App\Domain\Devices\Services\DeviceAuthorization;
use App\Domain\Devices\Services\DeviceConfigurationService;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * Confirming a move (spec 031, research R1 and R10). The request is idempotent by
 * `operation_uuid`; the review is rebuilt under both organizations' locks and must match
 * the hash the person confirmed. Each active device then gets an ordinary deactivation
 * that keeps its device-limit place, and the cutover runs once the runtime has stopped
 * them all: here at once when none was active, else from `ContinueDeviceMove`. Each
 * dashboard and automation to be archived must be confirmed on its own (FR-006).
 */
final class MoveRequests
{
    public function __construct(
        private readonly MovePreview $preview,
        private readonly DeviceConfigurationService $configuration,
        private readonly DeviceAuthorization $authorization,
        private readonly MoveCutover $cutover,
        private readonly CanonicalJson $canonical,
    ) {}

    /** @return array<string, list<mixed>> */
    public static function rules(): array
    {
        return [
            ...MovePreview::rules(),
            'operation_uuid' => ['required', 'uuid'],
            'preview_hash' => ['required', 'string', 'size:64'],
            'origin' => ['sometimes', Rule::in(['devices', 'device'])],
            // Assistant cards confirm from PR 031-10.
            'proposal_uuid' => ['sometimes', 'nullable', 'prohibited'],
            'confirmed_archives' => ['sometimes', 'array', 'max:500'],
            'confirmed_archives.*' => ['array:kind,uuid'],
            'confirmed_archives.*.kind' => ['required', Rule::in(DeviceMoveItem::KINDS)],
            'confirmed_archives.*.uuid' => ['required', 'uuid'],
        ];
    }

    /**
     * @param  array<string, mixed>  $input  validated by rules()
     * @return array{0: DeviceMove, 1: bool} the move, and whether this request created it
     */
    public function confirm(Organization $source, User $user, array $input): array
    {
        $body = $input;
        unset($body['operation_uuid']);
        $body['origin'] ??= 'devices';
        $hash = hash('sha256', $this->canonical->encode($body));
        if ($existing = $this->existing($source, $user, $input['operation_uuid'], $hash)) {
            return [$existing, false];
        }
        $target = $this->preview->target($source, $user, $input['target_organization_uuid']);

        return DB::transaction(function () use ($source, $target, $user, $input, $body, $hash): array {
            Organization::whereIn('id', [$source->id, $target->id])->orderBy('id')->lockForUpdate()->get();
            if ($existing = $this->existing($source, $user, $input['operation_uuid'], $hash)) {
                return [$existing, false];
            }
            // Re-checked under the locks: the same account, and Device.move in both.
            $source = Organization::findOrFail($source->id);
            abort_unless($this->authorization->capabilities($user, $source)['move'], 403);
            $target = $this->preview->target($source, $user, $target->uuid);
            $built = $this->preview->build($source, $target, $user, $input, lock: true);
            $review = $built['review'];
            if (! hash_equals($review['preview_hash'], $input['preview_hash'])) {
                throw new HttpResponseException(response()->json(['message' => 'The move changed since you reviewed it. Review it again before confirming.', 'review' => $review], 409));
            }
            if (! $review['can_confirm']) {
                $errors = [];
                foreach ($review['devices'] as $i => $device) {
                    if ($device['blockers'] !== []) {
                        $errors["devices.$i"] = $device['name'].': '.implode('; ', $device['blockers']).'.';
                    }
                }
                throw ValidationException::withMessages($errors);
            }
            $archives = collect($review['archives'])->map(fn (array $item): string => $item['kind'].':'.$item['uuid'])->sort()->values()->all();
            $confirmed = collect($input['confirmed_archives'] ?? [])->map(fn (array $item): string => $item['kind'].':'.$item['uuid'])->unique()->sort()->values()->all();
            if ($archives !== $confirmed) {
                throw ValidationException::withMessages(['confirmed_archives' => $archives === []
                    ? 'Nothing is archived in this move.'
                    : 'Confirm archiving '.implode(', ', array_column($review['archives'], 'name')).' on its own.']);
            }

            $move = DeviceMove::create([
                'operation_uuid' => $input['operation_uuid'], 'request_hash' => $hash,
                'source_organization_id' => $source->id, 'target_organization_id' => $target->id, 'billing_account_id' => $source->billing_account_id,
                'mover_id' => $user->id, 'origin' => $body['origin'], 'include_history' => $review['history']['include'], 'status' => 'stopping',
                'review' => $review, 'confirmed_at' => now(),
            ]);
            foreach ($built['rows'] as $i => $row) {
                $device = $row['device'];
                $stop = null;
                if ($row['stops']) {
                    $stopped = $this->configuration->deactivate($device, $device->draft_revision, $user->id, keepPlace: true);
                    $stop = DeviceOperation::where('device_id', $device->id)->where('generation', $stopped->deployment_generation)->value('uuid');
                }
                $successor = $review['devices'][$i]['successor'];
                DeviceMoveDevice::create([
                    'device_move_id' => $move->id, 'predecessor_device_id' => $device->id, 'name' => $successor['name'], 'code' => $successor['code'],
                    'target_site_id' => $row['site']?->id, 'was_active' => $row['was_active'], 'arrives_active' => $review['devices'][$i]['arrives_active'],
                    'stop_operation_uuid' => $stop, 'state' => $stop ? 'stopping' : 'waiting', 'outstanding_key' => $device->id,
                ]);
            }
            foreach ($built['items'] as $item) {
                DeviceMoveItem::create([
                    'device_move_id' => $move->id, 'kind' => $item['view']['kind'], 'source_item_id' => $item['model']->id,
                    'uses_only_moving' => $item['view']['uses_only_moving'], 'action' => $item['view']['action'], 'omitted' => $item['view']['omitted'],
                ]);
            }
            $names = array_column(array_column($review['devices'], 'successor'), 'name');
            ActivityLog::record('device_move.started', $source, $user, $move, ['target' => $target->name, 'devices' => array_column($review['devices'], 'name')]);
            ActivityLog::record('device_move.started', $target, $user, $move, ['source' => $source->name, 'devices' => $names]);
            if (! $move->devices()->where('state', 'stopping')->exists()) {
                $this->cutover->run($move);
            }

            return [$move->fresh(), true];
        });
    }

    private function existing(Organization $source, User $user, string $operation, string $hash): ?DeviceMove
    {
        $move = DeviceMove::where('operation_uuid', $operation)->first();
        if (! $move) {
            return null;
        }
        abort_unless($move->source_organization_id === $source->id && $move->mover_id === $user->id && hash_equals($move->request_hash, $hash), 409,
            'This move request was already used for a different move. Review the move and confirm it again.');

        return $move;
    }
}
