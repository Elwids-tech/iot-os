<?php

declare(strict_types=1);

namespace App\Support;

final class DemoEnvironment
{
    public static function allowed(): bool
    {
        return app()->environment(['local', 'testing']) ||
            (app()->environment('staging') && config('deployment.demo_enabled') === true);
    }
}
