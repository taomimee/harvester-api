# Continuing trips, automatic plot copies and owner sessions

An owner can start a new trip for the same vehicle while an older trip remains open. Each trip retains its own daily work, broker receipts and receivable. The migration removes only the one-open-trip index; one vehicle per trip, GPS claim uniqueness, revision checks and atomic daily wage writes remain enforced. The creation form explains the existing open trip, and GPS entry asks which eligible trip should receive the work.

Owner bearer sessions previously lived only in a process-local Map and disappeared whenever the host restarted. The new backend stores only a SHA-256 token hash, expiry and a server-keyed PIN version in a private RLS-enabled table. The existing eight-hour expiry is retained. Logout deletes the session; a PIN change invalidates prior sessions. Database errors return 503 and never authorize a write or pretend the user logged out.

The frontend requests the PIN in an in-page dialog on a rejected owner request. It keeps the open form and retries once using the same request body and idempotency key. Cancellation leaves the draft available. It does not retain the PIN. The driver/owner switch also uses an in-page dialog.

Apply `supabase/migrations/20261110155250_trip_auto_sessions.sql` after a verified backup, then deploy the backend and frontend together. Existing in-memory owner tokens need one PIN confirmation after this deployment. Future server restarts do not invalidate stored sessions. Automatic editable plot publication is described in `gps-auto-area.md`.

Validation includes database restoration rehearsal, unchanged financial rows after migration and GPS replay, session restart/expiry/revocation tests, simultaneous automatic publication, preserved manual edits/deletions, shared-vehicle trips, GPS claims, and mobile browser checks at 390px. No real payments or daily work entries are created during verification.

Rollback: deploy the preceding application version. Keep the additive session/handled-parts schema for recovery. Do not restore the old one-open-trip index while multiple open trips exist, and do not close customer trips just to recreate that index. Existing financial data requires no restore for an application rollback.
