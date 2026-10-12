<?php

declare(strict_types=1);

namespace App\Support\Contracts;

/**
 * How unknown fields are judged (contracts/README.md, ADR-015).
 *
 * Strict validates the closed schema as written: producers are tested this way, and
 * readers of the canonical envelope family read this way. Tolerant ignores
 * `additionalProperties: false` and `unevaluatedProperties: false`, as consumers of
 * internal messages do.
 */
enum ContractMode: string
{
    case Strict = 'strict';
    case Tolerant = 'tolerant';
}
