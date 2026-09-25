<?php

declare(strict_types=1);

namespace App\Domain\Automation\Models;

use App\Domain\Devices\Models\DeviceModel;

final class Deployment extends DeviceModel
{
    protected $table = 'automation_deployments';

    public $timestamps = false;

    protected function casts(): array
    {
        return ['definition' => 'array', 'generation' => 'integer', 'draft_revision' => 'integer'];
    }

    protected static function booted(): void
    {
        parent::booted();
        self::updating(function (self $deployment): void {
            foreach (['uuid', 'automation_workflow_id', 'generation', 'draft_revision', 'target', 'definition', 'definition_hash', 'created_by', 'created_at'] as $field) {
                if ($deployment->isDirty($field)) {
                    throw new \LogicException('Deployment snapshots are immutable.');
                }
            }
        });
        self::deleting(static fn () => throw new \LogicException('Deployment history cannot be deleted.'));
    }
}
