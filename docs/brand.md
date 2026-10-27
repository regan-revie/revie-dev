# Brand

Source of truth for colors, type, shape and voice. If something isn't here, it's a brand decision, not a CSS decision. Ask.

Values are from `Revie_-BrandGuidelines.pdf` (Adobe Illustrator, 13 Oct 2025, 31pp). Contrast ratios are computed, not copied from the PDF. Do not put secrets in this folder; it is synced to Claude.ai.

## Palette
| Color | Hex | RGB | CMYK | Pantone | Role | Code token (`revieTokens.css`) |
|---|---|---|---|---|---|---|
| Maroon | `#310416` | 49, 4, 22 | C58 M89 Y50 K81 | 7421 C | **Primary.** Dark ground, primary buttons, body text | `--revieMaroon` |
| Lavender (lilac) | `#DBABF5` | 219, 171, 245 | C23 M38 Y0 K0 | 2562 C | **Primary.** Secondary buttons, highlights | `--revieLavender` |
| Off-white / brand grey | `#EFEEED` | 239, 238, 237 | C7 M5 Y6 K0 | Gray 1 C | Primary light ground, borders, rules | `--revieCream` |
| Forest | `#032723` | 3, 39, 35 | C92 M54 Y67 K75 | 5535 C | Accent | `--revieGreen` |
| Pink | `#FF90C2` | 255, 144, 194 | C0 M56 Y0 K0 | 190 C | Accent, button hover | `--reviePink` |
| Orange | `#FF9352` | 255, 147, 82 | C0 M52 Y68 K0 | 1635 C | Accent. **Not** a primary color. | `--revieOrange` |
| Periwinkle | `#D8E6FF` | 216, 230, 255 | C17 M6.9 Y0 K0 | 2708 C | Accent | `--reviePeriwinkle` |
| Chartreuse | `#EAEA73` | 234, 234, 115 | C14 M0 Y65 K0 | 379 C | Accent | `--revieChartreuse` |

Tonal variants (derived by lightness only): `--revieMaroonDeep`, `--revieMaroonSoft`, `--revieLavenderDeep`, `--revieLavenderSoft`.

**Rules**
- Maroon and lavender carry the main actions. Orange, pink, periwinkle and chartreuse are for tags, illustration, empty states and emphasis.
- Pink and chartreuse take maroon type and nothing else. Do not put white, green, orange or lavender type on them.
- Primary button: maroon ground, off-white label (15.6:1). Secondary: lavender ground, maroon label (9.6:1). Both AAA.
- Greys are warm (hue 30), built from `#EFEEED`, resolving into maroon at the dark end. Never cool blue-greys.
- Shadows are tinted maroon, not black.
- The brand guidelines PDF lists periwinkle as R216 G30 B255, which is not `#D8E6FF`. The hex above is correct.
- Do not scatter raw hex values through components. A hex outside the token definitions is a bug.

## Approved pairings (and only these)
From the "Color Combinations & Contrast" page of the guidelines. Every one clears WCAG AAA for normal text. Contrast ratios recomputed.

| Background | Permitted text | Contrast | Permitted accents |
|---|---|---|---|
| Maroon `#310416` | Lavender | 9.62 | Lavender, orange, periwinkle, chartreuse, pink |
| Maroon | Orange | 8.23 | (as above) |
| Maroon | Off-white | 15.63 | (as above) |
| Maroon | Pink | 8.64 | (as above) |
| Forest `#032723` | Lavender | 8.46 | Lavender, orange, periwinkle, chartreuse |
| Forest | Chartreuse | 12.53 | (as above) |
| Forest | Periwinkle | 12.65 | (as above) |
| Off-white `#EFEEED` | Maroon | 15.63 | Lavender, orange, periwinkle |
| Periwinkle `#D8E6FF` | Forest | 12.65 | Forest, off-white, orange |
| Lavender `#DBABF5` | Maroon | 9.62 | Maroon, off-white, orange |
| Orange `#FF9352` | Maroon | 8.23 | Maroon, periwinkle, chartreuse |
| Pink `#FF90C2` | Maroon | 8.64 | Maroon **only** |
| Chartreuse `#EAEA73` | Maroon | 14.24 | Maroon **only** |

