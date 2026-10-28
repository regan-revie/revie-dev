# Decisions

Newest first. Each entry is a "### DECISION:" block pasted from the planning
project. Do not put secrets in this folder; it is synced to Claude.ai.

Newest at the top. When the planning project settles something, it produces a `### DECISION:` block; add it here. This folder syncs to the Claude project via GitHub.

---

### DECISION: Edit Dev's Console directly until cutover
**Date:** Oct 28, 2026
**Decision:** Until the Dec 14 cutover, Console changes for the new platform are made directly in Dev, and logged in docs/go-live-plan.md under "Dev-only Console changes". No Test → Dev copies. At cutover, the logged changes are applied to Test and Live together. Test stays a mirror of Live until then.
**Why:** Test must preview Live (old look, hosted frontend) while Dev carries the new brand; a Test → Dev copy would replace Dev's cream wordmark, turn off file attachments and change listing approval. Replaces the "change Test, then copy forward" house rule until cutover.
**Affects:** CLAUDE.md, docs/tech-constraints.md house rules, docs/go-live-plan.md cutover checklist.

### DECISION: Which emails come from Sharetribe and which from Postmark
**Date:** Oct 28, 2026
**Decision:** Sharetribe sends: Accepted request (client, "You're booked"), Operator accepted request (coach, "You've got a session"), Operator declined request and Expired request (client, "That one didn't go through, and you haven't been charged"), cancellation emails to client and coach, Money paid, and the review emails. New request and Declined request aren't sent under release-2. Postmark sends late-cancellation, reschedule and reminder emails only. Nylas Scheduler's own emails are turned off (disable_emails). Klaviyo is marketing only.
**Why:** In testing, a cancel sent both a Sharetribe and a Nylas email to each person. Sharetribe already covers cancellations; Postmark fills only what it can't (no transition for late cancels, fixed times after a reschedule).
**Affects:** Console Email texts, Nylas configuration, server/email (Postmark).

### DECISION: Console texts hold only Revie's overrides
**Date:** Oct 28, 2026
**Decision:** Console marketplace and email texts keep only keys Revie deliberately changed; everything else comes from the repo's en.json. Wording changes go in the repo unless they must be editable without a deploy.
**Why:** Dev's Console held a copy of nearly every stock key, so repo wording changes silently never appeared.
**Affects:** Console marketplace texts and email texts (Dev now, Test and Live at cutover), src/translations/en.json.

### DECISION: Coach profile redesign starts now
**Date:** Oct 28, 2026
**Decision:** The coach profile (listing page) redesign starts the week of Oct 28, ahead of the Nov 10 phase-4 date. Browse follows, opening with a few recommended coaches and a "Help me choose" link before the full list. Until cutover, a hand-run "Help me choose" form on the Live search page and heyrevie.com routes clients to Regan for personal matches.
**Why:** Clients reach the search and coach pages and leave; the coach page doesn't give a full picture of the coach and the platform looks unfinished.
**Affects:** Phase 4 timing in docs/go-live-plan.md, design work, browse layout.

### DECISION: Calendar listings move to release-2 when booking is enabled
**Date:** Oct 28, 2026
**Decision:** enableListing writes publicData.transactionProcessAlias from a server setting (BOOKING_PROCESS_ALIAS) in the same update as the Nylas configuration id, and refuses to write it if the setting is missing. Listing types stay on release-1 everywhere. The server rejects a booking on a calendar listing with any alias other than the listing's own.
**Why:** Console can't pin a listing type to a process version. Tying the alias to calendar enablement keeps them in sync.
**Affects:** enableListing, transaction initiate check, Render env (Dev now, production at cutover).

### DECISION: Booking is instant, and the wording and invite say so
**Date:** Oct 28, 2026
**Decision:** The booking button says "Book a session", the confirmed state says "You're booked.", and a failed booking says "That one didn't go through, and you haven't been charged. Pick another time and we'll get you booked." No "request", "accepted" or "declined" wording for calendar sessions. Calendar events are titled "{session name} with {coach name}", include the client's name, a Revie link and an auto-created Google Meet link. Nylas's own cancel/reschedule links are hidden; all changes go through Revie.
**Why:** Bookings are confirmed instantly by the calendar. "Declined" made clients think the coach rejected them. Nylas's links bypassed our 48-hour rule and refunds.
**Affects:** Marketplace texts or translations, email templates, Nylas configuration.

