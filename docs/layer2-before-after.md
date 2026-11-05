# Layer 2 consistency pass: before and after, by screen

Every change below is in a stylesheet. "Before" is the line on `main`, "after" the line on this branch. Pairings follow docs/brand.md; radii and greys now use the tokens in `src/styles/revieTokens.css`.

## Booking path: booking form and slot picker

**`components/OrderPanel/BookingFixedDurationForm/FieldDateAndTimeInput.module.css`**
- `color: var(--colorGrey300);` → `color: var(--colorTextDisabled);`

**`components/OrderPanel/BookingTimeForm/FieldDateAndTimeInput.module.css`**
- `color: var(--colorGrey300);` → `color: var(--colorTextDisabled);`

**`components/OrderPanel/NylasBookingForm/NylasBookingForm.module.css`**
- `color: var(--colorGrey500);` → `color: var(--colorTextMuted);`

**`components/OrderPanel/NylasBookingForm/NylasSlotPicker.module.css`**
- `(none)` → `color: var(--colorGrey900);`
- `color: var(--colorWhite);` → `color: var(--revieCream);`

## Date picker

**`components/DatePicker/DatePickers/DatePicker.module.css`**
- `border-radius: 0 0 6px 6px;` → `border-radius: 0 0 var(--borderRadius) var(--borderRadius);`
- `--datepickerFgColor: var(--colorGrey700);` → `--datepickerFgColor: var(--revieMaroon);`
- `--datepickerDisabledFgColor: var(--colorGrey300);` → `--datepickerDisabledFgColor: var(--colorTextMuted);`
- `--datepickerHeaderFgColor: var(--colorGrey700);` → `--datepickerHeaderFgColor: var(--revieMaroon);`
- `--datepickerHeaderFgColorDisabled: var(--colorGrey300);` → `--datepickerHeaderFgColorDisabled: var(--colorTextMuted);`
- `--datepickerSelectedFgColor: var(--colorWhite);` → `--datepickerSelectedFgColor: var(--revieMaroon);`
- `--datepickerSelectedBgColor: var(--colorSuccess);` → `--datepickerSelectedBgColor: var(--revieLavender);`
- `--datepickerSelectedBorder: solid 1px var(--colorSuccess);` → `--datepickerSelectedBorder: solid 1px var(--revieMaroon);`
- `--datepickerSelectedHoveredFgColor: var(--colorWhite);` → `--datepickerSelectedHoveredFgColor: var(--revieMaroon);`
- `--datepickerSelectedHoveredBgColor: var(--colorSuccess);` → `--datepickerSelectedHoveredBgColor: var(--revieLavenderDeep);`
- `color: var(--colorWhite);` → `color: var(--datepickerSelectedHoveredFgColor);`
- `background-color: #0000ff;` → `background-color: var(--datepickerSelectedHoveredBgColor);`
- `border-radius: 2px;` → `border-radius: var(--borderRadius);`
- `color: var(--datepickerFgColor);` → `color: var(--datepickerSelectedFgColor);`
- `color: var(--colorWhite);` → `color: var(--datepickerSelectedFgColor);`
- `color: var(--colorWhite);` → `color: var(--datepickerSelectedFgColor);`
- `color: var(--datepickerDisabledFgColor);` → `color: var(--datepickerSelectedFgColor);`
- `border-radius: 2px;` → `border-radius: var(--borderRadius);`

**`components/DatePicker/DatePickers/DateRangePicker.module.css`**
- `border-radius: 6px 6px 0 0;` → `border-radius: var(--borderRadius) var(--borderRadius) 0 0;`

**`components/DatePicker/DatePickers/SingleDatepicker.module.css`**
- `border-radius: 6px 6px 0 0;` → `border-radius: var(--borderRadius) var(--borderRadius) 0 0;`

**`components/DatePicker/FieldDateRangePicker/FieldDateRangePicker.module.css`**
- `color: var(--colorGrey500);` → `color: var(--colorTextDisabled);`

**`components/DatePicker/FieldSingleDatePicker/FieldSingleDatePicker.module.css`**
- `color: var(--colorGrey500);` → `color: var(--colorTextDisabled);`

## Coach: edit listing (including WeeklyCalendar availability)

**`containers/EditListingPage/EditListingWizard/EditListingAvailabilityPanel/EditListingAvailabilityPlanForm/AvailabilityPlanEntries.module.css`**
- `color: var(--colorGrey300);` → `color: var(--colorTextDisabled);`

