<?php

declare(strict_types=1);

namespace App\Domain\Branding\Enums;

/** A name under the platform's domain, or a customer's own domain (spec 036). */
enum PortalAddressKind: string
{
    case Name = 'name';
    case Domain = 'domain';
}
