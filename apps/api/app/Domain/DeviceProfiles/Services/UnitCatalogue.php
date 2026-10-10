<?php

declare(strict_types=1);

namespace App\Domain\DeviceProfiles\Services;

use RuntimeException;

/**
 * Canonical units from contracts/units/v1/units.json. Custom units stay valid;
 * they simply have no quantity and are never converted.
 */
final class UnitCatalogue
{
    /** @var array{quantities: array<string, array{label: string, base: string}>, units: list<array<string, mixed>>}|null */
    private ?array $catalogue = null;

    /** @return array{quantities: array<string, array{label: string, base: string}>, units: list<array<string, mixed>>} */
    public function all(): array
    {
        if ($this->catalogue === null) {
            $path = rtrim((string) config('devices.contracts_path'), '/').'/units/v1/units.json';
            $raw = is_file($path) ? file_get_contents($path) : false;
            if ($raw === false) {
                throw new RuntimeException('The unit catalogue is unavailable.');
            }
            $decoded = json_decode($raw, true, 512, JSON_THROW_ON_ERROR);
            $this->catalogue = ['quantities' => $decoded['quantities'], 'units' => $decoded['units']];
        }

        return $this->catalogue;
    }

    /**
     * Exact spellings win. A case-insensitive match is used only when it is
     * unambiguous, so "mw" never guesses between milliwatt and megawatt.
     *
     * @return array<string, mixed>|null
     */
    public function resolve(?string $unit): ?array
    {
        $unit = trim((string) $unit);
        if ($unit === '') {
            return null;
        }
        $folded = [];
        foreach ($this->all()['units'] as $entry) {
            $spellings = [$entry['symbol'], ...$entry['aliases']];
            if (in_array($unit, $spellings, true)) {
                return $entry;
            }
            foreach ($spellings as $spelling) {
                if (mb_strtolower($spelling) === mb_strtolower($unit)) {
                    $folded[$entry['symbol']] = $entry;
                }
            }
        }

        return count($folded) === 1 ? array_values($folded)[0] : null;
    }

    /** The canonical symbol for a known unit, otherwise the trimmed custom unit. */
    public function canonical(?string $unit): ?string
    {
        $trimmed = trim((string) $unit);

        return $trimmed === '' ? null : ($this->resolve($trimmed)['symbol'] ?? $trimmed);
    }

    public function quantity(?string $unit): ?string
    {
        return $this->resolve($unit)['quantity'] ?? null;
    }

    /** Two spellings of the same unit, for example "kw" and "kW". */
    public function equivalent(?string $a, ?string $b): bool
    {
        return $this->canonical($a) === $this->canonical($b);
    }
}