## Type
| Role | Typeface | CSS variable |
|---|---|---|
| Main headlines | TT Commons Pro (Regular and Bold) | `--fontFamilyHeadline` |
| Secondary headlines, CTAs (ALL CAPS) | Schibsted Grotesk | `--fontFamilySecondary` |
| Body | Bio Sans | `--fontFamily` |

Headlines are large, expressive messages with personality; subheads are noticeable but minimal; body copy is succinct and easy to read.

We own or have web permissions for all three. No substitutes.

If TT Commons Pro or Bio Sans load from Adobe Fonts, every domain the app runs on (localhost:3000, revie-dev.onrender.com, platform.heyrevie.com) must be on the Web Project's allowlist, and `server/csp.js` must allow use.typekit.net and p.typekit.net.

## Shape
- Rounded, pill-like forms, echoing the logo and tag treatments
- Radius: 8px default, 12px medium, 20px large, pill (999px) for tags and chips

## Logo
- **Minimum size:** 0.5 inches tall, measured top to bottom of the wordmark. Proportions never change.
- **Clear space:** X = the height of the "R". Maintain X on all four edges of the wordmark. Nothing enters that zone.
- **Never:** stretch or compress, rotate any portion, change colors, resize any portion, place elements in the clear space, add drop shadows or any other effect.
- **Favicon:** the standalone "R" mark, maroon on lavender.

## Voice
Revie is a curated coaching platform for ambitious women tired of one-size-fits-all advice. It strips away the noise of hustle culture and quick fixes, offering instead a sharp, witty, and deeply human approach to growth. Every experience is tailored, validating, and practical. Support that feels bold enough to name the truth, warm enough to hold you through it, and grounded enough to actually work.

**Values:** bold, witty, warm, grounded, supportive, optimistic.
**Sounds like:** "Take your life off mute." "Band-aids are for blisters, not your life." "Survival mode isn't forever."
**Do:** short, punchy lines; specifics over abstractions; talk to one woman like a friend who's been there; outcome-based session names ("Get clear on your values & make decisions you trust," not "Career coaching").
**Don't:** therapy-speak, diagnosing the reader, corporate filler.

Taglines in circulation: "Personal growth, reimagined." / "Coaching that fits your life." / "Find your coach, fit for your life." / "The support you deserve, finally made to fit." / "Find your coach. Build your path." / "Aligned coaches. Real connection. Lasting growth."

## How each value shows up visually
| Value | Meaning | Visual translation |
|---|---|---|
| **Bold** | Names the truths others avoid; cuts through outdated rules and hustle culture. | Unapologetic typography, confident color contrasts, sharp elements that don't whisper. |
| **Witty** | Intelligent and culturally aware. Clever and self-aware, never flippant. | Playful text treatments, layered collages, unexpected graphic moments. |
| **Warm** | Leads with empathy; emotionally safe, validated, supported before being challenged. | Approachable photography, natural light, human expressions, bright energy balanced with soft grounding hues. |
| **Grounded** | Rooted in clarity and practicality. Guidance is never abstract. | Clean layouts, structured grids, typography that is intelligent yet approachable. |
| **Supportive** | Counters the isolation women and coaches feel. | Process and imperfection: handwritten notes, evolving sketches, layered elements that signal collaboration. Growth isn't linear. |
| **Optimistic** | Forward-looking energy that fuels change without dismissing struggle. Not toxic positivity. | Vibrant gradients, expansive photography, energizing and future-driven tone. |

## Photography
**Embrace:** everyday environments (living rooms, home offices, shared tables, outdoor walks). Real people mid-action: writing, thinking, listening, pausing, stretching. Leaning-forward body language and relaxed postures. Natural daylight or gentle on-camera flash. Details that suggest real life unfolding: notebooks, sticky notes, mugs, a child's toy in the background. Charm in imperfection: messy desks, laughter breaking focus, casual clothing, natural hair. Minimal editing: no heavy filters, slightly lifted shadows, crisp whites.

**Avoid:** staged or posed stock scenarios. Sterile studio setups with blank backdrops. Glamourized or fashion-first styling. Flat, lifeless lighting. Stereotype shorthand ("corporate professional only" or "girlboss" tropes).

**Rights warning:** every image in the brand guidelines is reference only. Revie does not hold rights to any of it. None of it goes into a prototype, a deck, or the live build.
