# Automatic harvested area in the existing GPS page

The GPS page shows the selected vehicle's daily harvested-area estimate without a measurement button. Both driver and owner views use the same result. The server processes GPS data independently of the browser and stores daily snapshots before the raw seven-day GPS history expires.

## Measurement and limits

- Header width is 3 metres for the existing vehicle, confirmed by the owner. Settings are held server-side in `gps_area_settings`.
- The old `is_harvesting` flag is a speed heuristic, not a header/PTO sensor. It is not treated as proof of harvesting.
- Measurement requires independent nearby parallel passes, sustained work, sufficient width and area. Slow isolated roads, stationary drift, jumps, and intervals over 90 seconds are excluded. Manually excluded route edges remain excluded.
- Areas are buffered from accepted passes, small GPS cracks are closed, thin entrance/exit tails are removed, and overlapping coverage is unioned. The result estimates a footprint, not distance multiplied by header width.
- Substantial unworked holes remain excluded. The method can undercount sparse tracks, very narrow fields, curved passes, or early work with insufficient supporting passes. GPS alone cannot verify the blade is cutting; repeated broad road manoeuvres may still need correction. The display explicitly identifies its result as an estimate.
- A component is considered departed only after at least five minutes of observed positions at least 60 metres away, without long GPS gaps. Stopping or losing a signal alone does not complete it. A later return contributes to the same daily footprint instead of multiplying area.
- Adjacent plots may form one continuous footprint. Component counts are not presented as verified cadastral plot counts; the headline is rai.

The measured result does not alter saved plot boundaries, existing customer jobs, broker-confirmed area, wages, or withdrawals. Saved-boundary totals are labelled separately from measured harvested area.

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
