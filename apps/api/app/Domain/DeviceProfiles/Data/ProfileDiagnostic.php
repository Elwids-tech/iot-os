<?php

declare(strict_types=1);

namespace App\Domain\DeviceProfiles\Data;

final readonly class ProfileDiagnostic
{
    public function __construct(
        public string $code,
        public string $message,
        public string $pointer,
    ) {}

    /**
     * @return array{code: string, message: string, pointer: string}
     */
    public function toArray(): array
    {
        return [
            'code' => $this->code,
            'message' => $this->message,
            'pointer' => $this->pointer,
        ];
    }
}
