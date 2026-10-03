<?php

declare(strict_types=1);

namespace App\Domain\Automation\Permissions;

use Althinect\EnumPermission\Concerns\HasPermissionGroup;

enum WorkflowPermission: string
{
    use HasPermissionGroup;
    case VIEW = 'Workflow.view';
    case MANAGE = 'Workflow.manage';
    case ACTIVATE = 'Workflow.activate';
}
