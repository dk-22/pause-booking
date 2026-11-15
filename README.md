# Pause — Angular, Spartan UI and Supabase

## Run locally

Use a Node version supported by Angular 21, such as the project's current Node 20.20.2 or Node 22.22.3+.

```sh
npm install
npm start
```

Open http://localhost:4200. `npm start` uses the development configuration with dependency prebundling. `npm run build` creates an optimized production build in `dist/booking-massage/browser`. Use the project's scripts instead of a global Angular CLI.

## Interface

Pause has its own design system, described in `design-system/DESIGN.md`: linen paper, vetiver green, Young Serif for headings and DM Sans for text. Spartan (Helm) components still provide behaviour, focus management and accessibility; their look is set in `src/theme.css`.

- `src/booking-page.html` + `src/main.ts`: the employee booking page. A green panel holds the campaign choice; days are tiles with a fill bar; times are grouped by part of day with attendee initials; the booking dialog offers the closest free times if a time fills, and ends in a confirmation pass with a calendar download.
- `src/admin-page.html` + `src/admin.ts`: sign-in, campaign list (summary, fill bars, on-row status switch), campaign editor (date cards, visibility choice, live preview), business units (chips), profile editing and all confirmations.
- `src/bookings-page.html` + `src/bookings.ts`: bookings grouped by day and time, search with highlighting, CSV download, printable attendance sheet, edit and cancel.
- `src/admin-users.html` + `src/admin-users.ts`: administrators as people cards with an access switch. Administrators edit only their own name, from the account menu.
- `src/ui`: source-owned Helm components from Spartan 1.9.0; see its README and MIT license.
- `src/theme.css`: Tailwind v4 setup, tokens, booking-page styles (`pz-` classes) and the admin skin (`body.pa`, `pa-` classes).
- `src/fonts`: Young Serif (SIL Open Font License), bundled locally with DM Sans.

Employee codes accept digits only, on the booking form and in the admin. Wording is generic: campaigns can be for any bookable activity.

Two rules are enforced in the interface only, not yet in the database: digits-only employee codes, and administrators changing only their own name.

## Browser checks

```sh
npx playwright install chromium
npm run test:ui
```

The suite (`tests/pause-ui.spec.ts`) starts a development server on port 4201 if needed. It uses mocked Supabase responses and blocks hosted realtime connections; it does not create live bookings or send email. Tests cover the booking flow (digits-only code, duplicate warning, a time filling up, the confirmation pass and calendar file), business-unit pickers, phone layouts, and in the admin: sign-in, the campaign list and editor, bookings (edit, cancel, download), business units, administrators and profile editing.

## Supabase setup

1. Create a Supabase project and keep its database password secure.
2. Apply `supabase/migrations/001_initial.sql` through `015_cancel_booking.sql` in numeric order in SQL Editor. For an existing project, apply only migrations not already applied. The initial migration creates a new database schema; it does not import Firebase records.
3. Copy the project URL and public publishable key (or legacy anon key) into `src/supabase-config.ts`. Never put a service-role key or database password in the frontend.
4. Under Authentication → URL Configuration, allow `http://localhost:4200/bk-admin-codex/login` and your deployed sign-in URL. Enable email authentication and configure SMTP for actual delivery. Keep the magic-link template's `{{ .ConfirmationURL }}`.
5. Add an approved administrator after the migrations:

```sql
insert into public.admin_emails(email, full_name, enabled)
values ('your.actual.email@example.com', 'Your Full Name', true)
on conflict(email) do update
set full_name=excluded.full_name, enabled=true;
```

6. Open Admin portal, request a sign-in link and open it. A verified account must match an enabled admin entry; creating an Auth account does not grant admin access.
7. Configure business units, create a campaign with future dates, and publish it.

To revoke access, set `admin_emails.enabled` to false. Every protected read and operation checks current admin authorization in the database.

Apply `013_admin_profile.sql` to display names from `admin_emails.full_name` in the navbar account menu. Until it is applied, the menu falls back to the sign-in profile or email initials.

## Database updates

- 001: tables, policies, booking transactions, admin functions and realtime.
- 002–006: campaign editing/deletion, scheduled-date replacement, idempotent saves and publishing.
- 007–008: business-unit changes and configured dropdown validation.
- 009: admin booking editing and rescheduling with optimistic concurrency.
- 010: admin full names, last-save details and audit history.
- 011: safe business-unit replacement.
- 012: indexes, paginated booking reads and scoped campaign metadata.
- 013: the signed-in administrator’s name and email for the account menu.
- 014: paginated administrator directory, audited administrator creation/name edits and activation changes.
- 015: audited booking cancellation with administrator identity, cancellation time and transactional capacity release.

Campaign and date deletion are protected when booking history exists. Date edits/removals remain staged until Save campaign. Exact save retries do not append duplicate dates. Existing duplicate dates are not removed automatically.

## Architecture

Angular calls protected Postgres RPCs. `create_booking` validates the campaign, session, expiry and business unit, serializes retries and employee eligibility with advisory locks, and locks the slot before consuming capacity. It commits the booking and public names together. A partial unique index enforces one confirmed booking per campaign and normalized employee code. Exact retries return the original reference.

Admin RPCs check the authenticated account's verified email against `admin_emails`. Employee codes and business units remain private. Browser table writes are revoked. Realtime refreshes availability; database transactions protect correctness. Campaign/booking reads use scoped subscriptions and pagination; availability also refreshes as time slots expire.

## Deployment and database verification

Build with `npm run build`. Host `dist/booking-massage/browser` on a static host that serves `index.html` for `/bk-admin-codex` and `/bk-admin-codex/login`. Apply migrations separately in Supabase.

