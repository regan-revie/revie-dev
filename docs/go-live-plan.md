# Go-live plan

The working copy lives in the planning project's "Revie go-live plan" doc. This is the summary Claude Code works from. Do not put secrets in this folder; it is synced to Claude.ai.

*Last updated: 2026-10-26*

**Dates:** Live cutover Dec 14 (confirmed) · code freeze Dec 19 · public launch Jan 1, 2027.
**Calendars:** Google only at launch; Outlook later, no date.
**Scope:** see "Launch scope for Jan 1, 2027" in `decisions.md`.

## Phases
1. **Start the slow things (by Oct 26):** Nylas EU production app; Revie's own Google OAuth credentials; submit Google verification; merge `revie-design-tokens`; Console primary button colour to `#310416` (Test, then copy forward).
2. **Foundations (Oct 27 – Nov 9):** consistency pass, including the 68 unapproved colour pairings (booking path first: date picker, WeeklyCalendar); fix the topbar render loop; recovery when booking creation fails after payment; settle the Live `timezone` vs Dev/Test `length` field; check Sharetribe built-in emails; pick an email provider for reminders.
3. **Coach self-serve (Nov 3 – Nov 23):** calendar screens (connect, choose calendar, enable a session); working hours, one schedule per coach, enforced at booking time; onboarding order: sign up → create session → connect calendar → set hours → payout details → publish; block publishing until calendar and hours are set; listing approval on; coach cancel and reschedule.
4. **Booking-path redesign (Nov 10 – Dec 7):** coach profile → decide browse architecture → browse → checkout → confirmation; replace biketribe hero and social images.
5. **Production setup (Dec 1 – Dec 13):** upgrade to Extend; production Render service and Postgres (Frankfurt); production secrets from 1Password; DNS for platform.heyrevie.com; webhooks to production URL; Live Console branding and fields; conversion tracking with cookie consent; check the Zapier zap; email existing Live coaches.
6. **Soft launch (Dec 14 – Dec 31):** cut over; real end-to-end bookings; 3–5 coaches onboard themselves; rollback plan confirmed with Sharetribe.

If November slips, cut in this order: tracking, reminder email, browse polish. Never cut payment-failure recovery.
