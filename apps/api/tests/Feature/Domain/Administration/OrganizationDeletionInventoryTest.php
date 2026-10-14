<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Administration;

use App\Domain\Administration\Services\OrganizationDeletion;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

/**
 * Spec 006 FR-008: deleting an organization must not meet a foreign key nobody planned
 * for. A new key to organizations either cascades or is classified in OrganizationDeletion.
 */
final class OrganizationDeletionInventoryTest extends TestCase
{
    use RefreshDatabase;

    public function test_every_foreign_key_to_organizations_cascades_or_is_classified(): void
    {
        $handled = [...array_keys(OrganizationDeletion::BLOCKERS), ...OrganizationDeletion::REMOVED_FIRST];
        $unhandled = [];
        $seen = 0;

        foreach (Schema::getTables() as $table) {
            foreach (Schema::getForeignKeys($table['schema_qualified_name'] ?? $table['name']) as $key) {
                if ($key['foreign_table'] !== 'organizations') {
                    continue;
                }

                $seen++;

                if (strtolower((string) $key['on_delete']) !== 'cascade' && ! in_array($table['name'], $handled, true)) {
                    $unhandled[] = sprintf('%s.%s (on delete %s)', $table['name'], implode(',', $key['columns']), $key['on_delete']);
                }
            }
        }

        $this->assertGreaterThan(30, $seen, 'The schema listing found too few keys to organizations; the check is not looking at the right tables.');
        $this->assertSame([], $unhandled, 'Classify these in OrganizationDeletion::BLOCKERS or REMOVED_FIRST, or make them cascade.');
    }

    public function test_every_classified_table_exists_and_refers_to_organizations(): void
    {
        foreach ([...array_keys(OrganizationDeletion::BLOCKERS), ...OrganizationDeletion::REMOVED_FIRST] as $table) {
            $this->assertTrue(Schema::hasColumn($table, 'organization_id'), "{$table}.organization_id is missing");
        }
    }
}
