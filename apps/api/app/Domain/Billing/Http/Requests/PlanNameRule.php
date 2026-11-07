<?php

declare(strict_types=1);

namespace App\Domain\Billing\Http\Requests;

use App\Domain\Billing\Models\BillingPlan;
use Illuminate\Validation\Validator;

/**
 * Plan names are unique regardless of case, as the database index is.
 */
final class PlanNameRule
{
    public static function check(Validator $validator, string $name, ?BillingPlan $except = null): void
    {
        if (trim($name) === '' || $validator->errors()->has('name')) {
            return;
        }

        $taken = BillingPlan::query()
            ->whereRaw('lower(name) = ?', [mb_strtolower(trim($name))])
            ->when($except !== null, fn ($query) => $query->whereKeyNot($except->getKey()))
            ->exists();

        if ($taken) {
            $validator->errors()->add('name', 'A plan with this name already exists.');
        }
    }
}
