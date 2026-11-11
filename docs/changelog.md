# Changelog

Newest entry first. One "## HANDOFF" entry is appended at the end of every
working session. Do not put secrets in this folder; it is synced to Claude.ai.

## HANDOFF — TEMPLATE (copy for each session)

**Date:** YYYY-MM-DD
**Branch:** branch-name

**What changed**
- 

**What's next**
- 

**Blocked / needs a decision**
- 

---

## HANDOFF — 2026-11-12 (accidental deletions: wait before believing a calendar deletion)

**Branch / PR:** `delayed-calendar-cancel`, one PR against `main`, not merged. Independent of the cancellation-emails PR.

**What changed**
1. **A calendar deletion now waits five minutes.** When Nylas reports a Revie booking's event as cancelled or deleted, nothing is cancelled: a row goes into Postgres (`nylas_event_cancellations`) due in five minutes. The sweeper's tick (every minute, in the web service) picks up due rows, reads the event again from Nylas, and only a still-cancelled or gone event runs the existing coach-cancel path (full refund, Sharetribe cancellation emails). If it is back (undo, restore) nothing happens and a log line says so once. A notice that the event is confirmed again ends the wait immediately. Restarting or deploying during the wait loses nothing, because the wait is in the database. A real `booking.cancelled` from our own cancel button is **not** delayed.
2. **Found and fixed on the way:** a refund that failed would have left the booking marked cancelled but unrefunded and then been skipped on retry. The retry now looks at the transaction itself, so it is tried again (after five minutes, reported to Sentry as `nylas-event-cancel-failed`).
3. **A client cannot cancel from their own calendar.** Only the coach's calendar is watched. A client declining the invite changes the guest list on the coach's event, whose status stays confirmed, so it is ignored (tested); a client deleting their own copy produces nothing we receive, and the same event id under any other grant never matches a booking (tested).
4. **Client cancel button:** it already had a confirm step ("Cancel this session?" with "Yes, cancel my session" / "No, keep my session"). Inside 48 hours it said "It's less than 48 hours away, so you'll still be charged for it." Now it says "…so you'll still be charged in full and you won't get a refund.", the go-ahead button reads "Cancel and pay in full" (instead of the harmless-sounding "Yes"), and the cancelled message says "charged in full". If the server cannot say whether it is inside 48 hours, the generic text now mentions the charge too.

**Retest, step by step**
1. After deploy, book a session as a client, then as the coach delete its event from Google Calendar.
2. Straight away: nothing changes in Revie (the booking is still accepted, no refund).
3. Press undo in Google Calendar within five minutes. Five minutes later: still accepted. Render logs say the event was restored.
4. Delete it again and leave it. About five to six minutes later: the booking is cancelled, the client is refunded in full and both get the cancellation email. Render shows `[jobs] calendar deletions {...cancelled: 1}`.
5. As the client, decline the invitation in your own Google Calendar for another booking: nothing happens in Revie.
6. As the client, press "Cancel session" inside 48 hours: the wording names the full charge, the button reads "Cancel and pay in full".

**Not verified:** against live Nylas and Google. In particular what Nylas sends when the coach undoes a deletion (a `confirmed` update, or nothing: both are handled, because the event is read again at the end of the wait anyway), and that a restored Google event is returned by the event lookup.

---

## HANDOFF — 2026-11-11 (session wizard tab fix, coach setup card)

**Branch / PR:** `session-wizard-and-setup-card`, one PR against `main`, not merged.

**Bug 1, cause:** the wizard's check for "fixed-length session" read `listingTypeConfig.unitType`. The hosted listing type does have `unitType: "fixed"` at the top level (Dev: `signature-session`, process `default-booking/release-1`), but the app restructures hosted listing types on load (`restructureListingTypes` in `configHelpers.js`) and moves it to `transactionType.unitType`. So on the deployed site the check was always false and the Availability tab stayed; the Next button is disabled there because the tab is incomplete until a default schedule is set. #21's test passed because it used a hand-written config in the wrong shape. Publishing itself is not gated on an availability plan anywhere in the wizard (the tab list decides what is required), so with the tab gone a session goes Details → Pricing → Photos and publishes without one; whether the Marketplace API accepts a booking listing with no plan is only checked end to end (step 3 below). The fix reads `transactionType.unitType`; the new test runs the real hosted shape through `mergeConfig`, and fails against the old check (checked).

**Bug 2, what changed:** on the coach's own session listing the red "Connect your calendar..." sidebar text and the dark "Please add your payout details" banner are replaced by one setup card in the sidebar: "Clients can't book this session yet" / "Finish these and it goes live automatically." with two steps, "Connect your calendar" (to `/account/calendar`) and "Add payout details" (to the stock payout page), each a secondary button until done and a tick with no button once done. Maroon text, body size, no error red. When both are done the card does not render; a plain "we're setting up this session" line shows meanwhile if the server has not finished. Clients and visitors see "This coach isn't taking bookings yet." in plain body text. The stock payout banner is hidden on fixed-length session pages only. Card states are also in the styleguide (Components → SessionSetupCard).

**Payouts are now required for a session to go live (added to this PR at your request):** `ensureBookable` only enables calendar booking when the coach has a connected calendar **and** `stripeConnected`. Calendar only or payouts only: not bookable (clients see "This coach isn't taking bookings yet", the coach sees the setup card). Payout status is part of the sync signature, so adding payout details enables the listing on the next loop, within a minute. If an enabled listing's coach loses `stripeConnected`, booking is switched off on it and reported to Sentry once (`nylas-booking-disabled-no-payouts`). If the status cannot be read, the listing is left alone. Existing listings whose coaches already have payouts do not change (dry run on both Dev listings: only a signature key is rewritten). Tests: calendar only, payouts only, both, payouts added later (next loop), payouts removed (off, reported once, back on when re-added), unknown status, and the old-signature listing, plus the whole loop end to end.

**Retest, step by step**
1. After deploy, as a new coach, start a new Signature Session. The steps should be Details, Pricing, Photos only, with no Availability tab and no "set a default schedule" gate.
2. Publish it. It must publish without an availability plan (watch for an API error on the last step; if there is one, tell me the message).
3. Open the published listing as the coach with no calendar and no payouts: one card, two buttons, no red text and no dark banner.
4. Connect the calendar and come back: that step has a tick and no button, and the payout step still has its button. The listing must **still not** be bookable: open it as the client (second browser) and it says "This coach isn't taking bookings yet." in normal text. In Console, `calendarBookingEnabled` should not be true.
5. **Add payout details last** (account settings, Payments). Then wait: **within a minute** the coach's card disappears (after a refresh), the client's page shows the booking form, and Console shows `calendarBookingEnabled: true` with the configuration ids. Watch Render's logs for `[jobs] reconcile` with `synced: 1`.
6. Optional: remove the payout details in Stripe (or, simpler, ask me to) and within a minute the client's page goes back to "isn't taking bookings yet" and Sentry shows one `nylas-booking-disabled-no-payouts` event.

**Not verified:** the card and the wizard on the real site while logged in (the card states were viewed in the styleguide in a browser; the wizard and listing page are covered by tests only), and publishing without a plan against the live API.

---

## HANDOFF — 2026-11-11 (coach deletes the event from Google Calendar: refund)

**Branch / PR:** `coach-calendar-delete-refund`, one PR against `main`, not merged.

**Cause:** the Nylas webhook destination on revie-dev is subscribed to `booking.created`, `booking.pending`, `booking.rescheduled` and `booking.cancelled` only. `booking.cancelled` is for cancellations made *through* the Scheduler. A coach deleting the event in Google Calendar is a plain calendar change, which Nylas reports as `event.updated` (status `cancelled`) or `event.deleted`, so Nylas never called us. Render's logs confirm it: in the last 30 hours the only webhook request was one `booking.created`; nothing for the deletion.

