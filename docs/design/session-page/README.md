# Session page design (approved Nov 16, 2026)

Copy of the canvas **"Revie session page — desktop & phone"** (https://claude.ai/artifact/4sDdmhbtG89bb6za2W6jEc),
saved so the build and later jobs have it in the repo. Open any `.dc.html` file to read the markup;
the values (colours, sizes, spacing, radii, weights) in the inline styles are the spec.

| File | What it is | Built in |
|---|---|---|
| `project/Main.dc.html` | Desktop, signed in (topbar, hero, sections, booking panel) | Job A (everything left of the panel); the panel is job B (done) |
| `project/HeaderLoggedOut.dc.html` | Signed-out header | Job A |
| `project/Phone.dc.html` | Phone, signed in, with the bottom "See times" bar | Job A (page); the bar is job B (done) |
| `project/Reviews.dc.html` | Desktop once the session has reviews | Job A |
| `project/PhoneSheet.dc.html` | Phone, after tapping "See times" | Job B (done) |
| `project/States.dc.html` | Booking panel when a coach can't be booked yet (client view and coach view) | Job B (done) |
| `project/canvas.json` | Where each board sits on the canvas, and the canvas notes | |

Notes for reading the files:
- Coach, copy and prices in them are made up. Real data replaces them.
- `/_blob/...` image and font URLs do not load outside the canvas. The repo's own fonts
  (`src/assets/fonts/`, loaded by `src/styles/revieTokens.css`) and icons (`src/assets/icons/`) are used.
- The files use the canvas's own `<x-dc>` / `<sc-if>` / `{{hole}}` syntax, not React.
- Where the build departs from them, and why, is listed in the HANDOFF of 2026-11-25 ("session page, job A") and 2026-11-26 ("job B") in `docs/changelog.md`.

`hero-photo-and-initials-desktop.png` is a styleguide screenshot of the built hero with a coach photo (a drawn portrait, not a real person) and with initials.

Where the built version lives: `src/containers/ListingPage/SessionPage/` (try it without an account at
`/styleguide/c/SessionPage/FullPage` and `/styleguide/c/SessionPage/FullPageWithReviews`; on Dev the
styleguide needs the auth lines removed locally, see `docs/tech-constraints.md`, "Checking screens visually").