### DECISION: Cancelling is confirmed before and after
**Date:** Oct 28, 2026
**Decision:** Clients confirm before cancelling, with the refund outcome stated (full refund over 48 hours, charged inside 48). After cancelling, the page says so clearly, and Reschedule and Cancel are hidden for cancelled, completed or declined sessions.
**Why:** In testing the cancel worked but gave no confirmation and left the buttons visible.
**Affects:** Transaction page session panel, cancel flow, translations.

### DECISION: Dev's Test Session listing runs release-2; listing types stay on release-1
**Date:** Oct 27, 2026
**Decision:** The Dev "Test Session" listing carries `publicData.transactionProcessAlias: default-booking/release-2` (no provider accept/decline; the server confirms or declines bookings). Release-2 is not pushed to Test or Live.
**Correction (same day):** this entry first said Dev's *listing type* points at release-2. That is not possible: Console's listing type only offers Sharetribe's default processes, not a specific version, so every environment's listing type stays on `default-booking/release-1`. A Test to Dev copy of listing types is therefore harmless again. What matters is the alias stored on each *listing*, which decides the process of every new transaction. How new listings get release-2 before the Dec 14 cutover is still to be decided (see the HANDOFF of Oct 27).
**Affects:** the Dev "Test Session" listing, new-listing creation, Live cutover (release-2 goes to Live at cutover).

### DECISION: Booking slots start every 30 minutes; no length filter
**Date:** Oct 27, 2026
**Decision:** Slots for every session length start on the hour and half hour. Each length gets its own Nylas configuration (publicData.nylasConfigurationIds keyed by length). The "Session Length" search filter is removed with the `length` field. The server rejects a booking whose price variant is missing, unknown, or doesn't match the booked length.
**Why:** Live has 45, 75 and 90 minute sessions; hourly starts waste time. With dozens of coaches, clients choose a coach, not a length.
**Affects:** scheduler.js, enableListing, availability endpoint, booking initiate, listing search config.

### DECISION: Session lengths use Sharetribe price variations
**Date:** Oct 26, 2026
**Decision:** A Signature Session can offer several lengths (30 to 120 minutes) using Sharetribe's built-in price variations, each with its own name, price and booking length. Our booking UI, Nylas availability endpoint, booking creation and working-hours check all use the chosen variation's length. The `length` listing field is dropped and not added to Live.
**Why:** Coaches sell 30 to 120 minute sessions; today every slot is 60 minutes. Price variations are built in and avoid duplicate listings per length.
**Affects:** Listing type config (Test → Dev and Live), custom booking UI, checkout, Nylas availability endpoint, booking creation, Live cutover.

### DECISION: Cancellation policy
**Date:** Oct 26, 2026
**Decision:** Clients can cancel free up to 48 hours before a session; after that the session is charged. No exceptions at launch. A deposit for exams or assessments a coach buys for the client is a post-launch item.
**Affects:** Client cancellation emails (Postmark), checkout copy, booking terms.

### DECISION: Support email is hello@heyrevie.com
**Date:** Oct 26, 2026
**Decision:** hello@heyrevie.com is the support address in every email footer and the reply-to on Postmark emails.
**Affects:** Sharetribe email templates, Postmark templates.

### DECISION: Booking failure after payment releases the hold
**Date:** Oct 26, 2026
**Decision:** The server owns create-booking after payment. It retries once; on a second failure it declines the transaction (releasing the card authorisation), logs to Sentry and emails Regan. A coach never sees an acceptable request for a session that isn't on their calendar.
**Why:** Today a failed booking leaves a "new booking request" the coach can accept by hand, charging the client for a session that doesn't exist.
**Affects:** CheckoutPageWithPayment.js, server booking route, transaction process (Dev).

### DECISION: Working hours are one schedule per coach
**Date:** Oct 26, 2026
**Decision:** Each coach has one working-hours schedule, stored on their user profile and edited with the template's plan form. Availability reads it from the listing author. Hours and notice period are enforced when slots are listed AND when a booking is created, checking both the start and end of the session.
**Why:** A coach has one calendar across all their sessions; one schedule is simpler to set and to explain. Booking-time checks close a gap where a crafted request could book outside hours.
**Affects:** Nylas availability endpoint, booking creation, coach onboarding.