**`containers/EditListingPage/EditListingWizard/EditListingAvailabilityPanel/WeeklyCalendar/WeeklyCalendar.module.css`**
- `background-color: #f3f3f3;` → `background-color: var(--colorGrey100);`
- `background-color: #f3f3f3;` → `background-color: var(--colorGrey100);`
- `color: var(--colorGrey300);` → `color: var(--colorTextMuted);`

**`containers/EditListingPage/EditListingWizard/EditListingDeliveryPanel/EditListingDeliveryForm.module.css`**
- `color: var(--colorGrey300);` → `color: var(--colorTextDisabled);`

**`containers/EditListingPage/EditListingWizard/EditListingFilesPanel/EditListingFilesForm.module.css`**
- `color: var(--colorGrey400);` → `color: var(--colorTextMuted);`

**`containers/EditListingPage/EditListingWizard/EditListingStylePanel/EditListingStyleForm.module.css`**
- `border-radius: 2px;` → `border-radius: var(--borderRadius);`
- `border-radius: 10px;` → `border-radius: var(--borderRadiusMedium);`
- `border-radius: 2px;` → `border-radius: var(--borderRadius);`
- `border-radius: 6px;` → `border-radius: var(--borderRadius);`

## Checkout

**`components/SavedCardDetails/SavedCardDetails.module.css`**
- `border-radius: 6px;` → `border-radius: var(--borderRadius);`
- `border: 1px solid #d8dce6;` → `border: 1px solid var(--colorGrey100);`
- `background-color: #fff;` → `background-color: var(--colorWhite);`
- `border: 1px solid #b8bfd1;` → `border: 1px solid var(--colorGrey300);`
- `border: 1px solid #d8dce6;` → `border: 1px solid var(--colorGrey100);`
- `border-radius: 6px 6px 0px 0px;` → `border-radius: var(--borderRadius) var(--borderRadius) 0 0;`
- `border-radius: 6px;` → `border-radius: var(--borderRadius);`
- `background-color: #f2f2f2;` → `background-color: var(--colorGrey100);`
- `background-color: #f2f2f2;` → `background-color: var(--colorGrey100);`

**`containers/CheckoutPage/CheckoutPage.module.css`**
- `border-radius: 2px 2px 0 0;` → `border-radius: var(--borderRadius) var(--borderRadius) 0 0;`
- `color: var(--colorGrey300);` → `color: var(--colorTextMuted);`
- `border-radius: 2px;` → `border-radius: var(--borderRadius);`

**`containers/CheckoutPage/StripePaymentForm/StripePaymentForm.module.css`**
- `color: var(--colorGrey300);` → `color: var(--colorTextMuted);`

## Transaction (order) page, including the session panel

**`containers/TransactionPage/ManageCalendarBooking/ManageCalendarBooking.module.css`**
- `border-radius: 8px;` → `border-radius: var(--borderRadius);`
- `(none)` → `/* Maroon on cream is an approved pairing (15.6:1). The stock error red is 4.1:1 on cream, below AA,`
- `(none)` → `and no red is in the brand palette, so the message is carried by weight instead of colour. */`
- `color: var(--colorFail);` → `color: var(--revieMaroon);`
- `(none)` → `font-weight: var(--fontWeightBold);`
- `color: var(--colorFail);` → `color: var(--revieMaroon);`
- `(none)` → `text-decoration: underline;`

**`containers/TransactionPage/Message/Message.module.css`**
- `border-radius: 8px;` → `border-radius: var(--borderRadius);`
- `color: var(--colorWhite);` → `color: var(--revieCream);`
- `color: var(--colorWhite);` → `color: var(--revieCream);`
- `background-color: var(--colorGrey600);` → `background-color: var(--colorGrey700);`
- `color: var(--colorGrey500);` → `color: var(--colorTextMuted);`
- `color: var(--colorWhite);` → `color: var(--revieCream);`

**`containers/TransactionPage/TransactionPanel/TransactionPanel.module.css`**
- `border-radius: 2px 2px 0 0;` → `border-radius: var(--borderRadius) var(--borderRadius) 0 0;`
- `border-radius: 2px;` → `border-radius: var(--borderRadius);`

## Buttons

