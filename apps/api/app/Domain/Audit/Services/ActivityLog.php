<?php

declare(strict_types=1);

namespace App\Domain\Audit\Services;

use App\Domain\Audit\Models\Activity;
use App\Domain\Authentication\Services\Impersonation;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Illuminate\Database\Eloquent\Model;

/**
 * Records one audit event (ADR-028, spec 024). Call it inside the transaction of the
 * change it describes, so a rolled-back change leaves no event.
 *
 * - `$organization` is the organization whose data changed, or null at platform level.
 * - `$actor` is the person who did it, or null for a system event. It is never taken
 *   from the signed-in user implicitly: runtime callbacks and jobs record system events.
 * - `$subject` is the model acted on, or its UUID when only that is at hand.
 * - `$details` describe the action; list opaque fields that changed (layouts, graphs)
 *   under `changed`. `$changes` is {@see ActivityChanges}' shape. Secret-looking keys
 *   are dropped from both.
 * - What a super administrator does while impersonating the actor carries
 *   `impersonated_by`, the super administrator's id.
 */
final class ActivityLog
{
    /**
     * @param  array<string, mixed>  $details
     * @param  array{attributes?: array<string, mixed>, old?: array<string, mixed>}  $changes
     */
    public static function record(
        string $action,
        Organization|int|null $organization,
        User|int|null $actor,
        Model|string|null $subject = null,
        array $details = [],
        array $changes = [],
    ): ?Activity {
        $impersonator = self::impersonator($actor);
        if ($impersonator !== null) {
            $details['impersonated_by'] = $impersonator;
        }
        $logger = activity()->event($action)->withProperties(ActivityChanges::scrub($details));

        if ($actor instanceof User) {
            $logger->causedBy($actor);
        } else {
            // An id is set as it is, without loading the user, and null stays a system event.
            $logger->causedByAnonymous();
        }

        if ($subject instanceof Model) {
            $logger->performedOn($subject);
        }

        $logger->tap(function (Activity $activity) use ($organization, $actor, $subject, $changes): void {
            if (is_int($actor)) {
                $activity->causer_type = (new User)->getMorphClass();
                $activity->causer_id = $actor;
            }
            $activity->organization_id = $organization instanceof Organization ? (int) $organization->getKey() : $organization;
            $activity->subject_uuid = $subject instanceof Model ? self::uuid($subject) : $subject;
            $activity->subject_name = $subject instanceof Model ? self::name($subject) : null;
            $changes = ActivityChanges::scrub($changes);
            $activity->attribute_changes = ($changes['attributes'] ?? []) === [] ? null : collect($changes);
        });

        /** @var Activity|null */
        return $logger->log($action);
    }

    /** The super administrator acting as the actor in this request's session, if any. */
    private static function impersonator(User|int|null $actor): ?int
    {
        if ($actor === null || ! app()->bound('request')) {
            return null;
        }
        $request = request();
        $state = app(Impersonation::class)->current($request);
        $actorId = $actor instanceof User ? (int) $actor->getKey() : $actor;

        return $state !== null && $request->user()?->getKey() === $actorId ? $state['impersonator_id'] : null;
    }

    private static function uuid(Model $subject): ?string
    {
        $uuid = $subject->getAttribute('uuid');

        return is_string($uuid) && $uuid !== '' ? $uuid : null;
    }

    private static function name(Model $subject): ?string
    {
        foreach (['display_name', 'name', 'title', 'email'] as $attribute) {
            $value = $subject->getAttribute($attribute);
            if (is_string($value) && trim($value) !== '') {
                return mb_substr(trim($value), 0, 255);
            }
        }

        return null;
    }
}
