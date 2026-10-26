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