**`components/Button/Button.module.css`**
- `(none)` → `/* Disabled: the template's white label on grey 100 is 1.3:1. Grey 700 on grey 100 reads as`
- `(none)` → `unavailable while staying legible. (The in-progress and ready states below keep their own`
- `(none)` → `ground, which is more specific.) */`
- `(none)` → `&:disabled {`
- `(none)` → `background-color: var(--colorGrey100);`
- `(none)` → `color: var(--colorGrey700);`
- `(none)` → `}`
- `(none)` → `/* Disabled: the template's white label on grey 100 is 1.3:1. Grey 700 on grey 100 reads as`
- `(none)` → `unavailable while staying legible. (The in-progress and ready states below keep their own`
- `(none)` → `ground, which is more specific.) */`
- `(none)` → `&:disabled {`
- `(none)` → `background-color: var(--colorGrey100);`
- `(none)` → `color: var(--colorGrey700);`
- `(none)` → `}`
- `border: 1px solid #d2d2d2;` → `border: 1px solid var(--colorGrey200);`

**`components/Button/ButtonExample.module.css`**
- `(none)` → `color: var(--revieMaroon);`
- `border-radius: 8px;` → `border-radius: var(--borderRadius);`
- `stroke: #fff;` → `stroke: var(--colorWhite);`

## Brand tokens (revieTokens.css)

**`styles/revieTokens.css`**
- `(none)` → `/**`
- `(none)` → `* Text on the cream and white surfaces. Grey 300/400/500 are 1.8 / 2.4 / 3.4 : 1 on cream,`
- `(none)` → `* so they are fine for borders and fills but not for reading. Grey 600 is the lightest grey that`
- `(none)` → `* clears AA (4.9 : 1 on cream, 5.7 : 1 on white). Disabled controls are exempt from AA, so they`
- `(none)` → `* take grey 500, still distinguishable from live text.`
- `(none)` → `*/`
- `(none)` → `--colorTextMuted: var(--colorGrey600);`
- `(none)` → `--colorTextDisabled: var(--colorGrey500);`
- `--datepickerDisabledFgColor: rgba(239, 238, 237, 0.35);` → `--datepickerDisabledFgColor: rgba(239, 238, 237, 0.55);`
- `--datepickerHeaderFgColorDisabled: rgba(239, 238, 237, 0.35);` → `--datepickerHeaderFgColorDisabled: rgba(239, 238, 237, 0.55);`
- `- Audit components for hardcoded hex, px radii and font-family` → `- (Done Nov 2026, "Layer 2") Hardcoded hex, px radii and text/background`
- `declarations. Unknown how many exist; they'd override these tokens.` → `pairings in components now use these tokens; repeat the audit with`
- `- --colorSuccess / --colorFail / --colorAttention are left at stock` → `scripts/audit-css.js. Left on purpose: the vendored react-image-gallery`
- `values deliberately. They carry meaning rather than brand, and` → `stylesheets and sanitize.css, calc()-based pill radii, and the monospace`
- `(none)` → `stack of the code block.`
- `(none)` → `- --colorSuccess / --colorFail / --colorAttention / --colorStatusActionNeeded`
- `(none)` → `are left at stock values deliberately (and fail AA as text on cream: error`
- `(none)` → `red 4.1:1, success green 4.3:1, action-needed 4.2:1; see docs/brand.md,`
- `(none)` → `"Semantic colours"). They carry meaning rather than brand, and`

## Content pages (PageBuilder)

**`containers/PageBuilder/BlockBuilder/BlockDefault/BlockDefault.module.css`**
- `border-radius: 8px;` → `border-radius: var(--borderRadius);`

**`containers/PageBuilder/BlockBuilder/BlockFooter/BlockFooter.module.css`**
- `border-radius: 8px;` → `border-radius: var(--borderRadius);`

**`containers/PageBuilder/BlockBuilder/BlockSocialMediaLink/BlockSocialMediaLink.module.css`**
- `border-radius: 8px;` → `border-radius: var(--borderRadius);`

**`containers/PageBuilder/Primitives/Image/Image.module.css`**
- `border-radius: 8px;` → `border-radius: var(--borderRadius);`
- `border-radius: 8px;` → `border-radius: var(--borderRadius);`

**`containers/PageBuilder/Primitives/SearchCTA/FilterCategories/FilterCategories.module.css`**
- `border-radius: 4px;` → `border-radius: var(--borderRadius);`

**`containers/PageBuilder/Primitives/SearchCTA/SearchCTA.module.css`**
- `color: var(--colorGrey300);` → `color: var(--colorTextMuted);`
- `color: var(--colorGrey500);` → `color: var(--colorTextMuted);`
- `border-radius: 8px;` → `border-radius: var(--borderRadius);`