### DECISION: Launch scope for Jan 1, 2027
**Date:** Oct 20, 2026
**Decision:** Launch with fully self-serve coach onboarding, Google Calendar only, 20% commission only, and a redesign of the booking path (browse, coach profile, checkout, confirmation). The matching quiz, Stripe Billing subscriptions, Outlook and the coach dashboard redesign come after launch.
**Why:** 10 weeks, one builder. Quiz and subscriptions aren't needed to take a booking.
**Affects:** `docs/go-live-plan.md`; quiz moves to Q1 2027.

### DECISION: Redesign the booking path only before launch
**Date:** Oct 20, 2026
**Decision:** Full redesign for browse, coach profile, checkout and confirmation, in that order after the Layer 2 consistency pass, starting with the coach profile. Every other screen gets brand tokens only.
**Affects:** Layer 3 scope in "Order of work for the platform" (Sept 2026).

### DECISION: Cut over Live on Dec 14, announce Jan 1
**Date:** Oct 20, 2026 (confirmed Oct 26)
**Decision:** Switch Live to this codebase on Dec 14, code freeze Dec 19, public announcement Jan 1.
**Why:** Two weeks of real bookings before launch, and a buffer before holiday support slowdowns.
**Affects:** Extend upgrade moves to ~Dec 1.

### DECISION: Body font is Bio Sans
**Date:** Oct 20, 2026
**Decision:** Bio Sans is the body font. Regan has added the files to the fonts folder. Inter is no longer a stand-in.
**Affects:** `--fontFamily` in `revieTokens.css`, `@font-face` rules, `public/index.html`

### DECISION: Colours follow the brand guidelines
**Date:** Oct 20, 2026
**Decision:** Maroon and lavender are the primary colours. Every text/background combination must be an approved pairing from `docs/brand.md`. Primary button: maroon ground, off-white label. Secondary: lavender ground, maroon label. Pink is hover/accent only. Orange is accent only.
**Why:** The guidelines are the source of truth. This replaces the lavender-primary / outlined-maroon setup currently in the code.
**Affects:** `--colorPrimaryButton*`, `--colorSecondaryButton*` in `revieTokens.css`

### DECISION: Use the real brand fonts
**Date:** Oct 20, 2026
**Decision:** TT Commons Pro (headlines), Bio Sans (body), Schibsted Grotesk (CTAs, all caps). We own or have permissions for all three. Replaces the September Hanken Grotesk / Inter substitutes.
**Affects:** `--fontFamilyHeadline` and `--fontFamily` in `revieTokens.css`; font loading; CSP if using Adobe Fonts.

### DECISION: Scope is the platform only
**Date:** Oct 20, 2026
**Decision:** Rebuild platform.heyrevie.com. heyrevie.com stays on Webflow.
**Go-live:** January 1, 2027.

### DECISION: Brand tokens live in one additive file
**Date:** Sept 2026
**Decision:** All brand values go in `src/styles/revieTokens.css`, imported after `marketplaceDefaults.css`. No hex values hardcoded in components.
**Why:** Upstream template merges stay clean; one place to change the brand.

### DECISION: Primary colors are maroon and lavender
**Date:** Sept 2026
**Decision:** Primary button maroon with off-white label; secondary lavender with maroon label; hover pink `#FF90C2`. Orange is an accent only.
**Why:** Brand guidelines; pink hover matches the live marketing site.

### DECISION: Radius and shadows
**Date:** Sept 2026
**Decision:** 8 / 12 / 20px radius plus pill; maroon-tinted shadows; warm grey ramp from `#EFEEED`.

### DECISION: Order of work for the platform
**Date:** Sept 2026
**Decision:** Layer 1 tokens → Layer 2 consistency pass (hardcoded radii and hex values across ~37 files) → Layer 3 screen-by-screen redesign, starting with the coach profile.

---

## Open questions
- **Matching quiz:** deferred to Q1 2027 (see Launch scope). What questions, how scoring works, where it runs.
- How does coach browse work, given Sharetribe indexes listings not users?
- Where do the existing 200+ quiz responses live, and can they inform the quiz design?
- When to upgrade to Extend ahead of Jan 1 (~Dec 1, ahead of the Dec 14 cutover)
