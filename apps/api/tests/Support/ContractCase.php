<?php

declare(strict_types=1);

namespace Tests\Support;

use App\Support\Contracts\ContractMode;
use App\Support\Contracts\ContractRegistry;

/**
 * A contract's fixture or one entry of its cases file (contracts/README.md, "Cases
 * files"), with the verdict schema validation must reach in each mode.
 */
final readonly class ContractCase
{
    /**
     * @param  string  $json  the example, as JSON (empty objects stay objects)
     * @param  array{keyword?: string, instance_location?: string, code?: string}|null  $error  null for a valid case
     */
    public function __construct(
        public string $name,
        public string $description,
        public string $json,
        public bool $valid,
        public bool $tolerantValid = false,
        public ?array $error = null,
    ) {}

    /**
     * The example decoded to PHP arrays, for HTTP test helpers such as postJson().
     */
    public function data(): mixed
    {
        return json_decode($this->json, true, 512, JSON_THROW_ON_ERROR);
    }

    /**
     * Valid cases pass both modes. A tolerant_valid case, and any case failing only on
     * an unknown-field keyword, passes tolerant mode. A reader-code case (envelope
     * family) is valid against the schema; only the envelope reader refuses it. Every
     * other invalid case fails both modes.
     */
    public function accepted(ContractMode $mode): bool
    {
        if ($this->valid || ! isset($this->error['keyword'])) {
            return true;
        }

        return $mode === ContractMode::Tolerant
            && ($this->tolerantValid || in_array($this->error['keyword'], ContractRegistry::UNKNOWN_FIELD_KEYWORDS, true));
    }
}
