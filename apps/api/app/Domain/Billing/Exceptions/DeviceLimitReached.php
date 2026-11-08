<?php

declare(strict_types=1);

namespace App\Domain\Billing\Exceptions;

use Illuminate\Validation\ValidationException;

/**
 * An activation refused at the billing account's device limit (spec 029 US2): a 422 on
 * `device` like any other validation error. Bulk onboarding tells it apart, so the
 * device stays registered and the source is retried once the limit is raised.
 */
final class DeviceLimitReached extends ValidationException {}
