# Checkout design (approved Nov 24, 2026)

Copy of the canvas **"Revie checkout — desktop & phone"** (https://claude.ai/artifact/WXvcpK3omrBiv3GSzfnpXv),
saved so the build and later jobs have it in the repo. Open any `.dc.html` file to read the markup; the values
(colours, sizes, spacing, radii, weights) in the inline styles are the spec.

| File | What it is | Built |
|---|---|---|
| `project/Main.dc.html` | Desktop checkout: slim bar, "Complete your booking.", note + payment on the left, the maroon summary on the right | Yes |
| `project/Phone.dc.html` | Phone: summary first, then the form, a sticky Book bar | Yes |
| `project/States.dc.html` | Promo errors, card declined, no connection | Yes (the promo wording is the existing wording, see below) |
| `project/SignUp.dc.html`, `SignUpPhone.dc.html`, `SignUpStates.dc.html`, `LogIn.dc.html`, `BannerPage.dc.html` | Sign up, log in and the confirm-email strip: a **proposal for review** on the same canvas (its own note says so) | **No.** Not part of the checkout job |
| `project/canvas.json`, `project/ds/revie/tokens.json` | Where each board sits, and the Revie design tokens the canvas used | |

Notes for reading the files:
- Coach, copy, dates and prices in them are made up. The page uses the real session, coach and price.
- `/_blob/...` image and font URLs do not load outside the canvas. The repo's own fonts, tokens and icons are used.
- The files use the canvas's own `<x-dc>` / `<sc-if>` / `{{hole}}` syntax, not React.
- `Main.dc.html` and `Phone.dc.html` have one unfinished style, `color: {C}` on "Find a new time" (an unresolved placeholder). The build uses cream, like the other links on the maroon card.

Where the built version lives: `src/containers/CheckoutPage/RevieCheckout/` (bar and footer, summary, error note, date helpers), `StripePaymentForm/` (the form),
`PromoCodeSection/` (the code control, now inside the summary). Try it without an account or a card at
`/styleguide/c/CheckoutPage/Checkout`, `.../CheckoutWithPromo`, `.../CheckoutCardDeclined` and `.../CheckoutNoConnection`
(add `?bare=1` to hide the styleguide frame; on Dev the styleguide redirects to sign-up unless logged in).
What was built, what differs from the canvas and why: the HANDOFF "checkout redesign" in `docs/changelog.md` and "The checkout page" in `docs/tech-constraints.md`.
