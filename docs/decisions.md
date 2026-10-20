# Decisions

Newest first. Each entry is a "### DECISION:" block pasted from the planning
project. Do not put secrets in this folder; it is synced to Claude.ai.

Newest at the top. When the planning project settles something, it produces a `### DECISION:` block; add it here. This folder syncs to the Claude project via GitHub.

---

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
- **Matching quiz:** not built. What questions, how scoring works, where it runs, and what's realistic by Jan 1.
- How does coach browse work, given Sharetribe indexes listings not users?
- Where do the existing 200+ quiz responses live, and can they inform the quiz design?
- When to upgrade to Extend ahead of Jan 1