**`containers/PageBuilder/Primitives/YoutubeEmbed/YoutubeEmbed.module.css`**
- `border-radius: 8px;` → `border-radius: var(--borderRadius);`

**`containers/PageBuilder/SectionBuilder/SectionBuilder.module.css`**
- `border-radius: 4px;` → `border-radius: var(--borderRadius);`

**`containers/PageBuilder/SectionBuilder/SectionListings/SectionListings.module.css`**
- `border-radius: 20px;` → `border-radius: var(--borderRadiusLarge);`

## Forms

**`components/FieldNumber/FieldNumber.module.css`**
- `stroke: #b8bfd1;` → `stroke: var(--colorGrey300);`
- `stroke: #b8bfd1;` → `stroke: var(--colorGrey300);`
- `stroke: #b8bfd1;` → `stroke: var(--colorGrey300);`
- `stroke: #d8dce6;` → `stroke: var(--colorGrey100);`
- `stroke: #d8dce6;` → `stroke: var(--colorGrey100);`

**`components/FileUpload/FileUpload.module.css`**
- `border-radius: 4px;` → `border-radius: var(--borderRadius);`
- `color: var(--colorGrey500);` → `color: var(--colorTextMuted);`

## Inbox

**`containers/InboxPage/InboxPage.module.css`**
- `color: var(--colorGrey300);` → `color: var(--colorTextMuted);`
- `color: var(--colorGrey300);` → `color: var(--colorTextDisabled);`
- `color: var(--colorGrey300);` → `color: var(--colorTextMuted);`

**`containers/InboxPage/InboxSearchForm/InboxSortBy.module.css`**
- `color: var(--colorGrey300);` → `color: var(--colorTextDisabled);`

## Limited-access banner

**`components/LimitedAccessBanner/LimitedAccessBanner.module.css`**
- `background-color: #df492a;` → `background-color: var(--revieMaroon);`
- `color: #fff;` → `color: var(--revieCream);`
- `background: #2a3d4b;` → `background: var(--revieLavender);`
- `color: #fff;` → `color: var(--revieMaroon);`
- `background: #364f61;` → `background: var(--reviePink);`

## Listing / coach page

**`containers/ListingPage/ListingImageGallery/ListingImageGallery.module.css`**
- `border-radius: 8px;` → `border-radius: var(--borderRadius);`

**`containers/ListingPage/ListingPage.module.css`**
- `color: var(--colorGrey100);` → `color: var(--revieCream);`
- `background-color: var(--colorGrey700);` → `background-color: var(--revieMaroon);`
- `color: var(--colorAttention);` → `color: var(--revieOrange);`
- `color: var(--colorGrey100);` → `color: var(--revieCream);`
- `color: var(--colorWhite);` → `color: var(--revieLavender);`
- `color: var(--colorAttention);` → `color: var(--revieOrange);`
- `background-color: #eee;` → `background-color: var(--colorGrey100);`
- `border-radius: 8px;` → `border-radius: var(--borderRadius);`

## Manage listings

**`containers/ManageListingsPage/ManageListingCard/CardMenu.module.css`**
- `border-top-left-radius: 4px;` → `border-top-left-radius: var(--borderRadius);`
- `border-top-right-radius: 4px;` → `border-top-right-radius: var(--borderRadius);`
- `background-color: rgba(0, 0, 0, 0.7);` → `background-color: rgba(49, 4, 22, 0.7);`
- `background-color: rgba(0, 0, 0, 0.7);` → `background-color: rgba(49, 4, 22, 0.7);`
- `background-color: var(--colorGrey700);` → `background-color: var(--revieMaroon);`
- `color: var(--colorWhite);` → `color: var(--revieCream);`

## Not-found page

**`containers/NotFoundPage/SearchForm/SearchForm.module.css`**
- `border-radius: 2px;` → `border-radius: var(--borderRadius);`

## Other components

**`components/CustomExtendedDataSection/CustomExtendedDataSection.module.css`**
- `border-radius: 8px;` → `border-radius: var(--borderRadius);`

**`components/ListingCardThumbnail/ListingCardThumbnail.module.css`**
- `border-radius: 4px;` → `border-radius: var(--borderRadius);`

**`components/LocationAutocompleteInput/LocationAutocompleteInput.module.css`**
- `border-top-right-radius: 20px;` → `border-top-right-radius: var(--borderRadiusLarge);`
- `border-bottom-right-radius: 20px;` → `border-bottom-right-radius: var(--borderRadiusLarge);`

