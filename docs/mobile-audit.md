# Mobile layout and locked-plot import check

## Scope

This updates the existing application. No database migration, worker algorithm,
accounting rate, role permission or previously confirmed daily total is changed.

- Phone widths: 320 and 390 CSS pixels; short landscape check: 740 × 360.
- Both roles: home and follow-up lists, active queues and expanded details,
  history/search, calendar/day details, field-trip lists/detail/GPS links,
  wage and withdrawal history, GPS live/history/statistics/plot drawer.
- Owner forms: customers, vehicles, worker details, queue create/edit/search,
  daily round/final job, plot list/merge review/editor, plot payment selection,
  receipt correction, billing-area adjustment, all finance subtabs and expense
  edit, trip create/edit/day/payment/void/close/reopen.
- Driver forms: daily round, job photo list/fullscreen viewer, trip-to-wage
  navigation; existing owner-only trip/financial controls remain absent.
- GPS tools: boundary edit, holes, route eraser, queue selection and new-customer
  draft. Mobile queue linking now covers the viewport instead of only the map's
  remaining height, so the form is usable in landscape.

Layout inspection used a local copy of read-only API data plus synthetic active
jobs. Financial submissions were not performed against production. Native
browser prompts and real uploads/payments are not end-to-end layout assertions.
Horizontal thumbnail strips are intentional; document-wide horizontal overflow
was not present in the checked states after the fixes.

## Fixed issues

- Light native controls and heading colors remain legible when the device uses
  dark appearance; the existing application surfaces use the light palette.
- Narrow navigation, finance menus, long queue names/statuses and action groups
  wrap; forms retain readable input text and phone-size touch targets.
- Daily-round figures use labeled rows on phones instead of three tiny columns.
- Photo category/upload controls stack, and plot/photo thumbnails use two columns.
- Expense date/payer/note fields stack; plot payments use the dialog's main scroll
  instead of nesting a short scrolling plot list inside it.

## Locked plot import regression

GPS difference geometry can contain disconnected pieces below 1 square metre.
Those pieces previously made the editable-plot validator reject the entire
locked field. `prepareAutoPlotUse` now skips only **new** sub-square-metre pieces,
closes coordinate rings for area calculation, and reports the omitted count/area
in the field-trip handoff. Original lock receipts remain unchanged, original part
IDs are retained, and any existing edited/linked copies are reused untouched.
The manual/server minimum-area validation remains in force.

The reported November 9 second plot was replayed locally: two usable pieces
imported, seven fragments (about 1.13 m² total) skipped. The existing daily row,
confirmed area, plot count, harvesting charge and wages remained unchanged after
adding the GPS references. The existing persisted-database regression also
checks that GPS-only corrections and retries do not duplicate daily wages.

Validation: all 43 Node tests pass; production build succeeds; focused ESLint
checks for FieldTrips and the import helper pass. Build retains the existing
large-bundle advisory. Private snapshots and backup archives are kept locally
and are not part of this repository.
