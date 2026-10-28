# Go-live plan

The working copy lives in the planning project's "Revie go-live plan" doc. This is the summary Claude Code works from. Do not put secrets in this folder; it is synced to Claude.ai.

*Last updated: 2026-10-28*

**Dates:** Live cutover Dec 14 (confirmed) · code freeze Dec 19 · public launch Jan 1, 2027.
**Calendars:** Google only at launch; Outlook later, no date.
**Scope:** see "Launch scope for Jan 1, 2027" in `decisions.md`.

## Phases
1. **Start the slow things (by Oct 26):** Nylas EU production app; Revie's own Google OAuth credentials; submit Google verification; merge `revie-design-tokens`; Console primary button colour to `#310416` (done); Postmark account, heyrevie.com DNS verification and DPA.
2. **Foundations (Oct 27 – Nov 9):** consistency pass, including the 68 unapproved colour pairings (booking path first: date picker, WeeklyCalendar); fix the topbar render loop; recovery when booking creation fails after payment; session lengths via Sharetribe price variations (one session, several lengths; booking UI, availability, booking creation and working-hours check use the chosen length; drop the `length` field); fix Sharetribe built-in emails (coach "new request" wording, missing fixed-length body text; Sharetribe keeps booked, failed and expired); Sharetribe keeps the booked, failed, expired, cancellation (refunded) and money-paid emails, Postmark sends late-cancellation, reschedule and reminder emails (not Klaviyo), and Nylas's own emails are off, using Postmark hosted templates so Regan can edit copy; Klaviyo is marketing only.
3. **Coach self-serve (Nov 3 – Nov 23):** calendar screens (connect, choose calendar, enable a session); working hours, one schedule per coach, enforced at booking time; onboarding order: sign up → create session → connect calendar → set hours → payout details → publish; block publishing until calendar and hours are set; listing approval on; coach cancel and reschedule.
4. **Booking-path redesign (starts week of Oct 28, runs to Dec 7):** the coach profile redesign starts now, ahead of the original Nov 10 date; browse follows, opening with a few recommended coaches and a "Help me choose" link before the full list; then checkout → confirmation; replace biketribe hero and social images. Until cutover, a hand-run "Help me choose" form on the Live search page and heyrevie.com routes clients to Regan for personal matches.
5. **Production setup (Dec 1 – Dec 13):** upgrade to Extend; production Render service and Postgres (Frankfurt); production secrets from 1Password; DNS for platform.heyrevie.com; webhooks to production URL; Live Console branding and fields; conversion tracking with cookie consent; check the Zapier zap; email existing Live coaches.
6. **Soft launch (Dec 14 – Dec 31):** cut over; real end-to-end bookings; 3–5 coaches onboard themselves; rollback plan confirmed with Sharetribe.

If November slips, cut in this order: tracking, reminder email, browse polish. Never cut payment-failure recovery.

## Dev-only Console changes to apply to Test and Live at cutover

Until Dec 14 the new platform's Console changes are made directly in Dev (see "Edit Dev's Console directly until cutover" in `decisions.md`). Test stays a mirror of Live. At cutover everything below is applied to Test and Live together. Add to this list every time a Dev-only Console change is made.

**Found by comparing Dev with Test on Oct 28** (hosted assets; names only):
- [ ] Branding: `logo` (Dev's cream desktop wordmark; **Live must keep the maroon one until it runs this codebase**, see CLAUDE.md) and `loginBackgroundImage`.
- [ ] Listing type `signature-session`: `defaultListingFields.files` = false, `imageSettings.limitImages` = false, `messagingOptions.fileAttachments` = true (Test has fileAttachments off).
- [ ] Access control: `listings.requireApprovalToPublish` is off in Dev and on in Test. Decide the intended value before cutover (Phase 3 says listing approval on).
- [ ] User field `certifications`: `showConfig.unselectedOptions` is off in Dev, on in Test.

**Made or planned in Dev since:**
- [ ] Marketplace texts: replace the 1,397-key copy with the trimmed overrides (decision "Console texts hold only Revie's overrides"), including the instant-booking wording.
- [ ] Email texts: the release-2 booking emails (accepted, operator accepted, failed/declined, expired, money paid) and the footer line; cancellation emails once they exist.
- [ ] Remove the `length` listing field (session length comes from price variations); check the Zapier zap first.
- [ ] Transaction process: release-2 is on Dev and (Oct 28) Test as version 2 with alias `release-2`, no transactions on it. Live gets it at cutover, then `BOOKING_PROCESS_ALIAS` is set on the production service.
