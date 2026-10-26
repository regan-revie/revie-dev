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
- **Dev** (`revie_dev`): the only one that supports custom code; what this repo develops against. Private marketplace.
- **Test:** a no-code preview meant to mirror Live. Console config changes are made here and copied to Dev and Live.
- **Live:** production. A public marketplace, currently running Sharetribe's hosted frontend, not this codebase.

## What's already built (platform)
- **Nylas calendar integration:** coaches connect Google/Outlook; availability comes from their real calendar. Booking, payment capture and confirmation work end to end (first real booking 2026-09-13).
- **Working hours:** the availability endpoint reads `publicData.nylasOpenHours` per listing (one window of days + start + end) and filters slots by it. **Nothing in the repo writes that field**, so coaches have no way to set working hours; it has to be set by hand. A coach with no hours set is simply bookable at any time the calendar is free.
- **No coach-facing UI for the Nylas flow exists.** The server endpoints are there (`/api/nylas/connect`, `/callback`, `/enable-listing`), but nothing in `src/` calls them: a coach cannot connect a calendar, choose one, or switch a session to calendar booking from the product. Only the client-side booking, checkout and cancel/reschedule UI is built.
- Render service with Postgres, verified webhook path with HMAC signature checks
- Custom booking UI replacing Sharetribe's, plus client cancel/reschedule (built; not yet exercised live end to end)
- Google SSO, Integration API wired up
- **Brand tokens in `src/styles/revieTokens.css`**, imported after `marketplaceDefaults.css`. Lives on branch `revie-design-tokens` and is not yet committed or merged to `main`.

**Listing setup**
- Listing type `signature-session`, process `default-booking/release-1`, `unitType: fixed`, `availabilityType: oneSeat`, 20% provider commission
- Listing fields, the same in Dev, Test and Live: `identity`, `communication_style`, `structure`, `language`, `coachlocation`, `pre_work`
- One difference: Dev and Test have a `length` field; Live has `timezone` instead (a workaround for Sharetribe having no per-coach timezone; don't build anything on it)
- Listing types and fields are hosted config in Console. The repo's local config files are the stock template, commented out, so the repo alone doesn't show them.

**Not built yet**
- The matching quiz and any matching/scoring logic. Matching can't run on Sharetribe search, so it will likely need our own logic on the Render server, using listing fields like the ones above.
- Coach onboarding for calendar booking: connect calendar, choose calendar, set working hours, enable a session (see above)
- **Booking-time enforcement of working hours and notice period.** Both are applied only when listing slots. Nothing re-checks them when a booking is created, so a crafted checkout request could book outside them. Also, the hours filter checks a slot's start but not its end, so a long session can run past closing time.
- Our own booking confirmation and reminder emails (no email-sending code exists in `server/`)
- Provider-initiated (coach) cancel/reschedule
- Recovery if the create-booking call fails after payment (the transaction would stall at `confirm-payment`)
- Coach subscriptions via Stripe Billing

## Nylas constraints that affect go-live
- The dev app is a free **Sandbox** in the **US region**. Coach calendar data is processed in the US until a non-sandbox application is created in the **EU region**. Region is fixed per application and grants can't be migrated, so this must happen before real coaches connect.
- On Sandbox, coaches see Nylas branding on the Google consent screen. Leaving Sandbox (Essentials, $15/mo) allows Revie's own Google credentials.
- Google OAuth verification (sensitive calendar scopes) is required beyond the 100-test-user allowance; weeks, not months.
- The Microsoft connector still requests mail and contacts scopes and must be narrowed before Outlook is offered.
- Nylas's availability endpoint ignores `min_booking_notice`; we filter on our server. Keep that filtering server-side.

## Sharetribe constraints that shape design
- **Top-level data model is fixed:** users, listings, transactions, bookings, stock, reviews, messages, each extensible with extended data. No new first-class entities. Anything else needs our own database (Postgres on Render).
- **Users match to a coach but book a listing.** One coach has many Signature Sessions.
- **Sharetribe indexes listings, not users.** A "Browse coaches" page needs a deliberate architecture.
- **Search is filter-based, not relevance-ranked.** Keyword plus enum / multi-enum / number / boolean filters. Any "sorted by fit" is our own logic after retrieval.
- **Transaction processes** are ours to define from a fixed vocabulary of actions. Custom logic runs asynchronously via Events and the Integration API.
- **Reviews and messages attach to transactions.** Coach-level ratings must be computed.
- **Coach subscriptions are Stripe Billing**, separate from the Stripe Connect marketplace flow.
- **Sharetribe booking records can't be changed after creation.** A rescheduled session's real time lives in our Postgres table, not on the transaction.
- **Sharetribe validates bookings against the listing's `availabilityPlan`** when a booking is created, and `OrderPanel` needs `availabilityPlan.timezone` to render any booking form. `enableListing` therefore overwrites each calendar listing's plan with a 24/7 one carrying the calendar's time zone. Anything a coach enters in the stock Availability tab is discarded when that runs.
- **Console branding overrides code.** Hosted branding (colors, logo) is applied inline on `<html>` and beats the stylesheet; the repo's `configBranding.js` is only the local fallback.

## Where the platform touches the marketing site
*Not verifiable from this repo; kept as given.*
- A Zapier zap syncs coach edits from Sharetribe into the Webflow CMS (with a country-label mapping). If coach fields change, check the zap still works.
- GTM, the Meta pixel and the Pinterest tag live on Webflow. Booking conversions happen on the platform, so tracking needs adding there too.
- Brand assets: logo, hero image, social share images (1200×630, 600×314), replacing the biketribe placeholders. Status: the desktop (cream) and mobile logos are wired in `configBranding.js` as the local fallback, but Console's hosted logo still overrides them. The hero and social-share images are still the biketribe placeholders; Revie versions are in `src/assets/` but not yet imported.

## House rules for the repo
- Make Sharetribe Console config changes in **Test** and copy forward; don't edit Dev directly.
- Don't patch core template logic (e.g. `CustomLinksMenu.js`) to fix styling. Prefer additive files so upstream merges stay clean.
- Branch for anything global.
- Run locally with `op run --env-file=.env -- yarn dev`. Tests: `yarn test`, `yarn test-server`.
- Secrets never leave the repo or 1Password.
