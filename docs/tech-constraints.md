# Tech constraints

Listing fields, transaction processes, integrations and other technical
constraints the planning project needs to know about. Do not put secrets in
this folder; it is synced to Claude.ai.

*Last checked against the repo: 2026-10-20. Claude Code keeps this current.*

## Stack
- **Platform backend:** Sharetribe. On the **Pro** plan, which lets us build with Extend features in Dev but not publish custom code live until we upgrade to **Extend** ($299/mo).
- **Platform frontend:** customized Sharetribe Web Template (React/Node), self-hosted. Repo `regan-revie/revie-dev`. Dev deploy on Render (`revie-dev.onrender.com`): web service on the Starter plan plus Postgres (`revie-dev-db`), both in Frankfurt.
- **Marketing site:** Webflow. Not being rebuilt; out of scope. The platform should still feel like the same brand when someone clicks through from it.
- **Go-live:** January 1, 2027 (includes the upgrade to Extend).
- **Implementation:** Regan with Claude Code.

## Environments
Three Sharetribe environments, each with its own hosted configuration (listing types, branding, logo, Stripe), so they drift silently:
- **Dev** (flex-cli marketplace id **`revie1-dev`**; `revie_dev` is only the marketplace's display name, and flex-cli rejects it): the only one that supports custom code; what this repo develops against. Private marketplace. Use `npx flex-cli ... --marketplace revie1-dev` (flex-cli is not installed globally; Regan is logged in, and the key must never be read or printed).
- **Test:** a no-code preview meant to mirror Live. Console config changes are made here and copied to Dev and Live.
- **Live:** production. A public marketplace, currently running Sharetribe's hosted frontend, not this codebase.

## What's already built (platform)
- **Nylas calendar integration:** coaches connect Google/Outlook; availability comes from their real calendar. Booking, payment capture and confirmation work end to end (first real booking 2026-09-13).
- **Working hours:** the availability endpoint reads `publicData.nylasOpenHours` per listing (one window of days + start + end) and filters slots by it. **Nothing in the repo writes that field**, so coaches have no way to set working hours; it has to be set by hand. A coach with no hours set is simply bookable at any time the calendar is free.
- **No coach-facing UI for the Nylas flow exists.** The server endpoints are there (`/api/nylas/connect`, `/callback`, `/enable-listing`), but nothing in `src/` calls them: a coach cannot connect a calendar, choose one, or switch a session to calendar booking from the product. Only the client-side booking, checkout and cancel/reschedule UI is built.
- Render service with Postgres, verified webhook path with HMAC signature checks
- Custom booking UI replacing Sharetribe's, plus client cancel/reschedule (built; not yet exercised live end to end)
- **Booking creation after payment is now server-owned and recovers from failure** (branch `payment-failure-recovery`, not yet deployed). `server/api/nylas/bookingRecovery.js` `ensureBooking()` takes a Postgres claim (`nylas_booking_attempts`), makes up to two attempts (a network error, 408, 429 or 5xx is retried; "slot taken" or a rejected key is not), waits about 10 seconds for a late `booking.created` webhook, then runs `transition/operator-decline` (full refund, cancels the uncaptured card authorisation per Sharetribe's documentation) and logs to Sentry with the code `nylas-booking-failed-declined`. A webhook arriving after a decline cancels the orphaned Nylas booking (`nylas-orphan-booking-cancelled`). A 60-second sweeper in the web service (`server/jobs/`) handles paid bookings older than 3 minutes that the browser never reported. Sentry only records anything if `REACT_APP_SENTRY_DSN` is set in Render, and an alert rule is still needed for the email to Regan. Unproven end to end: the SQL has not been run against a real Postgres, and the Stripe test-mode check and the Dev process rollout are still to do.
- Google SSO, Integration API wired up
- **Brand tokens in `src/styles/revieTokens.css`**, imported after `marketplaceDefaults.css`. Lives on branch `revie-design-tokens` and is not yet committed or merged to `main`.

**Listing setup**
- Listing type `signature-session`, process `default-booking/release-1`, `unitType: fixed`, `availabilityType: oneSeat`, 20% provider commission
- Listing fields, the same in Dev, Test and Live: `identity`, `communication_style`, `structure`, `language`, `coachlocation`, `pre_work`
- One difference: Dev and Test have a `length` field; Live has `timezone` instead (a workaround for Sharetribe having no per-coach timezone; don't build anything on it)
- **`length` is "Session Length"** (an enum: 60, 90 or 120 minutes) and is a search filter. It is not connected to the booking duration. Decision (Oct 26): drop it and don't add it to Live; session length comes from price variations (below). Its only reference anywhere is its own definition in Dev's hosted `listing-fields.json`, so removing it also removes the "Session Length" search filter. No code, translation, config or doc in the repo reads it. Live has `timezone` instead and no `length`.
- Listing types and fields are hosted config in Console. The repo's local config files are the stock template, commented out, so the repo alone doesn't show them.

**Not built yet**
- The matching quiz and any matching/scoring logic. Matching can't run on Sharetribe search, so it will likely need our own logic on the Render server, using listing fields like the ones above.
- Coach onboarding for calendar booking: connect calendar, choose calendar, set working hours, enable a session (see above)
- **Booking-time enforcement of working hours and notice period.** Both are applied only when listing slots. Nothing re-checks them when a booking is created, so a crafted checkout request could book outside them. Also, the hours filter checks a slot's start but not its end, so a long session can run past closing time.
- Our own booking confirmation and reminder emails (no email-sending code exists in `server/`; no email library is installed; Nylas reminders are not configured in `scheduler.js`)
- Provider-initiated (coach) cancel/reschedule
- Coach subscriptions via Stripe Billing

## Nylas constraints that affect go-live
- The dev app is a free **Sandbox** in the **US region**. Coach calendar data is processed in the US until a non-sandbox application is created in the **EU region**. Region is fixed per application and grants can't be migrated, so this must happen before real coaches connect.
- On Sandbox, coaches see Nylas branding on the Google consent screen. Leaving Sandbox (Essentials, $15/mo) allows Revie's own Google credentials.
- Google OAuth verification (sensitive calendar scopes) is required beyond the 100-test-user allowance; weeks, not months.
- The Microsoft connector still requests mail and contacts scopes and must be narrowed before Outlook is offered.
- Nylas's availability endpoint ignores `min_booking_notice`; we filter on our server. Keep that filtering server-side.

## Emails
Every email today is a Sharetribe built-in. The default-booking process (`ext/transaction-processes/default-booking/`) sends:
- **At payment (`confirm-payment`):** release-1 emails the coach "You have a new booking request", the stock accept-or-decline wording. Process release-2 (in `ext/`, not yet pushed anywhere) removes it, so a coach is not emailed before the booking exists.
- **At `operator-accept`:** the client gets "Your booking request was accepted"; the coach gets an operator-accepted email.
- **At expiry / decline:** the client gets "request expired" or a failure email. In release-2 the failure email (sent by `operator-decline`) says the booking didn't go through and nothing was charged, and the expired email has a body for fixed-length sessions. The provider's "declined on your behalf" email is removed.
- **After the session (`complete`):** payout ("money paid") email to the coach and review requests to both.
- **Not covered at all:** `transition/cancel` (a cancelled session emails nobody), reschedules, payment expiry, and any reminder before the session.
- **Several templates have no body for our bookings.** The coach's confirmation ("operator accepted") still only branches on `unitType` of hour, day or night. Our sessions are `fixed`, so those emails render a title and a footer with no text about who, what or when. The coach's confirmation title reads "A booking request was accepted on your behalf" and ends "If you suspect this was a mistake, please contact the team". Only the client's "accepted" and the coach's "money paid" emails handle `fixed`. The client's "declined" and "expired" emails are fixed in release-2. Fixing the coach's confirmation means editing the template HTML in `ext/` and pushing the process with the CLI; Console's Email texts can only change the wording.
- Times in these emails come from the transaction's booking, which Sharetribe never updates, so they show the original time after a reschedule.
- Account emails (verify email, password reset, user approval) are Sharetribe built-ins configured in Console, not in the repo.
- Unverified: Google/Nylas may also send its own calendar invitation to the client when the booking event is created.
- **Nylas's own emails are off (Oct 28).** Every configuration is created and updated with `event_booking.disable_emails: true`, because a cancel produced two emails for each person. The calendar provider's invitation is separate and still goes out. **Open:** the email decision of Oct 28 lists Sharetribe cancellation emails to client and coach, but release-2 sends none (see "Not covered at all" above), so the other email seen on a cancel was not from the process. Cancellation emails need two new templates and notifications on `transition/cancel` (a new process version); proposed text is in the Oct 28 HANDOFF.
- **Console email texts shadow the templates' inline defaults** for any key Console already has, exactly as marketplace texts shadow `en.json`. `BookingFailed.*` and `BookingExpiredRequest.ContentForFixed` are release-2 keys Console does not have yet.

## Session lengths and price variations
- **The template (12.3) fully supports price variations for the `fixed` unit type.** The coach editor offers up to 20 variants per listing, each with a name, a price and a length (15-minute steps, up to 12 hours), stored in `publicData.priceVariants` as `{name, priceInSubunits, bookingLengthInMinutes}`. Dev's `signature-session` listing type has `priceVariations.enabled: true`.
- **Our booking form already knows about variants.** `NylasBookingForm` shows the variant picker, sends `priceVariantName` through checkout (it lands in the transaction's `protectedData`), and filters the slot list to the chosen variant's length in the browser.
- **But no length other than 60 minutes can be booked today.** Nylas returns slots at the configuration's fixed duration (`duration_minutes`, 60 in `scheduler.js`), so a 30, 90 or 120 minute variant finds no slots.
- **Nylas can't offer several lengths from one configuration.** Probed against the live API: a private configuration's availability endpoint rejects `duration_minutes` and `duration` (HTTP 400, "invalid path"). Nylas's docs say a booking's start and end "must correspond to a valid time slot returned by the Scheduling Availability endpoint using the same Configuration", so longer slots can't be built by joining shorter ones. Duration is one fixed value per configuration. The way through is one Nylas configuration per length. Nylas documents no limit on configurations per grant or application.
- **One Nylas configuration per session length (built Oct 28).** `publicData.nylasConfigurationIds` is `{ "<minutes>": id }`; the old single `nylasConfigurationId` is still written (always the 60-minute one) and still read as the "60" entry, so listings enabled earlier keep working. `server/api/nylas/bookingConfig.js` is the only file that knows both shapes. `resolveBookingTarget` picks the configuration from the booking's own length; the availability endpoint takes `priceVariantName` (booking form) or `lengthMinutes` (reschedule); reschedule refuses a new time of a different length. `enableListing` syncs one configuration per distinct variant length and keeps configurations for lengths no longer sold (a booked session can only be cancelled through its own). **If a coach adds a variant length, they must re-run enable for the new length to have times.** Slots start on the hour and half hour (`interval_minutes` 30, `round_to` 30). The Dev `length` field has not been removed yet.
- **Pricing no longer falls back silently** (branch `payment-failure-recovery`). `server/api-util/bookingVariantCheck.js`, called at the top of `transactionLineItems`, refuses a fixed-length booking whose `priceVariantName` is missing, unknown, or whose length differs from the variant's `bookingLengthInMinutes` (400 on initiate, the line-items estimate and transition-privileged). Before this, a missing name charged the base price (the lowest variant) and nothing compared lengths. It applies to any fixed listing with price variations switched on.
- **Live today (read from the public site, 46 listings, 47 variants):** 60 minutes ×24, 90 ×16, 75 ×4, 45 ×2, 30 ×1, none at 120. 45 and 75 minutes exist, not only multiples of 30. Live listings carry `startTimeInterval` and `timezone`, and no `calendarBookingEnabled`.

## Sharetribe constraints that shape design
- **Console marketplace texts shadow the repo's translations.** The app merges `{...en.json, ...hostedTranslations}` (`src/app.js`), and Dev's hosted `content/translations.json` holds a copy of essentially every template key (1,397). So changing the *value* of an existing key such as `TransactionPage.default-booking.customer.declined.title` in `src/translations/en.json` changes nothing on Dev: Console's value wins. Revie-specific text therefore goes under **new keys Console does not have** (e.g. `ManageCalendarBooking.*`, `NylasBookingForm.bookButton`), and stock keys are changed in Console (in Test, then copied to Dev). The repo's value for a stock key is kept equal to the intended Console value so the two agree. Email texts behave the same way: `content/email-texts.json` overrides the inline defaults in a process's templates for any key it already has (`BookingAcceptedRequest.*`, `BookingExpiredRequest.Title/Subject`), so those are also changed in Console, with no process push.
- **Nylas rejects `cancellation_url` / `rescheduling_url` unless they contain `:booking_ref`.** With the hosted links hidden the URLs are formal only, so they are the Revie orders page plus `?booking=:booking_ref`.
- **A calendar listing's process comes from `BOOKING_PROCESS_ALIAS`.** `enableListing` writes it onto the listing in the same update as the configuration ids and refuses to enable if it is unset; initiate refuses a calendar listing booked under any other alias. Dev: `default-booking/release-2` (in `render.yaml`). Production gets its own value at cutover.
- **The calendar event is edited after booking.** `eventDescription.js` writes the client's name and a link to that session's order page onto the event (the booking response carries `event_id`; the calendar id is `publicData.nylasCalendarId`, written by enable). Best effort: a failure is reported to Sentry and never fails the booking. Listings enabled before this have no `nylasCalendarId` until re-synced (`scripts/dev-resync-listing.js` on Dev).
- **Top-level data model is fixed:** users, listings, transactions, bookings, stock, reviews, messages, each extensible with extended data. No new first-class entities. Anything else needs our own database (Postgres on Render).
- **Users match to a coach but book a listing.** One coach has many Signature Sessions.
- **Sharetribe indexes listings, not users.** A "Browse coaches" page needs a deliberate architecture.
- **Search is filter-based, not relevance-ranked.** Keyword plus enum / multi-enum / number / boolean filters. Any "sorted by fit" is our own logic after retrieval.
- **Transaction processes** are ours to define from a fixed vocabulary of actions. Custom logic runs asynchronously via Events and the Integration API.
- **Reviews and messages attach to transactions.** Coach-level ratings must be computed.
- **Coach subscriptions are Stripe Billing**, separate from the Stripe Connect marketplace flow.
- **Sharetribe booking records can't be changed after creation.** A rescheduled session's real time lives in our Postgres table, not on the transaction.
- **Coaches no longer accept calendar bookings** (client changes deployed to Dev; process release-2 pushed to Dev only). Release-2 removes the provider `accept`/`decline` transitions. The client shows no Accept/Decline unless a transaction's `nextTransitions` still allows it (older release-1 transactions), no inbox badge (`statesNeedingProviderAttention` is empty), and `ACCEPT`/`DECLINE` stay in the client state graph for old transactions.
- **Process versions (as of 2026-10-27, `npx flex-cli process list --process default-booking --marketplace revie1-dev`):** Dev has version 1 (`default-booking/release-1`, 4 transactions) and version 2 (`default-booking/release-2`, pushed 11:02, 0 transactions). **Test and Live have not had release-2 pushed and must not until decided.** A new version only affects new transactions.
- **A new transaction uses the LISTING's `publicData.transactionProcessAlias`, not the listing type's.** The listing type's alias is only copied onto a listing when it is created, so changing the type in Console leaves existing listings on release-1. Existing Dev listings must be switched individually (`scripts/dev-listing-test-helper.js use-release-2`). Console's listing type cannot be set to a specific version (it only offers the default processes), so the listing type stays on release-1 and the alias has to be written onto each listing by other means; until that is built, the Dev "Test Session" listing was switched by hand with the helper.
- **Sharetribe validates bookings against the listing's `availabilityPlan`** when a booking is created, and `OrderPanel` needs `availabilityPlan.timezone` to render any booking form. `enableListing` therefore overwrites each calendar listing's plan with a 24/7 one carrying the calendar's time zone. Anything a coach enters in the stock Availability tab is discarded when that runs.
- **Console branding overrides code.** Hosted branding (colors, logo) is applied inline on `<html>` and beats the stylesheet; the repo's `configBranding.js` is only the local fallback.

## Where the platform touches the marketing site
*Not verifiable from this repo; kept as given.*
- A Zapier zap syncs coach edits from Sharetribe into the Webflow CMS (with a country-label mapping). If coach fields change, check the zap still works.
- GTM, the Meta pixel and the Pinterest tag live on Webflow. Booking conversions happen on the platform, so tracking needs adding there too.
- Brand assets: logo, hero image, social share images (1200×630, 600×314), replacing the biketribe placeholders. Status: the desktop (cream) and mobile logos are wired in `configBranding.js` as the local fallback, but Console's hosted logo still overrides them. The hero and social-share images are still the biketribe placeholders; Revie versions are in `src/assets/` but not yet imported.

## House rules for the repo
- **Until the Dec 14 cutover, edit Dev's Console directly. No Test → Dev copies.** Test stays a mirror of Live; a copy would replace Dev's cream wordmark, turn off file attachments and change listing approval. Every Dev-only Console change is logged in `go-live-plan.md` under "Dev-only Console changes to apply to Test and Live at cutover", and applied to Test and Live together at cutover. (This replaces the older "change Test, then copy forward" rule until then.)
- Use `npx flex-cli` for every flex-cli command and always pass `--marketplace revie1-dev` for Dev. Never push a process to Test or Live without being told to.
- Don't patch core template logic (e.g. `CustomLinksMenu.js`) to fix styling. Prefer additive files so upstream merges stay clean.
- Branch for anything global.
- Run locally with `op run --env-file=.env -- yarn dev`. Tests: `yarn test`, `yarn test-server`.
- Secrets never leave the repo or 1Password.
