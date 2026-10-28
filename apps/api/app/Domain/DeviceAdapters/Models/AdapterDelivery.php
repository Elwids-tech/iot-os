<?php

declare(strict_types=1);

namespace App\Domain\DeviceAdapters\Models;

use App\Domain\Devices\Models\DeviceModel;

/** A captured sample, a rejected delivery or a failed input, kept for 7 days. */
final class AdapterDelivery extends DeviceModel
{
    public const UPDATED_AT = null;

    protected $table = 'device_adapter_deliveries';

    protected function casts(): array
    {
        return ['input' => 'array', 'received_at' => 'datetime', 'size' => 'integer'];
    }

    public function view(): array
    {
        return [...$this->only(['uuid', 'kind', 'reason', 'source', 'source_address', 'path', 'content_type', 'size', 'delivery_id', 'error', 'input']), 'received_at' => $this->received_at?->toIso8601String()];
    }
}
