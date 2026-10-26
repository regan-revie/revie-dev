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
