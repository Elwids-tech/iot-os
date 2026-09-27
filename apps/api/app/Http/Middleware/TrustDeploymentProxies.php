<?php

namespace App\Http\Middleware;

use Illuminate\Http\Middleware\TrustProxies;

final class TrustDeploymentProxies extends TrustProxies
{
    protected function proxies()
    {
        return config('deployment.trusted_proxies', []);
    }
}