**`components/MenuContent/MenuContent.module.css`**
- `border-radius: 0 0 2px 2px;` → `border-radius: 0 0 var(--borderRadius) var(--borderRadius);`

**`components/NotificationBadge/NotificationBadge.module.css`**
- `border-radius: 10px;` → `border-radius: var(--borderRadiusPill);`
- `border-radius: 12px;` → `border-radius: var(--borderRadiusPill);`

**`components/RangeSlider/Track.module.css`**
- `border-radius: 4px;` → `border-radius: var(--borderRadius);`

**`components/TabNav/TabNav.module.css`**
- `color: var(--colorGrey300);` → `color: var(--colorTextDisabled);`

**`components/TabNavHorizontal/TabNavHorizontal.module.css`**
- `color: var(--colorGrey300);` → `color: var(--colorTextDisabled);`

## Payment methods

**`containers/PaymentMethodsPage/PaymentMethodsForm/PaymentMethodsForm.module.css`**
- `color: var(--colorGrey300);` → `color: var(--colorTextMuted);`
- `color: var(--colorGrey300);` → `color: var(--colorTextMuted);`
- `color: var(--colorGrey300);` → `color: var(--colorTextMuted);`

## Profile page

**`containers/ProfilePage/ProfilePage.module.css`**
- `border-radius: 8px;` → `border-radius: var(--borderRadius);`

## Profile settings

**`containers/ProfileSettingsPage/ProfileSettingsForm/ProfileSettingsForm.module.css`**
- `border-radius: 2px;` → `border-radius: var(--borderRadius);`

## Request-quote / make-offer pages

**`containers/MakeOfferPage/DetailsSideCard/DetailsSideCard.module.css`**
- `border-radius: 2px;` → `border-radius: var(--borderRadius);`
- `border-radius: 2px 2px 0 0;` → `border-radius: var(--borderRadius) var(--borderRadius) 0 0;`

**`containers/MakeOfferPage/MobileListingImage/MobileListingImage.module.css`**
- `border-radius: 2px 2px 0 0;` → `border-radius: var(--borderRadius) var(--borderRadius) 0 0;`

**`containers/RequestQuotePage/DetailsSideCard/DetailsSideCard.module.css`**
- `border-radius: 2px;` → `border-radius: var(--borderRadius);`
- `border-radius: 2px 2px 0 0;` → `border-radius: var(--borderRadius) var(--borderRadius) 0 0;`

**`containers/RequestQuotePage/MobileListingImage/MobileListingImage.module.css`**
- `border-radius: 2px 2px 0 0;` → `border-radius: var(--borderRadius) var(--borderRadius) 0 0;`

## Search

**`containers/SearchPage/PopupOpenerButton/PopupOpenerButton.module.css`**
- `background-color: var(--colorWhite);` → `background-color: var(--revieCream);`
- `color: var(--colorWhite);` → `color: var(--revieCream);`
- `color: var(--colorWhite);` → `color: var(--colorGrey700);`

**`containers/SearchPage/SearchFiltersMobile/SearchFiltersMobile.module.css`**
- `border-radius: 3px;` → `border-radius: var(--borderRadius);`
- `border-radius: 3px;` → `border-radius: var(--borderRadius);`

**`containers/SearchPage/SearchMapGroupLabel/SearchMapGroupLabel.module.css`**
- `border-radius: 19px;` → `border-radius: var(--borderRadiusLarge);`

**`containers/SearchPage/SortBy/SortByPlain.module.css`**
- `color: var(--colorGrey300);` → `color: var(--colorTextDisabled);`

**`containers/SearchPage/SortBy/SortByPopup.module.css`**
- `color: var(--colorGrey300);` → `color: var(--colorTextDisabled);`
- `color: var(--colorGrey300);` → `color: var(--colorTextMuted);`

## Sign up / log in

**`containers/AuthenticationPage/SocialLoginButtons/SocialLoginButtons.module.css`**
- `border-bottom: solid 1px #d2d2d2;` → `border-bottom: solid 1px var(--colorGrey200);`

## Styleguide (dev tool)

**`containers/StyleguidePage/StyleguidePage.module.css`**
- `border-color: #aaa;` → `border-color: var(--colorGrey300);`
- `background-color: #f1f1f1;` → `background-color: var(--colorGrey100);`
- `border-color: #aaa;` → `border-color: var(--colorGrey300);`
- `background-color: #fff;` → `background-color: var(--colorWhite);`

