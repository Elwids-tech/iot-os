<?php

declare(strict_types=1);

namespace App\Support\Contracts;

use Stringable;

/**
 * One failing keyword and where it failed. It never carries instance values: the
 * missing names of a `required` failure come from the schema.
 */
final readonly class ContractViolation implements Stringable
{
    /**
     * @param  string  $instanceLocation  JSON Pointer, '' for the root
     * @param  list<string>  $missing
     */
    public function __construct(
        public string $keyword,
        public string $instanceLocation,
        public array $missing = [],
    ) {}

    /**
     * @return array{keyword: string, instance_location: string, missing?: list<string>}
     */
    public function toArray(): array
    {
        $value = ['keyword' => $this->keyword, 'instance_location' => $this->instanceLocation];
        if ($this->missing !== []) {
            $value['missing'] = $this->missing;
        }

        return $value;
    }

    public function __toString(): string
    {
        $text = $this->keyword.' at '.($this->instanceLocation === '' ? '(root)' : $this->instanceLocation);

        return $this->missing === [] ? $text : $text.' (missing '.implode(', ', $this->missing).')';
    }
}