**What changed:** `calendarEventSync.js` handles `event.updated` / `event.deleted`. It matches an event to a booking only by the stored grant id + event id (new table `nylas_booking_events`), ignores everything else straight away, and sends a match through the same cancel path as `booking.cancelled` (a coach cancellation: full refund, Sharetribe's cancellation emails, `cancelledBy: provider`; if the client had used our cancel button first, it is treated as theirs). Safe to repeat: a second notification, or `booking.cancelled` arriving too, refunds nothing further. The event id is stored when a booking is made (it is in the creation response, not in the `booking.created` webhook) and refreshed on reschedule; `eventIdBackfill.js` fills it in for bookings that have none.

**Needs you (I did not touch the Nylas dashboard):** add two triggers to the existing webhook destination, then retest.
1. Open the Nylas dashboard, switch to the **EU application** (the one used by revie-dev), go to **Notifications**, open the webhook destination whose URL is `https://revie-dev.onrender.com/api/nylas/webhooks`, press **Edit**.
2. Under the event triggers tick **`event.updated`** and **`event.deleted`** (keep the four `booking.*` ones ticked). Save. The signing secret does not change, so nothing needs updating in 1Password or Render. (If the dashboard does not list them, the same change can be made through the API; ask and I will give you the call.)

**Retest, step by step**
1. Merge, wait for the Render deploy, and do step 2 above.
2. Wait two minutes. The server finds the calendar event of each existing upcoming test booking by itself (Render logs show `[jobs] event id backfill {...}`; `resolved` should equal `checked`). A booking that was already cancelled by hand before this is not fixed retroactively; refund that one in Stripe/Console if you still want it.
3. As a client, book a session (or use an existing upcoming one).
4. As the coach, delete the event from Google Calendar.
5. Within about a minute: the order page and inbox read cancelled, Stripe shows a full refund, the client and the coach each get the Sharetribe cancellation email, and the transaction in Console is `cancelled` with `cancelledBy: provider`. Render shows `[nylas] event.updated -> refunded`.
6. Delete an event that is not a Revie session (any ordinary calendar entry): nothing happens and nothing is logged beyond the access line.

**Not verified:** against live Nylas. I confirmed from Nylas's own mock payloads that `event.updated` carries `id`, `grant_id`, `calendar_id` and `status`, that a deleted Google event is kept as `status: cancelled` (seen on this coach's calendar), and that the booking object returned by Nylas has an `event_id`. Not confirmed: the exact notification Nylas sends for a Google deletion (the Nylas help page that says Google gets `event.updated` could not be opened; both triggers are handled for that reason), and that reading a booking back with a session works for the backfill. If the backfill cannot resolve a booking, only bookings made after this deploys are covered; the log line says so.

---

## HANDOFF — 2026-11-10 (coach booking setup: automatic, with working hours)

**PRs, both not merged:** #20 (server, stacked on #19) and this one (client, stacked on #20). Merge in order: #19, #20, then this.

**What it does:** a coach who has connected their calendar no longer needs any manual step for clients to be able to book their sessions. Every minute the server checks every published session listing and, for coaches with a calendar, sets each one up: a Nylas configuration per session length (price variant), the calendar, working hours, notice, and the release-4 process (new listings are stamped release-1 by the listing type). The same happens straight away when a coach connects a calendar or saves their hours. On the coach side: **Account settings → Calendar** now has **Working hours** (days, start, end, timezone; default Mon-Fri 9:00-17:00). A session whose coach has not been set up shows "This coach isn't taking bookings yet." instead of the old booking form; the coach sees a link to connect their calendar. The listing wizard no longer asks for availability on sessions.

**Changed from the plan:** (1) hours are stored with ISO weekday numbers (1 = Monday), the shape the availability filter already used, not day names; (2) the loop skips a coach with no calendar after one query (their author record comes with the listings), so it costs nothing for coaches who have not connected; (3) listings enabled before this (the Test Session) are *adopted*, not re-synced: only a signature key is written, checked by a dry run against the real listing; (4) a listing that already works keeps its process alias; only new listings get `BOOKING_PROCESS_ALIAS`; (5) the stock `BookingFixedDurationForm` is no longer rendered by `OrderPanel` at all (a fixed-length session without calendar booking shows the message), and the AVAILABILITY wizard step is hidden for every `fixed` listing type, not by listing type id.

**Fresh-coach test on revie-dev, step by step (plain language)**

Before you start: both PRs merged and deployed; Render's `BOOKING_PROCESS_ALIAS` reads `default-booking/release-4`; you have a brand-new Google account for the coach (add it as a test user in your Google Cloud OAuth consent screen) and a second Google account for the client; the Nylas Essentials plan allows 10 connected accounts, so check you have room.