## Topbar

**`containers/TopbarContainer/Topbar/Topbar.module.css`**
- `color: var(--colorWhite);` → `color: var(--revieCream);`

**`containers/TopbarContainer/Topbar/TopbarDesktop/CustomLinksMenu/PriorityLinks.module.css`**
- `color: var(--colorWhite);` → `color: var(--revieCream);`

**`containers/TopbarContainer/Topbar/TopbarDesktop/TopbarDesktop.module.css`**
- `color: var(--colorWhite);` → `color: var(--revieCream);`

## Round 2 (visual check on Render)

- **Logo on light grounds.** `Logo` takes `tone="onLight"` and then uses the maroon desktop wordmark (`src/assets/revie-logo-desktop.png`) instead of the branded cream one. Used by `TopbarSimplified` (checkout, make-offer and request-quote header) and by the footer, which switches back to cream if Console gives it a dark background colour. The maroon topbar still uses the cream wordmark; the mobile mark (lavender R on maroon) reads on any ground and is unchanged.
- **Hero search button.** `.submitButton` in `SearchCTA.module.css`: 48px tall with 20px of padding around a 24px line (64px of content in a 48px box, so the label sat low) is now 40px, the same as the fields, with the label centred by flex.
- **Topbar search.** One cream pill (maroon text on off-white) with the icon inside; the divider line and the separate white icon box are gone, with a lavender focus ring. `TopbarDesktop.module.css` (`.searchLink`, new `.searchLink .topbarSearchWithLeftPadding`) and `TopbarSearchForm.module.css` (`.desktopIcon`, `.desktopInput`).
- **Checkout "I authorise revie_dev".** The name comes from `REACT_APP_MARKETPLACE_NAME` (`config.marketplaceName`), which `render.yaml` set to the environment name `revie_dev`. Now `Revie`. A Render change, not Console or Stripe.

## Round 3: semantic colours (decision of Nov 4)

One token change in `src/styles/revieTokens.css` (new "Semantic colours" block):
- `--colorFail` `#E7000B` → `var(--revieError)` = `#B8000A` (4.12 → 5.96 : 1 on cream); `--colorFailDark` `#CC0000` → `#8F0008` (hover on filled error buttons).
- `--colorSuccess` `#138041` → `var(--revieGreen)` Forest (4.32 → 13.75 : 1). `--colorSuccessDark` follows.
- `--colorAttention` `#FFAA00` → `var(--revieOrange)`; `--colorAttentionDark` `#B25900` → maroon.

Because a warning is an orange tag with a maroon label (never orange text), three places changed in component CSS:
- Inbox `.stateActionNeeded`: was `#B25900` text (4.19 : 1), now a tag.
- Listing page `.ownListingTextPendingApproval` and `.missingPayoutDetailsText`: were amber / orange text, now tags.
- Session panel `.error` goes back to the error token (it had been maroon while no compliant red existed). Inbox `.lastTransitionedAtNotEmphasized` is muted text, not disabled.

`node scripts/audit-css.js --list --loose` afterwards: 0 unapproved explicit pairs, and nothing red, green or amber is left in the below-AA list. What remains there is disabled controls (exempt), light text meant for dark grounds, and the vendored image-gallery hover colour.

## Round 4: inbox (notifications, review wording, spelling)

- **Notifications are pink, not red.** `--revieError` is for errors only. The inbox count badge (`NotificationBadge`), the desktop topbar dot, the mobile topbar dot and the row dot in the inbox are now pink (`--reviePink`); the badge number is maroon (8.64:1) and the dots get a maroon ring or border so they hold on light rows and on the maroon bar.
- **Review states by role** (`InboxPage.stateDataBooking.js`): the client's "Leave a review" is the orange tag (it needs them); the coach's "Waiting for the client's review" is plain muted text (`.stateWaiting`). The same applies after one side has reviewed. A confirmed ("Booked") session is no longer tagged as a warning.
- **Topbar search focus.** The template gives every input `background-color: #fff`, a blue border and glow on `:focus`, animated by `transition: all`, which turned the field white inside the cream pill. The input is now transparent in default, hover, focus, active and filled states, and autofill is painted cream with maroon text; only the pill's lavender ring shows.
- **"Cancelled" spelling** in `en.json` for the inbox status, activity feed and both order-page titles.
