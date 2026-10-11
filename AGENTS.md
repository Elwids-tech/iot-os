# Project workflow

- After making changes, rebuild the affected local containers and verify the
  running application before reporting completion. Follow
  [.agents/skills/local-container-verification/SKILL.md](.agents/skills/local-container-verification/SKILL.md).
  Rebuild again after any subsequent implementation fix.
- Use suitable shared shadcn components for each interaction. Search within a
  selector belongs in a searchable selector, not a separate search field paired
  with a dropdown. Standalone search fields are appropriate for directory and
  table filters.
- Preserve the user's unsaved browser edits when verifying rebuilt pages.
- Prefix shell commands with `rtk`; use `rtk proxy` when unfiltered output is needed.

## Lessons

- 2026-09-27: The `users` table has no `uuid` column. Every API endpoint identifies users by integer id (`acknowledged_by`, `recipient_ids`, `created_by`, admin member routes), so new user references in API contracts use `user_id`, not a uuid.
- 2026-09-27: The Playwright browser pinned by `@playwright/test` (headless shell 1234) was not installed on this Mac; 1243 was. Point `launchOptions.executablePath` at `~/Library/Caches/ms-playwright/chromium_headless_shell-1243/...` in a scratch config instead of downloading. `vite preview` listens on `localhost` (::1), so e2e needs `STUDIO_BASE_URL=http://localhost:<port>`, not 127.0.0.1.
- 2026-09-27: Playwright `fullPage` screenshots make react-grid-layout re-measure and collapse dashboard panels in the capture. Grow the viewport height for dashboard screenshots instead.
- 2026-09-27: The containers build from source with no bind mounts, so a git worktree can be served by running compose from the worktree with the main checkout's env files: `docker compose --env-file <main>/.env --env-file <main>/.local/devices/devices.env -f deploy/compose/compose.dev.yml -f deploy/compose/compose.app.yml -f deploy/compose/compose.devices.yml up -d --build --no-deps api alerts-worker webhooks-worker assistant-worker portal admin`.
- 2026-10-10: Toasts sit bottom-right in portal and admin, and sonner pauses a toast while the pointer is over it. A new sticky bottom action bar needs `ref={keepToastsAbove}`, and a panel docked to the right edge needs `keepToastsLeftOf`, both from `@iot-os/ui/components/sonner`, or toasts will cover their buttons.