`supabase/tests/booking.py` and the SQL fixtures validate booking concurrency, idempotency, authorization, editing, history and loading behavior. Run these only against a disposable migrated PostgreSQL database with the required Supabase auth roles/functions. Do not run fixtures against production.

Browser mocks and a local build do not validate live SMTP, hosted Realtime or production database policies. Cancellation, reminders and production abuse protection are separate features.


The admin sidebar holds Pause branding at the top and the account menu (Edit profile, Sign out) at the bottom. It collapses to icons on desktop and opens as a sheet on mobile. It provides Campaigns, Bookings, Business units and Administrators, plus a link that opens the booking page in a new tab. Apply migration 014 to enable administrator management. All active administrators share the same permissions. Email addresses cannot be changed; deactivate the old account and add the corrected address if necessary. Self-deactivation is blocked on the server. New accounts use the existing passwordless sign-in flow; adding an administrator does not send an email.

Administrator changes are recorded in audit logs and use update timestamps to reject stale edits. `supabase/tests/admin-management.sql` exercises creation, edits, activation, self-deactivation protection and unauthorized access in a disposable database.


Administrators can cancel a confirmed booking from its menu on the Bookings screen, or from the Edit booking dialog, after confirming. Apply migration 015 first. Cancelled bookings stay listed under their time slot, behind “Show cancelled”, with the administrator’s name and Mauritius timestamp. Cancellation releases capacity and removes only cancelled attendees from public slot names. The employee can make a new booking with a new request reference. Duplicate cancellations do not release capacity twice or change the original cancellation attribution. `supabase/tests/cancel-booking.sql` covers cancellation, stale edits, retries, rebooking and permission checks.


On the employee booking page, a lone campaign is selected automatically and the page opens on the first day that still has places. Business units appear as chips for up to eight units and as a searchable A to Z list for more, with “Other” last. Choosing a time opens the booking dialog directly.

Admin booking status filters: apply `supabase/migrations/016_booking_status_filter.sql` in the Supabase SQL Editor. This adds an admin-only paginated query for Confirmed and Cancelled bookings; existing all-status queries remain compatible.

Pagination: apply `supabase/migrations/017_ten_rows_per_page.sql` for 10 rows per page in campaigns and administrators. The Bookings screen loads every booking of the selected campaign, ten at a time, so it can group, total and export them; it is capped at 2,000 bookings per campaign. The campaign list summary and sort order cover the campaigns on the current page.


### Admin-only sign-in requests

1. Run migration `018_admin_sign_in_requests.sql` in Supabase SQL Editor.
2. Set the Edge Function secret `ADMIN_SIGN_IN_ORIGINS` to a comma-separated list of exact app origins, e.g. `http://localhost:4200,https://your-app.example`. No trailing slash. The redirect is fixed to `/bk-admin-codex/login` on the requesting allowed origin; also allow these redirects in Auth URL Configuration.
3. Deploy with `npx supabase functions deploy request-admin-sign-in --no-verify-jwt`. Supabase supplies `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to hosted functions. Never put the service role key in Angular.
4. Keep your existing Auth SMTP configuration. The function checks enabled `admin_emails` records before calling Supabase Auth; new authorized accounts can still be created on their first sign-in. Requests share a database-backed 60-second cooldown per enabled email.

The UI intentionally returns the same message for enabled, inactive, unknown and rate-limited addresses. Provider/database failures are logged without exposing addresses or tokens; inspect Edge Function and Auth logs if delivery fails. The browser has no fallback to direct OTP requests. An undeployed function produces a request error.

Scope: this gates requests through the app. Supabase's public `/auth/v1/otp` endpoint still exists and can be called outside the app. To enforce the recipient allowlist for every Auth email, configure a Supabase Send Email Hook with the same enabled-admin check and a mail provider; that hook replaces built-in SMTP delivery. A client-side check or Before User Created hook alone cannot prevent emails to previously created non-admin Auth users. Existing `is_admin()` checks still reject unauthorized sessions.

## Publish on GitHub Pages

The workflow in `.github/workflows/pages.yml` builds and publishes pushes to `main`.
In the GitHub repository, select **Settings → Pages → Source → GitHub Actions**.

- Employee website: https://dk-22.github.io/pause-booking/
- Administration: https://dk-22.github.io/pause-booking/bk-admin-codex/
- Admin sign-in callback: https://dk-22.github.io/pause-booking/bk-admin-codex/login/

The Pages build uses `npm run build:pages`. It sets the Angular base path to
`/pause-booking/` and creates admin entry documents so direct links work.

Before using hosted admin sign-in:

1. In Supabase **Authentication → URL Configuration**, set Site URL to
   `https://dk-22.github.io/pause-booking/` and add both
   `https://dk-22.github.io/pause-booking/bk-admin-codex/login` and
   `https://dk-22.github.io/pause-booking/bk-admin-codex/login/` to Redirect URLs.
   Keep `http://localhost:4200/bk-admin-codex/login` for local development.
2. In **Edge Functions → Secrets**, set `ADMIN_SIGN_IN_ORIGINS` to
   `http://localhost:4200,https://dk-22.github.io`.
3. Set `ADMIN_SIGN_IN_REDIRECT_URLS` to
   `https://dk-22.github.io/pause-booking/bk-admin-codex/login`.
4. Deploy the updated sign-in function:

   ```sh
   npx supabase functions deploy request-admin-sign-in --no-verify-jwt
   ```

Only public Supabase configuration belongs in the frontend. SMTP passwords,
service-role keys and Edge Function secrets stay in Supabase. The Git ignore
rules exclude local settings, environment files, dependencies and generated previews.
