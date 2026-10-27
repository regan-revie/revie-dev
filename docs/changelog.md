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
