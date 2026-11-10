# Automatic harvested area in the existing GPS page

The GPS page shows the selected vehicle's daily harvested-area estimate without a measurement button. Both driver and owner views use the same result. The server processes GPS data independently of the browser and stores daily snapshots before the raw seven-day GPS history expires.

## Measurement and limits

- Header width is 3 metres for the existing vehicle, confirmed by the owner. Settings are held server-side in `gps_area_settings`.
- The old `is_harvesting` flag is a speed heuristic, not a header/PTO sensor. It is not treated as proof of harvesting.
- Measurement requires independent nearby parallel passes, sustained work, sufficient width and area. Slow isolated roads, stationary drift, jumps, and intervals over 90 seconds are excluded. Manually excluded route edges remain excluded.
- Areas are buffered from accepted passes, small GPS cracks are closed, thin entrance/exit tails are removed, and overlapping coverage is unioned. The result estimates a footprint, not distance multiplied by header width.
- Substantial unworked holes remain excluded. The method can undercount sparse tracks, very narrow fields, curved passes, or early work with insufficient supporting passes. GPS alone cannot verify the blade is cutting; repeated broad road manoeuvres may still need correction. The display explicitly identifies its result as an estimate.
- A component is locked after at least five minutes of observed positions at least 60 metres from its measured boundary, without long GPS gaps. Stopping or losing a signal alone does not complete it. The daily snapshot keeps append-only lock receipts (`locked_plots`) with area, geometry, time and a stable field number. The GPS list and map show these automatically in driver and owner modes.
- A return through a locked field does not change its saved receipt. New harvested coverage is clipped against all locked coverage, then appended to the original field number after the next confirmed departure. Before departure it is shown as additional work in progress. Up to 25 square metres of residual GPS/buffer slivers on a repeated visit are ignored.
- An explicit manual route correction or header-width change permits recalculation of that day's locks; unrelated new GPS cannot reshape an existing receipt. The lock is an automated measurement record, not a claim that the surveyed/customer field is complete. A long unloading trip outside the threshold can cause a lock; a return is handled without an extra field count.
- Adjacent plots may form one continuous footprint. Component counts are not presented as verified cadastral plot counts; the headline is rai.

Automatic measurement alone does not alter manually saved plot boundaries, customer jobs, broker-confirmed area, wages, or withdrawals. Saved editable copies have their own section in the same plot list. Locks use the existing `gps_area_daily.result` JSON; no schema or access changes are needed.

## Using a locked plot

The lock card offers queue linking, boundary editing and (for owners) field-trip entry. These actions copy only locked receipts into the existing `harvest_plots` workflow. Receipt/part IDs are stable: retries reuse a saved copy and retain its edits and queue assignment. Additional locked coverage creates only the missing parts. The source lock stays intact.

Every MultiPolygon part and inner exclusion ring is retained. Parts share `auto_origin.plot_id`, so queue summaries and field-trip references count the logical field once while summing all its areas. Selecting a queue from the auto card applies to all reviewed parts. Substantial overlap with another saved plot is shown for review before queue linking.

The field-trip handoff asks for the destination trip, selects the GPS references and opens the existing daily entry if present. It preserves confirmed rai, plot count, crew and price. A new day still requires confirmed rai and crew before posting wages. Linking or editing geometry alone never posts wages or receives money. An already queued plot cannot enter a field-trip day; a claimed field-trip reference is rejected when saving a customer queue link.

Saved field-trip GPS references are snapshots: reopen and save the existing daily entry to refresh an edited reference. Confirmed rai changes only through that explicit daily form. No new tables, migrations, or LINE delivery are part of this update.

On phones the existing main navigation shows every tab in two rows. Field-trip headings use explicit dark text on their light surfaces, including on phones preferring dark mode. Daily, receipt and trip-edit dialogs scroll their body independently while keeping the title/close control and save/cancel actions visible; the background page is locked until the dialog closes. Layout checks cover 320 and 390 pixel viewports and both existing roles.

To undo this UI extension, redeploy the previous source commit. Imported copies remain compatible with the original plot editor, and no business-data restore or GPS-schedule change is needed.

## Data and background execution

1. Apply `supabase/migrations/20261109053812_gps_auto_area.sql` after taking a verified backup.
2. Deploy the original backend and frontend from the same release. The backend uses the existing service-role connection.
3. After HTTP deployment is healthy, run `supabase/gps-area-schedule.sql`. A two-minute database schedule calls the existing backend only while fresh GPS is arriving. The backend also refreshes while running.
4. Check the scheduled HTTP response and the daily snapshot timestamp with the browser closed. No LINE messages are sent by this release. `/api/gps-area/:vehicle?date=YYYY-MM-DD` provides a future integration's daily total and observation timestamp.

New tables enable RLS, deny public/client access, and grant only the existing backend required access. Worker credentials stay in the database/backend; they are never returned by the read endpoint. Snapshot writes use revision comparisons. Expired raw data cannot replace a saved full-day result with a partial/empty measurement. Failures remain errors rather than zero rai.

## Verification and rollback

`npm test` covers road rejection, drift, gaps, overlapping passes, departure/return, manual cuts, background persistence, duplicate requests, storage permissions and the actual HTTP/worker boundary. The frontend builds with `npm run build` in `harvester-app`.

`node scripts/audit-gps-history.cjs INPUT.json OUTPUT.json` compares an offline daily snapshot against saved polygons; those polygons are reference data, not surveyed ground truth. Keep real traces and audit outputs out of the public repository.

To roll back, disable the `harvester-gps-area` schedule and deploy the previous code. Keep the new snapshot tables intact for recovery; no removal or restoration of business records is required.
