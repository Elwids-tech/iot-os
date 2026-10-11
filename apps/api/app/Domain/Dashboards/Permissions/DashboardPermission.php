<?php

declare(strict_types=1);

namespace App\Domain\Dashboards\Permissions;

use Althinect\EnumPermission\Concerns\HasPermissionGroup;

/**
 * Dashboards have permissions of their own. View opens dashboards shared with
 * the organization or with you; create lets you make dashboards, which you own
 * and can edit and share; manage edits, deletes and shares any dashboard.
 */
enum DashboardPermission: string
{
    use HasPermissionGroup;

    case VIEW = 'Dashboard.view';
    case CREATE = 'Dashboard.create';
    case MANAGE = 'Dashboard.manage';
}
