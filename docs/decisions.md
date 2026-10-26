# Decisions

Newest first. Each entry is a "### DECISION:" block pasted from the planning
project. Do not put secrets in this folder; it is synced to Claude.ai.

Newest at the top. When the planning project settles something, it produces a `### DECISION:` block; add it here. This folder syncs to the Claude project via GitHub.

---

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

### DECISION: Cut over Live on Dec 14, announce Jan 1 (PROPOSED, not yet confirmed by Regan)
**Date:** Oct 20, 2026
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
- When to upgrade to Extend ahead of Jan 1 (proposed: ~Dec 1)
