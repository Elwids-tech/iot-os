<?php

declare(strict_types=1);

namespace App\Support\Contracts;

use RuntimeException;

/**
 * A contract cannot be checked: the registry is disabled, the reference names no
 * contract, or its schema does not compile. Never a statement about the value.
 */
final class ContractUnavailable extends RuntimeException {}
