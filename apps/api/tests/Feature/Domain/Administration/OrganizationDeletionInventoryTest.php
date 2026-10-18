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
        $handled = [...OrganizationDeletion::blockingTables(), ...OrganizationDeletion::REMOVED_FIRST];
        $kept = [];
        $unhandled = [];
        $seen = 0;

        foreach (Schema::getTables() as $table) {
            foreach (Schema::getForeignKeys($table['schema_qualified_name'] ?? $table['name']) as $key) {
                if ($key['foreign_table'] !== 'organizations') {
                    continue;
                }

                $seen++;

                if (in_array($table['name'], OrganizationDeletion::KEPT, true)) {
                    $kept[$table['name']] = strtolower((string) $key['on_delete']);

                    continue;
                }

                if (strtolower((string) $key['on_delete']) !== 'cascade' && ! in_array($table['name'], $handled, true)) {
                    $unhandled[] = sprintf('%s.%s (on delete %s)', $table['name'], implode(',', $key['columns']), $key['on_delete']);
                }
            }
        }

        $this->assertGreaterThan(30, $seen, 'The schema listing found too few keys to organizations; the check is not looking at the right tables.');
        $this->assertSame([], $unhandled, 'Classify these in OrganizationDeletion::BLOCKERS, REMOVED_FIRST or KEPT, or make them cascade.');
        // Kept records must survive the organization, so their key sets null.
        $this->assertSame(array_fill_keys(OrganizationDeletion::KEPT, 'set null'), $kept);
    }

    public function test_every_classified_table_exists_and_refers_to_organizations(): void
    {
        foreach ([...OrganizationDeletion::blockingTables(), ...OrganizationDeletion::REMOVED_FIRST, ...OrganizationDeletion::KEPT] as $table) {
            $this->assertTrue(Schema::hasColumn($table, 'organization_id'), "{$table}.organization_id is missing");
        }
    }
}
