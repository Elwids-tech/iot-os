<?php

declare(strict_types=1);

namespace Tests\Support\Contract;

use Attribute;
use InvalidArgumentException;

/**
 * Turns the contract response checks off for one test that deliberately produces a
 * response the contract does not describe. The reason is required; `contract:coverage`
 * lists every opt-out with it so reviewers see them.
 */
#[Attribute(Attribute::TARGET_METHOD)]
final readonly class WithoutContractCheck
{
    public function __construct(public string $reason)
    {
        if (trim($reason) === '') {
            throw new InvalidArgumentException('#[WithoutContractCheck] needs a reason.');
        }
    }
}
