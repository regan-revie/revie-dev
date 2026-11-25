# Booking confirmation design (approved Nov 24, 2026)

Copy of the canvas **"Revie booking confirmation — desktop & phone"** (https://claude.ai/artifact/BtVN96DU2X6ZU7c58vWMnQ),
saved so the build and later jobs have it in the repo. Open any `.dc.html` file to read the markup; the values
(colours, sizes, spacing, radii, weights) in the inline styles are the spec.

| File | What it is | Built |
|---|---|---|
| `project/Main.dc.html` | Desktop, the client's booking page: hero, "Your session" card (with the reschedule, move-confirm and cancel panels, played with the buttons), "What happens next.", the message card, the payment box | Yes |
| `project/Phone.dc.html` | The same on a phone | Yes |
| `project/States.dc.html` | The other states: confirming, "didn't go through", cancelled early, cancelled late, the coach cancelled, and a session inside 48 hours | Yes |
| `project/HeroB.dc.html` | "Hero, option B (date between you)": the hero with the date card between the two photos. This is the one Main and Phone use and the one built | Yes |
| `project/canvas.json`, `project/ds/revie/tokens.json` | Where each board sits, and the Revie design tokens the canvas used | |

Notes for reading the files:
- Coach, copy, times and prices in them are made up. The page uses the real session, coach, times and price.
- `/_blob/...` image and font URLs do not load outside the canvas. The repo's own fonts, tokens and icons are used.
- The files use the canvas's own `<x-dc>` / `<sc-if>` / `{{hole}}` syntax, not React.
- The canvas shows a card ("Visa ending 4242") and "Usually replies within a day" (its own note says cut it if it cannot be measured). Neither is built: the transaction carries no card details, and nothing measures replies.

Where the built version lives: `src/containers/TransactionPage/BookingConfirmation/` (hero, sections, state logic, date helpers), `ManageCalendarBooking/` (the "Your session" card), wired in `TransactionPage.js` for a client's calendar-booked session. Try every state without an account or a booking at
`/styleguide/c/BookingConfirmation/BookedWithPrep`, `BookedNoPrep`, `BookedInsideFreeWindow`, `Confirming`, `DidntGoThrough`, `CancelledRefunded`, `CancelledLate` and `CancelledByCoach` (add `?bare=1` to hide the styleguide frame; on Dev the styleguide redirects to sign-up unless logged in).
What was built, what differs from the canvas and why: the HANDOFF "booking confirmation" in `docs/changelog.md` and "The client's booking page" in `docs/tech-constraints.md`.
