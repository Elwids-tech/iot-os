# Quickstart: Activity Log

1. Rebuild the api family and admin (`docs/dev/local-setup.md#rebuild-one-service`); the
   api runs the migration, which copies `device_audit_events` into `activity_log`.
2. `docker compose … exec api php artisan tinker --execute 'echo App\Domain\Audit\Models\Activity::count();'`
   matches the old row count.
3. In the portal, as an organization admin: rename a device, change a member's roles,
   rename a dashboard, add a parameter to a device profile draft.
4. In the admin app, open **Activity**: the four entries are at the top with the
   person, organization, subject and changes.
5. Pick the organization, then the person, in the selectors; reload the page and the
   filters stay. **Clear filters** returns to everything.
6. Open a billing account: its history is unchanged. Open **Retention**: the last
   cleanup still shows.