1. In a private window, sign up on revie-dev as a **coach** with the new Google account.
2. Go to **Account settings → Calendar**. Check you see "Connect Google Calendar" and, below it, **Working hours** already set to Mon-Fri, 09:00 to 17:00, in your own timezone. Change nothing yet, or change it and press **Save hours** (you should see "Saved...").
3. Create a **Signature Session** with **two price variants** (for example 30 and 60 minutes), add a photo, and publish it. Check the wizard did **not** ask for availability, and that the listing is **Published** (not draft).
4. Open the listing as the **client** (second browser, second account). It should say **"This coach isn't taking bookings yet."** and no booking form. Open it as the coach: it should say "Connect your calendar to start taking bookings" with a link.
5. As the coach, press **Connect Google Calendar** and approve. You should land back on the Calendar page with "Your Google Calendar is connected."
6. Wait up to one minute, then reload the listing. As the coach the message goes away; as the client you now get the booking form, with **both lengths** offered and slots **only Monday to Friday, 09:00 to 17:00** (in the coach's timezone).
7. In **Sharetribe Console**, open that listing's public data. You should see `calendarBookingEnabled: true`, two ids in `nylasConfigurationIds`, `nylasOpenHours`, `transactionProcessAlias: default-booking/release-4` and `nylasSyncSignature`. **The listing must still be Published**: this is the check that a server update does not unpublish it. In the Nylas dashboard the coach's account should show two configurations.
8. As the client, book a slot with a Stripe test card. The transaction should end up **Accepted** on release-4, with an event (and a Meet link) on the coach's Google Calendar.
9. As the coach, change the hours to **Tue-Thu, 10:00 to 14:00** and save. Within a minute the client should be offered only those slots. The booking from step 8 is untouched.
10. As the coach, edit the listing and add a **90-minute** variant. Within about a minute the client can pick 90 minutes too, and Console shows three ids.
11. Check **Render's logs** for lines starting `[jobs] reconcile` and **Sentry** for no `nylas-ensure-bookable-failed`.
12. Open the existing **Test Session** listing: it should be exactly as before (still bookable, hours unchanged).
13. Optional: as the coach, connect a **different** Google account. You should get a Sentry event tagged `nylas-grant-changed`, and the listings point at the new calendar.

If step 6 is still the message after two minutes: check the Render logs for `[nylas] Reconcile is paused` (alias missing) or a Sentry `nylas-ensure-bookable-failed` event.

**Not verified:** anything against live Nylas and Sharetribe beyond a read-only dry run on the Test Session (a full sync of a new listing, that an operator update leaves a published listing published, the advisory lock on real Postgres, the new Calendar page logged in, and the listing page message). They are steps 3 to 7 above.

**What's next:** nothing marks a listing paused when a coach's Google grant stops working (the app is in Testing mode, so refresh tokens expire after 7 days); no hours check when a booking is created (by decision); one schedule per coach, not per listing.

---

## HANDOFF — 2026-11-10 (coach calendar connect: Calendar tab in account settings)

**Branch / PR:** `coach-calendar-connect`, one PR, not merged.

**What changed:** coaches now have a normal way to connect their Google Calendar, which is also the flow to film for Google's OAuth verification. New page **Account settings → Calendar** (`/account/calendar`, `src/containers/CalendarSettingsPage/`), visible only to users whose user type has the provider role. Not connected: the explanation and a primary "Connect Google Calendar" button that goes to `/api/nylas/connect?provider=google&returnPath=/account/calendar`. Connected: "Google Calendar connected", "Connected as {email}" and a "Reconnect" link to the same URL. The Nylas callback now returns to this page by default (it used to land on `/`), and the page shows the result (`?calendarConnect=connected|declined|failed`). Nothing in the server flow changed apart from that default.

**Findings (before building):** nothing in the UI linked to `/api/nylas/connect` (or `/api/nylas/enable-listing`) before this. The connection is stored by the callback on the coach's user: `privateData.nylasGrantId/Provider/Email` (readable only by that user and the Integration API) and the public flag `publicData.calendarConnected`/`calendarProvider`. The Google *login* flow requests `plus.login`, `userinfo.profile`, `userinfo.email` and nothing else; calendar scopes come only from the Nylas Google connector.

**Not verified:** the full round trip with a real Google account (needs a logged-in coach on Render; the page was only viewed logged out locally), that Reconnect reuses the same grant id in Nylas, and that "connected" still means a working grant (the Google OAuth app is in Testing, so refresh tokens expire after 7 days; the flag is not cleared when that happens).

**Follow-up on the same PR (Nov 10):**
1. Google login no longer requests the retired `plus.login` scope; it asks for `openid`, `userinfo.profile`, `userinfo.email`. `openid` is kept because our callback reads the `id_token`. Tests assert the exact list and that no calendar scope is ever requested. **Not verified against real Google** (nothing can be, short of a login on Render after deploy: sign in with Google once and check it still works).
2. Reconnect safety. Per Nylas's docs the same email address keeps the same grant id; a different account is a new grant. The callback now compares the new grant with the one stored on the coach and, if different, `grantChange.js` re-creates their calendar listings' configurations on the new grant and repoints the listings, and always reports to Sentry (`nylas-grant-changed`) with the sessions left on the old calendar. Tests for the changed, unchanged, first-connect and handler-failure cases.
3. Report only: a new coach cannot yet get a bookable listing; see the PR conversation. `enable-listing` has no caller, and nothing sets `nylasOpenHours` either (a coach enabled by script would be offered 24/7 slots).

**What's next:** the coach-side "enable booking on this listing" UI (`/api/nylas/enable-listing` still has no caller), and showing a coach when their grant has expired.

**Blocked / needs a decision:** whether to drop `plus.login` from the Google login scopes (Google+ is retired; it is stock template code and not a calendar scope, but it will show on the verification scope list).

---

## HANDOFF — 2026-11-05 (release-4: late cancellations get their own state)

**Branch / PR:** `late-cancel-release-4`, one PR, not merged.

**Process (pushed to Dev and Test only; Live untouched):** `default-booking` version 4, alias `release-4`, on `revie1-dev` and `revie1-test` (Console list shows 0 transactions on it in both when pushed). New: `transition/late-cancel` (operator, `accepted → late-cancelled`, no refund action, no `cancel-booking`), `transition/complete-late-cancelled` (time-triggered at booking end + 2 days, `stripe-create-payout`, into `late-cancelled-completed`), no review transition or notification on that path, late-cancellation emails to both sides, and the usual "money paid" email at the payout.

**Dev listing:** the Test Session listing (`6aa17447…`) moved release-3 → **release-4** (status before: `default-booking/release-3`; after: `default-booking/release-4`; configuration, lengths and `calendarBookingEnabled` unchanged). Dev transaction `6aed1131…` (release-3, still accepted) now carries `lateCancelledAt` / `cancelledBy: client` in its metadata so the new UI shows on it.

**Policy implemented (decisions of Nov 5):** the client's cancel button first writes `cancelRequestedBy: customer` (and now refuses to cancel if it cannot, so a late cancel can never be refunded as a coach one). The `booking.cancelled` webhook: no note = coach → `transition/cancel`, full refund at any time, `cancelledBy: provider`; note + over 48 h → refund, `cancelledBy: client`; note + inside 48 h → `transition/late-cancel`. A release-3 transaction answers 409 to `late-cancel` (same as "already made"), so the webhook re-reads the last transition and, for release-3, only writes the metadata; the UI still shows it as a late cancellation. The "coach-cancelled late" UI states from PR #17 are gone (a coach cancellation is a plain refund now).

**Judgement call to check:** `BookingCanceledToProvider` used to say "{client} cancelled…"; `transition/cancel` now also runs for coach cancellations, so the coach email moved to a neutral new key `BookingCanceledToProvider.ContentNeutral` ("{listing} with {client} is cancelled, and it's off your calendar."). Release-3 transactions keep the old template.

**Tests:** server and client suites pass (webhook decision table, cancel-note-required, release-3 fallback, real-state UI, activity feed).

**Regan, to do**
1. Merge, then check Render's `BOOKING_PROCESS_ALIAS` is `default-booking/release-4` (the Blueprint carries it; set it by hand on `revie-dev` if the Blueprint is not re-synced). Until then a *newly enabled* listing would be stamped release-3 (the Test Session listing is already on release-4).
2. Paste `docs/email-texts-release-4-paste-into-dev.json` into Dev's Console Email texts (the late-cancel keys have in-template defaults, so emails work before the paste; the paste makes them editable).
3. Run scenarios 7 and 8 in `docs/test-script-booking-recovery.md`.

**What's next:** Postmark reschedule and reminder emails; at cutover, push release-4 to Live and set the alias on the production service (logged in `docs/go-live-plan.md`).

**Blocked / needs a decision:** none.

---

## HANDOFF — 2026-11-05 (late-cancellation visibility)

**Branch / PR:** `late-cancel-visibility`, one PR, not merged. No process change, nothing pushed to Sharetribe.

**Investigated (test transaction `6aed1131…`, cancelled by the client at 23:49:33 UTC, session 7 Nov 00:00 UTC):** Render shows the webhook arriving, signed correctly, and ending `booking.cancelled -> charged-late-cancellation`. **The calendar event is gone**: the coach's calendar has no events in that slot (read-only check against Nylas EU). Sharetribe still says `accepted` and will auto-complete about 9 Nov 01:00 UTC (booking end + 2 days), paying the coach, and send both sides the review emails.

**What changed (code only)**
1. The `booking.cancelled` webhook writes `lateCancelledAt` and `cancelledBy` (`client` / `coach`) onto the Sharetribe transaction's metadata (visible in Console). Written once; a redelivered webhook does not move the time; a failed write makes the webhook fail so Nylas delivers it again. The client's cancel button leaves `cancelRequestedBy: 'customer'` first (removed again if Nylas refuses).
2. A late-cancelled session now shows as cancelled: order-page heading ("Session cancelled." / coach: "{client} cancelled late. You'll still be paid.") plus a line saying the charge stands; inbox status ("Cancelled, charged" / "Cancelled late, you'll be paid"), not "Booked" and not "Leave a review"; the activity feed gets a cancellation entry and the later automatic completion reads as a charge/payout; the review button and link are gone on the page; the topbar count no longer counts it.
3. After the client cancels, the order page re-reads the transaction at 3, 8 and 20 seconds so the heading catches up with the webhook without a reload.
4. New repo-owned translation keys only (`late-cancelled`, `late-cancelled-by-coach`); Console shadows none of them.

**Not fixed, needs a process version (plan below, not built):** Sharetribe's own review emails on `transition/complete`, and the `Accepted`/`Delivered` state in Console.

**What's next**
- Regan decides on the release-4 plan (a `late-cancel` operator transition into its own state, with a time-triggered payout and no review notifications, and the cancellation emails that do not exist today). Existing transactions stay on release-3, so the code above remains the safety net for them.
- Product decision: a **coach** who cancels inside 48 hours from their calendar also leaves the client charged, because the webhook cannot tell a coach-cancel from a client-cancel except by our note. The UI now says so honestly ("cancelled by you" / "{coach} cancelled"), but the policy itself is unchosen.

**Blocked / needs a decision**
- Release-4 go-ahead (above).

---

## HANDOFF — 2026-11-05 (create-booking customer check, sweeper cutoff, order-page retry)

**Branch / PR:** `create-booking-fix`, one PR, not merged. Keeps the PR #15 logging.

**Root cause (Regan found it in the new log line):** `create-booking refused: caller is not the customer … customer=missing`. The customer check read `tx.relationships.customer`, which a Marketplace API transaction only carries when `include: ['customer']` is requested. So the fast path was refused for every real customer from Oct 27 (PR #6 added the check) until now; the sweeper hid it by booking on its next tick. The "5 seconds" on Nov 4 was a lucky tick, not the US app; the EU switch did not cause this.

**What changed**
1. `loadCalendarBookingTransaction` includes the customer and returns `customerId`; new `verifyCaller` (strict: a different user is refused; a missing relationship is settled from the caller's own orders, not treated as "not the customer"). Tests: real customer allowed, other user refused, relationship missing (allowed for the owner, refused for a stranger, Sharetribe failures surface).
2. Sweeper cutoff filtered in our code (`lastTransitionedAt`), two minutes, 60-second tick. The API ignores `lastTransitionedAtEnd`. Tests with a mocked SDK.
3. The order page asks the server to create the booking once more after ten seconds if it is still "Confirming…" (customer only, once per transaction; initiate is never retried).

**Expect after deploy:** a booking confirms in about 5 seconds again via the fast path (log: `[nylas] webhook POST … signature=valid trigger=booking.created` right after payment, no sweeper line). If it does not, `create-booking refused (…)` now says why.

---

## HANDOFF — 2026-11-05 (EU switch: slow first booking, webhook investigation)

**Branch / PR:** `nylas-webhook-logging`, one PR, not merged.

**Finding (read-only; nothing in Nylas, Render or the listing was changed):** Nylas **does** reach us on the EU app. The EU destination is active with the four triggers and the right URL. For the 21:45 booking, Render shows `POST /api/nylas/webhooks 200` from Nylas at 21:46:38 (`booking.created … customFields=true`, then `-> accepted`). The ~50 seconds were not the webhook: the browser's `POST /api/nylas/create-booking` returned **403 in 148 ms** right after payment, so the fast path never ran; the 60-second sweeper then created the booking, Nylas's webhook arrived two seconds later, and acceptance followed. Payment 21:45:49 → accepted 21:46:39.9 (50.8 s); on the old US app the same flow took 5.3 s.

**Why "no webhook in the logs":** Render's request log lines carry the path in labels, not in the message text, so a text search for the path finds nothing.

**What changed:** one access-log line for every webhook request (`[nylas] webhook POST <path> signature=valid|invalid|missing trigger=<type>`; no payload, signature or secret), a log line for the challenge, and a log line for a create-booking refusal. Server tests: 413 pass.

**Still open (not fixed):** why create-booking answered 403 (not the same user: customer and coach are different accounts; likely our own customer check or a session-token race, which the new log line will show on the next booking); the sweeper's age cutoff is ignored by the API (see tech-constraints.md). Proposed: send create-booking again from the order page if the booking has not confirmed after ~10 seconds, and make the sweeper's cutoff real (filter on `lastTransitionedAt`) with a short cutoff and tick.

---

## HANDOFF — 2026-11-05 (Dev moves to the EU Nylas app: code and config side)

**Branch / PR:** `nylas-eu-switch`, one PR, not merged. PR #12 (the decision and migration steps) is merged and the two old US-app test bookings are cancelled.

**What changed**
- `render.yaml`: `NYLAS_API_BASE_URL` is `https://api.eu.nylas.com`. The server's fallback default (`server/api/nylas/config.js`) and `SETUP.md` are EU too, so a missing variable can never silently send coach data to the US.
- `docs/tech-constraints.md`, `SETUP.md`, `CLAUDE.md`: exact 1Password item and field names for the EU credentials (`nylas_eu_api_key`, `nylas_eu_client_id`, `nylas_eu_webhook_secret`, field `credential`) and what to set on Render.

**Regan's part (not done by me):** create the three 1Password items and point `.env` at them; set `NYLAS_API_KEY`, `NYLAS_CLIENT_ID`, `NYLAS_WEBHOOK_SECRET` and `NYLAS_API_BASE_URL` on Render `revie-dev` and redeploy; create the webhook destination in the EU dashboard (`https://revie-dev.onrender.com/api/nylas/webhooks`; `booking.created`, `booking.pending`, `booking.rescheduled`, `booking.cancelled`); register `https://revie-dev.onrender.com/api/nylas/callback` as a callback URI in the Nylas EU app; delete the old US destination.

**Still to do after she confirms those and merges:** connect `hello@revie.love` to the EU app (`/api/nylas/connect?provider=google` while logged in on Render), then `scripts/dev-resync-listing.js` for the Test Session listing (`6aa17447-bd2d-4465-9a24-38498e5daa62`), then scenarios 1 and 3 of the booking test script on Render.

**Watch:** a Google OAuth app in *Testing* status issues refresh tokens that expire after 7 days, so the connected calendar will stop working a week after connecting until the app is published (and verified). Fine for Dev testing; a go-live item.

---

## HANDOFF — 2026-11-04 (inbox fixes)

**Branch / PR:** `inbox-fixes`, one PR, not merged.

**What changed**
- Notification indicators (inbox count badge, desktop and mobile topbar dots, inbox row dot) are pink with a maroon number/ring; `--revieError` stays for errors.
- Review wording by role: client "Leave a review" (orange tag), coach "Waiting for the client's review" (muted text); a confirmed booking is no longer tagged as a warning. New `isWaiting` state flag and `.stateWaiting` class.
- "Cancelled" spelling in the inbox status, activity feed and order-page titles.
- Topbar search input stays transparent in every state (the template's `input:focus` made it white inside the pill); autofill covered.
- Inbox fixtures (`InboxPage.booking.example.js`) for both roles.

**Console:** only `InboxPage.default-booking.reviewed-by-customer.status` is in Dev's Console of the keys involved; paste `inbox-texts-paste-into-dev.json` or the old wording keeps shadowing the repo. `delivered`, `reviewed-by-provider` and the four `canceled` keys are repo-only.

**Found:** the inbox count is the client's unreviewed completed sessions (a state-name collision with the negotiation process), not unread messages; the coach never gets a count. See tech-constraints.md.

---

## HANDOFF — 2026-11-04 (Layer 2 consistency pass, PR #11)

**What changed**
- **Pairings follow docs/brand.md across components.** Muted text on cream is grey 600 via `--colorTextMuted` (4.9:1; grey 300-500 were 1.8-3.4:1), disabled text `--colorTextDisabled`, text on maroon is off-white not white. Date picker selected day maroon on lavender (was 1.62:1), disabled days 5.3:1, light theme aligned. Disabled buttons, own-message bubbles, the listing action bar, card menu, limited-access banner and the session panel moved to approved pairings. 43 px radii and the hardcoded hex values now use tokens (vendored image-gallery CSS, sanitize.css, calc() pill radii and the code block's monospace left on purpose). Full list by screen: `docs/layer2-before-after.md`.
- **Visual-check fixes (from Regan's pass on Render):** maroon wordmark on light grounds (`Logo tone="onLight"`: checkout header, footer); hero search button 40px with the label centred; topbar search is one cream pill with the icon inside; `REACT_APP_MARKETPLACE_NAME` is now `Revie` in `render.yaml` (it was the environment name `revie_dev` and showed in the Stripe mandate line, page titles and logo alt text; build-time, needs the Render value set and a redeploy).
- **Semantic colours (decision of Nov 4):** error `#B8000A` (`--revieError`, the one colour outside the palette, errors only), success Forest, warnings as an orange tag with a maroon label, never orange text. Inbox "action needed" and the listing page's pending-approval and payout notices are tags.
- **Repeatable checks:** `scripts/audit-css.js` (0 unapproved explicit pairs; the original list of 68 was not in the repo, so this is a re-derived audit), styleguide examples with fixtures (booking form, session panel, topbar, hero search, checkout header, footer).

**Found**
- Dev/Test are private, so the styleguide needs a login; pages were checked by making it public locally (reverted each time, never committed). Checkout and the order page were not screenshotted.
- The booking form test used a fixed September date and went red once it had passed; now relative to today.

**What's next:** inbox fixes (notification colour, review wording, "cancelled" spelling); coach profile redesign (Layer 3); Nylas EU migration when the keys exist (PR #12).

---

## HANDOFF — 2026-10-28 (third session: process release-3)

**Branch / PR:** `process-release-3`, one PR, not merged. PR #9 was merged and deployed first.

**What changed**
1. **Release-3 of `default-booking`:** `transition/cancel` now emails the client and the coach (new templates `booking-canceled-to-customer` and `booking-canceled-to-provider`), and the coach's "operator accepted" template gains a `fixed` branch (`BookingOperatorAcceptedRequest.ContentForFixed`). The process validates locally (`flex-cli process --path`).
2. **Pushed to Dev (`revie1-dev`) and Test (`revie1-test`) only**, version 3 and alias `release-3` on each. Live (`revie1`) untouched.
   - Dev: v3 release-3 (0 transactions), v2 release-2 (6), v1 release-1 (4).
   - Test: v3 release-3 (0), v2 release-2 (0), v1 release-1 (4).
3. **Dev Test Session listing moved to release-3** (`use-release-3` in the Dev helper): `transactionProcessAlias` was `default-booking/release-2` before, `default-booking/release-3` after; the Nylas configuration was untouched and still real.
4. `render.yaml` now sets `BOOKING_PROCESS_ALIAS=default-booking/release-3`.
5. Decision "Which emails come from Sharetribe and which from Postmark" replaced (the diff removes only the old entry). Tech-constraints, go-live plan (cutover list) and test script (scenario 6) updated.

**Departure from the proposed copy:** the cancellation emails carry **no session date**. Sharetribe's booking record never changes after a reschedule, so a date there could be the original time. They link to the order page, which shows the current time.

**Why the refund wording is safe:** `transition/cancel` always runs `calculate-full-refund` and `stripe-refund-payment`, and a cancellation inside 48 hours calls no transition, so the client email is only ever sent when a refund happens.

**For Regan**
- Render: set `BOOKING_PROCESS_ALIAS` to `default-booking/release-3` on `revie-dev` (the Blueprint carries it; set it by hand if the Blueprint is not re-synced). Until then, a newly enabled listing would be stamped release-2.
- Dev Email texts: paste the nine keys in `~/Downloads/revie-console-texts/email-texts-release-3-paste-into-dev.json`.
- Run scenario 6 on Render.

**Not verified:** the new templates have not been rendered by Sharetribe (the push accepted them); the first real cancel will show the email. The timezone of dates in the older emails is still the listing's (coach's) timezone, not the client's.

**What's next:** Postmark module for late-cancellation, reschedule and reminder emails; push release-3 to Live at cutover with `BOOKING_PROCESS_ALIAS` on the production service.

---

## HANDOFF — 2026-10-28 (second session: emails off in Nylas, Console texts, checkout message, release-2 on Test)

**Branch / PR:** `emails-texts-checkout-docs`, one PR, not merged. PR #8 was already merged; its decisions.md diff deleted nothing.

**What changed**
1. **Nylas emails off.** Every configuration is created and updated with `event_booking.disable_emails: true`. Dev's Test Session configuration re-synced: `disableEmails` was unset before, `true` after.
2. **Checkout network error.** A status-less `TypeError` (Failed to fetch, Load failed) at checkout now says "We couldn't reach our servers. You haven't been charged. Check your connection and try again." (new key `CheckoutPage.networkError`). Only the price-estimate call (`transactionLineItems`) retries once on a network error; initiate is never retried silently, because a network error does not say whether the first request reached the server.
3. **Release-2 pushed to Test only.** flex-cli id `revie1-test` (version 2, alias `default-booking/release-2`, 0 transactions; version 1 and its 4 transactions untouched). `revie1` (probably Live) was only listed, never pushed to. No Test listing or Console setting changed.
4. **Docs.** Four decisions (Dev-direct Console until cutover; which emails Sharetribe vs Postmark, replacing the Oct 26 entry; Console texts hold only overrides; coach profile redesign starts now), `go-live-plan.md` (phase 4 timing, hand-run "Help me choose", new "Dev-only Console changes" cutover list), and the Dev-direct rule in CLAUDE.md and tech-constraints.md.

**Files for Regan (outside the repo, `~/Downloads/revie-console-texts/`, not committed)**
- `marketplace-texts-trimmed.json` (90 keys, from 1,397) and `marketplace-texts-keep-or-drop.md` (every kept key and every differing key dropped, with a reason).
- `email-texts-paste-into-dev.json` (21 keys) and `email-texts-notes.md`.

**Findings**
- Release-2 sends **no cancellation emails**: the process has no notification on `transition/cancel` and the booking templates have no cancelled template. The Oct 28 email decision lists Sharetribe cancellation emails to client and coach, which do not exist yet; the second email seen on a cancel was not from the process.
- The coach's "operator accepted" email has **no body for fixed-length sessions** (only hour, day, night branches). Fixing it and adding cancellation emails both need a template change, so a new process version (release-3) on Dev.
- Dev's Console texts differ from the v12.3.0 template in only 85 keys; the other 1,312 were pure copies that were hiding repo changes.

**What's next**
- Regan: paste the trimmed marketplace texts and the email texts into Dev's Console; run scenario 5 of the test script on Render.
- Decide: build release-3 (coach body, cancellation emails) before the Postmark module.
- Several `EditListingPricingForm.priceVariant.*` texts still say "extension"; variants are now different session lengths.

**Blocked / needs a decision**
- Approval to publish is off in Dev and on in Test; confirm the intended value (listed in the cutover list).

---

## HANDOFF — 2026-10-28 (calendar sessions: release-2 on enable, session lengths, invite, wording, cancel panel)

**Branch / PR:** `calendar-sessions-wording`, one PR, not merged. It also carries the two doc commits from the closed docs branch that missed PR #7 (the "Console cannot pin a listing type" corrections and the Oct 27 handoff).

**Test results that prompted this (Regan, on Render):** happy path and slot-taken behave; cancel worked (calendar event removed, Stripe refunded) but gave no confirmation and left the buttons up; the page still said "booking request"/"declined". Scenarios 2 and 4 earlier ran through localhost checkout with Render's sweeper and webhooks doing the work, so the fast browser path has now only been run for scenarios 1 and 3.

**What changed**
1. **New listings land on release-2.** `enableListing` writes `transactionProcessAlias` from `BOOKING_PROCESS_ALIAS` in the same update as the configuration ids and refuses (503) if it is unset; initiate refuses a calendar listing booked under any other alias. `BOOKING_PROCESS_ALIAS=default-booking/release-2` is in `render.yaml` (Dev). Listing types stay on release-1.
2. **Session lengths.** One Nylas configuration per variant length (`publicData.nylasConfigurationIds`, old single id kept as the 60-minute entry), slots every 30 minutes, availability/booking/cancel/reschedule all resolve through `resolveBookingTarget`, the booking form refetches when the length changes, reschedule refuses a different length. The `length` field is NOT removed (see below).
3. **Every configuration:** title "{listing title} with {coach name}", generic Revie description, Google Meet (Teams for Microsoft grants), Nylas's hosted cancel/reschedule links hidden, URLs pointed at the Revie orders page (Nylas requires `:booking_ref` in them, so it is a query parameter). After a booking is made the event is updated with the client's name and a link to that session's order page (best effort; failures go to Sentry as `nylas-event-description-failed`).
4. **Wording and cancel panel:** "Book a session"; confirm before cancelling stating the refund outcome (full refund over 48 hours, still charged inside), a settled "Session cancelled" state, and the panel hides itself for cancelled or finished sessions. `booking-status` now reports cancelled sessions and the live refund outcome.
5. **Dev data changed (approved):** `scripts/dev-resync-listing.js sync` was run on the Dev Test Session listing only. It now has the new title, Meet, hidden links, 30-minute slots, and `nylasCalendarId`; verified Nylas now offers starts on :00 and :30. `scripts/dev-listing-test-helper.js` break/restore now handle the per-length map.

**Findings**
- **Console marketplace texts shadow the repo.** The app merges `{...en.json, ...hostedTranslations}` and Dev's Console holds a copy of essentially every template key, so changing the value of a stock key in `en.json` does nothing on Dev. This also means the five string changes in PR #6 (customer/provider declined and preauthorized) are not live on Dev. Revie-specific text is on new keys; stock keys are in the Console list below. Email texts work the same way.
- Nylas requires `:booking_ref` in `cancellation_url` / `rescheduling_url`.
- Cancel failing earlier was almost certainly localhost having no `DATABASE_URL`, not release-2.

**Console marketplace texts to change in Test, then copy to Dev** (values equal the repo's `en.json`):
- `TransactionPage.default-booking.customer.accepted.title` → You're booked.
- `TransactionPage.default-booking.customer.declined.title` and `...customer.expired.title` → That one didn't go through, and you haven't been charged. Pick another time and we'll get you booked.
- `TransactionPage.default-booking.customer.preauthorized.title` → Confirming your session… and `...preauthorized.extraInfo` → the repo text.
- `CheckoutPage.default-booking.title` → Complete your booking
- `OrderPanel.ctaButtonMessageBooking` and `BookingDatesForm.requestToBook` → Book a session
- `TransactionPage.ActivityFeed.default-booking.accepted`, `.declined`, `.expired`, `.preauthorized` → the repo text
- `InboxPage.default-booking.preauthorized.status` → Confirming; `.accepted.status` → Booked; `.declined.status` → Didn't go through
- Coach side: `TransactionPage.default-booking.provider.declined.title`, `...provider.preauthorized.title` → the repo text
- Console **email texts**: `BookingAcceptedRequest.Subject/Title/DescriptionFixed`, `BookingExpiredRequest.Title/Subject` (no process push needed).

**What's next**
- Regan: add nothing to Render if the Blueprint syncs; otherwise set `BOOKING_PROCESS_ALIAS=default-booking/release-2` on `revie-dev`. Change the Console texts. Run scenario 5 of the test script on Render, including whether Meet creation breaks booking.
- Remove the Dev `length` field only after Regan approves the exact change (listed in the PR conversation).
- Friendlier checkout network-error message and a safe retry (analysed, not built).
- Coach emails still say "booking request accepted on your behalf" and lack a fixed-length branch.

**Blocked / needs a decision**
- Whether a failed Google Meet creation fails the whole booking is unknown until one test booking.

---

## HANDOFF — 2026-10-27 (release-2 test results; cancellation investigation)

**Test results on Dev (Regan ran them):** happy path and sweeper scenarios passed. Slot-taken and forced-failure scenarios passed functionally (Stripe payment cancelled, Sentry alerted) but the customer's order page still read as "declined"; probably the activity-feed line "The booking request was declined." rather than the new title, to be confirmed. Both runs of `break` and `restore` on the Test Session listing worked and `status` confirmed it was restored. **Customer cancel failed** ("Something went wrong. Please try again shortly.").

**Findings (nothing was changed; no fixes made):**
- Release-2 did not break cancellation: `transition/cancel` is identical to release-1 (operator, accepted to cancelled, full refund), and the cancel panel only checks for the ACCEPTED state, which release-2 did not change.
- Nylas accepts our cancel call's authorisation: a cancel of a nonexistent booking id returned 404 "Booking not found", not an auth error. So the failure is for a real booking or earlier in our endpoint. The exact status was not readable from here (no Render/Sentry access); it is in the browser's Network tab for `cancel-booking`, and in Sentry as `local-api-request-failed`.
- The cancel endpoint takes the Nylas configuration id from the listing's current value, so a cancel attempted while the listing was broken for scenario 4 would fail with this same message.
- Hosted Nylas cancel/reschedule links come from `scheduler.cancellation_url` / `rescheduling_url` (default book.nylas.com); `hide_cancellation_options` and `hide_rescheduling_options` are both false on the Dev configuration. They cannot work (private configuration) and change nothing in Sharetribe.

**Next:** get the status of the failing `cancel-booking` request, then fix; then turn off the hosted links in the same configuration change as event title and Google Meet.

---

## HANDOFF — 2026-10-27 (release-2 pushed to Dev)

**Branch / PR:** `docs-release-2-rollout`, docs and one helper script only. PR #6 (the recovery code) is merged and live on Render dev.

**Corrections and follow-up (later the same day)**
- **Console cannot point a listing type at release-2** (it only offers default processes), so the Console step below is void and the "listing type points at release-2" wording in this entry, `decisions.md`, `tech-constraints.md` and `CLAUDE.md` was wrong; corrected. Listing types stay on release-1 everywhere, so a Test to Dev copy is harmless again.
- Regan approved it and I ran `use-release-2` on the Dev "Test Session" listing (`6aa17447-...`) and nothing else. `status` before: `default-booking/release-1`; after: `default-booking/release-2`.
- Added the `revie1-dev` flex-cli note to `CLAUDE.md`.
- Open: how NEW listings get release-2 before the Dec 14 cutover (plan given in chat, not built).

**What changed**
- **Pushed process release-2 to Dev only** (`npx flex-cli`, marketplace `revie1-dev`). First validated locally with `flex-cli process --path` (it parsed the file and described exactly the intended machine), and confirmed Dev's live version 1 was identical to the file I edited from. Output: `Version 2 successfully saved for process default-booking`, then `Alias default-booking/release-2 successfully created to point to version 2.` `process list` now shows version 2 (`release-2`, 0 transactions) and version 1 (`release-1`, 4 transactions). Pulled version 2 back and confirmed it matches git (the server drops comments and stores templates with CRLF line endings). **Nothing was pushed to Test or Live.**
- Corrected the Dev marketplace id in `tech-constraints.md`: flex-cli needs `revie1-dev` (`revie_dev` is only the display name). `CLAUDE.md` still calls Dev `revie_dev` in several places; those are display-name uses and left alone.
- Recorded the decision that Dev's listing type points at release-2 on purpose and must never be overwritten by a Test to Dev copy. Added the same rule to `tech-constraints.md` and `CLAUDE.md`.
- Wrote `docs/test-script-booking-recovery.md`: four scenarios in plain steps (happy path, browser never reports, slot taken, forced failure), each with what the client, coach, Stripe test mode and Sentry should show.
- Added `scripts/dev-listing-test-helper.js`: a Dev-only helper (`status`, `break`, `restore`, `use-release-2`, `use-release-1`) so Regan can force a failure on one listing and undo it. Every change needs `--yes`; the original configuration id is saved outside the repo and never overwritten.

**Found while preparing**
- **A new transaction uses the listing's own `transactionProcessAlias`**, not the listing type's. Both Dev listings say release-1. Changing the listing type in Console only affects listings created afterwards, so the existing "Test Session" listing must be switched separately.
- A deliberately invalid Nylas configuration id returns a clean 404 from Nylas, which recovery treats as permanent (one attempt, no retry). That is the safe forced failure; the retry path stays covered by the automated tests only.

**Not done / needs Regan**
- **Console (Dev):** point the Signature Session listing type at `default-booking/release-2` (steps in the chat reply). I'll verify it by reading the hosted config afterwards.
- **Switch the existing listing:** `op run --env-file=.env -- node scripts/dev-listing-test-helper.js use-release-2 --listing 6aa17447-bd2d-4465-9a24-38498e5daa62 --yes`. I did not run it: changing a Dev listing needs Regan's go-ahead. The break and restore round trip was also not run for the same reason, so those two write paths are untested; only the guard and `status` were exercised.
- Run the four scenarios; nothing is proven end to end until then.

**What's next**
- After the scenarios pass: session lengths (decided), the coach confirmation email fix, working hours, coach onboarding.
- Release-2 to Test and Live is a deliberate step at cutover, not before.

---

## HANDOFF — 2026-10-27 (payment-failure recovery)

**Branch / PR:** `payment-failure-recovery`, PR open to `main`, not merged. Process release-2 is **not pushed to any environment**.

**What changed**
- **Server owns create-booking after payment** (`server/api/nylas/bookingRecovery.js`). Postgres claim so only one worker acts; up to two attempts (transient failures retried, "slot taken" not); about 10 seconds' grace for a late `booking.created` webhook; then `transition/operator-decline` and a Sentry error (code `nylas-booking-failed-declined`). A webhook that lands after a decline cancels the orphaned Nylas booking. `createBookingEndpoint.js` now only proves the caller is the customer and hands over.
- **Sweeper** (`server/jobs/`): every 60 seconds, handles paid-but-unconfirmed bookings older than 3 minutes. Starts from `server/index.js` once the schema is ready. `DISABLE_BACKGROUND_JOBS=true` turns it off.
- **`resolveBookingTarget(tx)`** in `manageBookingShared.js` is now the one place that picks a booking's Nylas configuration. Session lengths will change only that.
- **Pricing hole closed** (`server/api-util/bookingVariantCheck.js`, called from `transactionLineItems`): a fixed-length booking is refused if its price variant is missing, unknown, or the wrong length.
- **Process release-2 in `ext/`**: no provider accept/decline, no "new booking request" or "declined on your behalf" emails; the client's failure email and the expired email now have real text for fixed-length sessions (they rendered none).
- **Client**: customers see "Confirming your session…" and the page polls (stops after 5 minutes); coaches get no Accept/Decline (unless an old release-1 transaction still allows it), no inbox badge, neutral wording.
- Repaired `docs/decisions.md`: my earlier edit had inserted an entry into the header sentence. Added the Oct 27 "slots every 30 minutes; no length filter" decision.

**What passed**
- Server tests 346 (was 295; +51), client tests 1,119 including new ones for the poll hook and coach buttons. `format-ci` clean. One Inbox snapshot updated: the coach's notification dot and "action needed" label disappear for a paid-but-unconfirmed booking, as intended.
- Against the real Dev services: the sweeper's Integration API query runs; `loadTransactionAsOperator` returns the transaction, listing, booking and the customer's email; `resolveBookingTarget` reads the real variant name from the transaction; the real `ensureBooking` on a real settled transaction touches nothing; the pricing check behaves correctly on the real Dev listing.
- Sharetribe's documentation says `stripe-refund-payment` "supports both cancelling a PaymentIntent that has not yet been captured" and refunding a captured one.
- Three of Dev's four transactions ended in `transition/expire`: the old failure mode did happen during earlier testing.

**What did NOT pass or was not run (needs Regan)**
- **Stripe test-mode check** that `operator-decline` cancels the authorisation, and every end-to-end scenario (bad `NYLAS_API_KEY` then pay with 4242; close the tab right after paying; block the calendar after picking a slot; happy path): all need a logged-in client, `flex-cli`, and the deployed service, none of which I have.
- **The SQL was never run against a real Postgres** (none available locally). It uses plain `INSERT ... ON CONFLICT ... WHERE ... RETURNING` and `$n::int * interval '1 second'`. After the first deploy, check Render's logs for `[nylas-db] booking mapping table ready` and no `schema init failed`. The two-worker race is tested only against a stand-in with the same semantics.
- The process EDN was checked for balanced brackets only; `flex-cli` will validate it on push.

**Rollout, in this order**
1. Merge the PR so Render dev deploys the code. Check the schema log lines above.
2. Set `REACT_APP_SENTRY_DSN` in Render (a redeploy is needed) and add a Sentry alert rule on the tags `nylas-booking-failed-declined`, `nylas-decline-failed`, `nylas-orphan-booking-cancelled` to email Regan.
3. Install `flex-cli` and log in. Push to **Dev only**: `flex-cli process push --path ext/transaction-processes/default-booking --process default-booking -m <dev marketplace>`, then `flex-cli process create-alias --process default-booking --version <n> --alias release-2 -m <dev marketplace>`. (Check `flex-cli process --help`; I couldn't run it.)
4. In Dev's Console, point the Signature Session listing type at `default-booking/release-2`. This deliberately breaks the "change Test, then copy forward" rule, because Test must not get release-2. **A later Test→Dev copy of the listing types would silently put it back to release-1.**
5. Run the scenarios above with the 4242 test card.

**What's next**
- Session lengths (decision recorded): the resolver is ready; needs per-length Nylas configurations, 30-minute slot starts, and removing the `length` field.
- Email fixes for the coach's confirmation, then working hours, then coach onboarding.
- Release-2 for Live happens at cutover, after Extend.

**Blocked / needs a decision**
- Nothing blocks the merge, but nothing is proven end to end until step 5 above.

---

## HANDOFF — 2026-10-27

**Branches / PRs:** PR #4 (`button-token-menu-label`) open. This docs branch is separate.

**What changed**
- **PR #4:** removed the hardcoded maroon from the primary button so `--colorPrimaryButton` drives it (Dev's hosted `primaryButton` confirmed `#310416`; verified by changing the variable and watching the button change). The topbar overflow "Menu" label is now off-white on maroon with a lavender hover underline, done in `revieTokens.css` so the core `LinksMenu.module.css` is untouched. Checked at 1024px with an injected element; the label can't be seen organically because the single custom link fits.
- Added the "Session lengths use Sharetribe price variations" decision and recorded the investigation in `tech-constraints.md`.

**Plan: session lengths (not built)**
- **Needs one Nylas configuration per length.** Probed: Nylas rejects a duration parameter on a private configuration's availability, and a booking must match a slot from the same configuration. Store `publicData.nylasConfigurationIds` keyed by length (keep the existing id as the 60-minute entry).
- **Server:** `scheduler.js` takes a duration per configuration; `enableListing.js` syncs one per distinct variant length (and again when a coach edits variants; lazy creation as a fallback); the availability endpoint takes `priceVariantName`, validates it against the listing's variants and uses that length's configuration; booking, cancel and reschedule resolve the configuration from the transaction's variant through one function (`loadCalendarBookingTransaction`).
- **Enforcement:** at initiate, check that the booking's length equals the variant's length, that the variant name exists (no silent fallback to the base price), and the working-hours and notice rules on start and end.
- **Client:** `NylasBookingForm` refetches slots when the variant changes; the browser-side `slotMatchesVariant` filter becomes redundant. The reschedule picker uses the booked length.
- **Build order:** payment-failure recovery first, but it should call one resolver, `resolveBookingTarget(tx)` (configuration, start, end, length), instead of reading `configurationId` directly. Variations then only change that resolver, so neither piece is reworked.

**What's next**
- Merge PR #4. Then payment-failure recovery, email fixes, working hours, session lengths.
- Regan: set `REACT_APP_SENTRY_DSN` in Render; create the Postmark account.

**Blocked / needs a decision**
- Slot step: Nylas starts on the hour (`round_to: 60`). A 90-minute session on the hour wastes 30 minutes, and Live has 45 and 75 minute sessions. Decide whether starts should be every 30 or 15 minutes.
- Dropping `length` removes the "Session Length" search filter. Sharetribe can't filter on a variant's length, so there will be no length filter. Decide if that is acceptable.
- Live has no 120-minute sessions today; the longest is 90.
- The Zapier zap into Webflow may map `length` or `timezone`; unverified, check it before removing `length`.

---

## HANDOFF — 2026-10-26 (second session)

**Branch:** `revie-design-tokens`, pushed to PR #1 (not merged).

**What changed**
- Applied the topbar loop fix: cherry-picked Sharetribe's `be151ebbd` (kept their authorship; trimmed the unrelated entries from the `CHANGELOG.md` conflict) and restored the nav label letter-spacing. Tested on the dev server at 375px, 1024px and 1280px, plus a phone-to-desktop resize without reload: console clean on every load, nav measured correctly.
- Added two decisions: booking failure after payment releases the hold; emails split between Sharetribe and Postmark.
- Recorded in `tech-constraints.md`: coaches can accept a not-yet-confirmed booking; several Sharetribe email templates have no body for `fixed` bookings.
- Opened a separate PR from `main` to Prettier-format the 6 Nylas files failing `format-ci` (no logic changes).

**Plans delivered (not built)**
- Payment-failure recovery: server-owned retry, decline via the existing `transition/operator-decline`, Sentry alert, sweeper for closed tabs, new process version for Dev, client changes. See the chat reply for the test plan.
- Emails: copy for each template, a template fix for `fixed` bookings, a notification on `transition/cancel`, and a Postmark module under `server/email/`.

**What's next**
- Merge PR #1, then check checkout, inbox, settings and the listing editor while logged in on `revie-dev`.
- Build payment-failure recovery first (phase 2), then the email template fixes, then working hours.
- Regan: set `REACT_APP_SENTRY_DSN` in Render (not pasted anywhere); Console `primaryButton` to `#310416` via Test; create the Postmark account and verify the sending domain.
- Remove the hardcoded primary ground from `Button.module.css` once Console is confirmed.

**Blocked / needs a decision**
- Whether Sharetribe's Test and Live environments accept a CLI process push (needed to roll out the new process version). Unverified.
- A support email address for the email footers.
- Cancellation emails: Sharetribe can only send them when a transition runs, so a late cancellation (inside 48 hours, no transition) needs Postmark. Decide whether to send all cancellation emails from Postmark for one consistent voice.
- Whether any coach sells sessions longer than 60 minutes (the `length` field).

---

## HANDOFF — 2026-10-26

**Branch:** `revie-design-tokens`, pushed. **PR #1** open to `main` (not merged).

**What changed**
- Committed and pushed the whole branch (6 commits, 36 files) and opened PR #1. Checked first: production build compiles, 295 server tests pass, Prettier clean on changed files.
- Added the "Working hours are one schedule per coach" decision and pointed CLAUDE.md at `docs/go-live-plan.md`. Working hours are approved but **not built**.
- Audits (read-only), recorded in `docs/tech-constraints.md`: what happens when booking creation fails after payment; the `length`/`timezone` listing fields; which emails exist.
- Added a CLAUDE.md note: `gh` defaults to the upstream repo, so always pass `--repo regan-revie/revie-dev`.

**Topbar render loop: root cause found, fix proposed, NOT applied**
- Cause: below 1024px the desktop topbar is `display: none` but still mounted. `PriorityLinks` measures link widths there, gets 0, treats 0 as "not measured yet", and re-runs forever. Measured: 369,121 effect runs in about 15 seconds at 299px wide; 2 runs at 1280px. Affects every phone and tablet visit, on every page, in production too (same code).
- It was never about fonts or letter-spacing. My earlier theories were wrong; the pane width at each test was the variable.
- Fix: Sharetribe already fixed it upstream in `be151ebbd` (14 lines in `PriorityLinks.js` and `CustomLinksMenu.js`). Tested temporarily on dev: quiet at 375px, and the nav measures correctly after resizing to desktop. Reverted; awaiting approval.
- The tracking I removed from the PriorityLinks labels was an unnecessary workaround. It can be restored with the fix.

**What's next**
- Approve the upstream loop fix, then apply it (cherry-pick `be151ebbd`).
- Step 5, **waiting on Regan**: once Console's `primaryButton` is `#310416` in Test and copied to Dev, remove the hardcoded maroon ground from `Button.module.css`.
- Booking-path colour fixes (date picker 1.62:1, WeeklyCalendar greys), then the rest of the 68 pairings.
- Payment-failure recovery (never cut, per the plan): a retry/reconciliation path plus an alert.
- Working hours build, then coach onboarding UI, per the plan.
- Email gaps: a cancellation email (none exists), a rewritten "new booking" email for coaches, reminders, and an email provider.
- Decide the Live `timezone` / Dev `length` fields (`length` is not tied to booking duration).

**Blocked / needs a decision**
- Primary colour in Console (above).
- Merging PR #1 redeploys the dev service. The loop is still present at <1024px until the fix is applied.
- `yarn format-ci` fails on 6 existing Nylas files; CI will flag it regardless of this PR.
- Topbar "Menu" overflow label (`LinksMenu.module.css`) was not restyled for the maroon bar and reads dim.

---

## HANDOFF — 2026-10-20

**Branch:** `revie-design-tokens` (not pushed)

**What changed**
- Set up `docs/` as the shared source of truth with the planning project: `decisions.md`, `tech-constraints.md` (checked against the repo and corrected), `brand.md` (merged from the old `brand-tokens.md`), this changelog. TT Commons licence moved to `licenses/` so it doesn't sync. CLAUDE.md gained "Working with the planning project".
- Added the design-token layer (`src/styles/revieTokens.css`): maroon topbar with cream wordmark, all-caps nav, pill buttons, cream page surfaces, brand logos.
- Fonts are now TT Commons Pro, Bio Sans and Schibsted Grotesk, self-hosted as woff2. Inter and Sharetribe's hosted Inter are gone. Checked in the browser: both Bio Sans faces load (HTTP 200) and body text renders in Bio Sans.
- Bio Sans only has Regular (400) and Bold (700): weight 500 renders as 400, 600 as 700, italics are the browser's slant.
- Buttons now follow the "Colours follow the brand guidelines" decision: primary maroon with off-white label, secondary lavender with maroon label, pink hover. The primary ground is set in `Button.module.css` because Console injects `#dcabf5` inline and overrides the token. **Uncommitted.**
- Audited colour pairings across 295 CSS files: 68 explicit pairs are not approved (full list was sent separately; not in the repo). Not fixed yet.

**What's next**
- Decide on the working-hours plan (below), then build it.
- Coach onboarding UI for calendar booking does not exist (nothing calls `/api/nylas/connect` or `/enable-listing`). Needed before go-live.
- Booking-time enforcement of working hours and notice period (currently only applied when listing slots).
- Fix the non-approved colour pairings, starting with the date picker (off-white on lavender, 1.62:1) and `WeeklyCalendar` greys.
- Set Console `marketplaceColors.primaryButton` to `#310416` (it is `#dcabf5`). Make the change in Test and copy forward.
- Push the branch so the planning project can see `docs/`.

**Blocked / needs a decision**
- **Render loop in the topbar (`CustomLinksMenu` / `PriorityLinks`)**: `Maximum update depth exceeded`, intermittent and sensitive to text widths. Tracking on the PriorityLinks labels triggered it with Bio Sans, so those labels are all-caps without tracking. Not patched (core template file). Re-check the console after any topbar font or typography change.
- Working hours: one schedule per coach, stored on the user profile, reusing the template's plan form. Needs Regan's go-ahead.
