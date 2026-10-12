<?php

declare(strict_types=1);

namespace App\Support\Contract;

use RuntimeException;

/**
 * A contract file or the generated document is unusable; the message says how to fix it.
 */
final class ContractException extends RuntimeException {}
