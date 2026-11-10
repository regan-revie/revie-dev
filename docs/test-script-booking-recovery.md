# Test script: booking recovery on revie-dev.onrender.com

Checks that a paid booking either lands on the coach's calendar or is declined with the client's card released, and that a coach is never shown a booking to accept. Dev only. Do not run this against Live.

## Before you start (once)

1. **The listing must be on release-2.** New transactions use the listing's own process, not the listing type's. Check with:
   `op run --env-file=.env -- node scripts/dev-listing-test-helper.js status --listing 6aa17447-bd2d-4465-9a24-38498e5daa62`
   It must say `transactionProcessAlias: default-booking/release-2`. If it says release-1, run the same command with `use-release-2 --yes` instead of `status`.
2. **Open these in separate tabs:** the coach's Google Calendar; Stripe (the "Revie Marketplace A" sandbox, test mode) on the Payments page; Sentry's Issues page; Render's logs for `revie-dev`.
3. **Log in on revie-dev as a client**, not the coach (a coach can't book their own session).
4. **Card:** `4242 4242 4242 4242`, any future expiry, any CVC, any postcode.
5. **Pick a time more than 24 hours away** each run (the notice period hides anything sooner). Use a different slot each time.

Each run: **Test Session** listing, then choose a time, **Request to book**, then pay on the checkout page.

---

## 1. Happy path

**Do:** book and pay as above. Don't touch anything else.

| Who | What you should see |
|---|---|
| **Client** | Lands on the order page showing **"Confirming your session…"**. Within about 5 to 15 seconds, with no reload, it changes to **"Your booking request was accepted!"**. |
| **Coach** | The session appears in their Google Calendar at that time. In the Sharetribe inbox there is **no** notification dot and **no** Accept / Decline buttons on the booking. |
| **Stripe** | The payment appears as **Uncaptured** straight after paying, then becomes **Succeeded** within seconds. |
| **Sentry** | Nothing new. |
| **Render logs** | No errors. |

**Pass if** all of the above. (The emails use the old stock wording for now: the client gets "Your booking request was accepted"; the coach gets "A booking request was accepted on your behalf" with no body text. That is a known separate fix, not part of this test.)

## 2. The browser never reports (tests the sweeper)

This is what happens if the client closes the tab at the wrong moment. Closing a tab is too hard to time, so block the request instead.

**Set up:** in Chrome, open DevTools, go to **Network**, then **Network request blocking** (the three-dot menu, "More tools"), turn it on and add the pattern `*create-booking*`. Keep DevTools open.

**Do:** book and pay as above. You can close the tab afterwards if you like.

| Who | What you should see |
|---|---|
| **Client** | Order page stays on **"Confirming your session…"**. After roughly **3 to 5 minutes** it changes to accepted (if you closed the tab, reopen the order from the inbox). |
| **Coach** | Nothing for the first 3 minutes or so, then the calendar event appears. |
| **Stripe** | **Uncaptured** for those 3 to 5 minutes, then **Succeeded**. |
| **Render logs** | A line like `[jobs] booking sweep {"checked":1,"outcomes":{"booked":1}}`. |
| **Sentry** | Nothing new. |

**Undo:** remove the blocking pattern in DevTools.

**Pass if** it confirms on its own within about 5 minutes. It will not be instant: the sweeper only acts on bookings older than 3 minutes and runs once a minute.

## 3. A slot that gets taken

**Do:**
1. As the client, pick a time and go to the checkout page. **Stop before paying.**
2. In the coach's Google Calendar, create an event that covers that exact time (any title). Wait about 30 seconds.
3. Back on the checkout page, pay.

| Who | What you should see |
|---|---|
| **Client** | **"Confirming your session…"**, then after about **10 to 15 seconds**: **"That one didn't go through. You haven't been charged."** Email: "We couldn't lock in your session. You haven't been charged." |
| **Coach** | Nothing: no email, no inbox badge, no Accept button. The only thing on their calendar is the event you made. |
| **Stripe** | **Uncaptured**, then **Canceled** within about 15 seconds. It must **never** show Succeeded. |
| **Sentry** | A **new issue** with the tag `code: nylas-booking-failed-declined` and `lastStatus` set to the Nylas error code. You should get an email about it. |
| **Render logs** | The error is printed with that code. |

**Undo:** delete your calendar event.

**Pass if** the client is told it failed, Stripe shows Canceled, and the coach sees nothing.

**If Nylas lets the booking through** over your busy event (the session simply books), that is a different finding: tell me, don't count it as a pass or a fail here.

## 4. A forced failure

A safe way to make every booking fail, for one listing only.

**Do:**
1. As the client, pick a time and go to the checkout page. **Stop before paying.** (Slots won't load while the listing is broken, so choose the time first.)
2. In your terminal, break the listing:
   `op run --env-file=.env -- node scripts/dev-listing-test-helper.js break --listing 6aa17447-bd2d-4465-9a24-38498e5daa62 --yes`
3. Pay on the checkout page.
4. **Restore it straight afterwards, whatever happened:**
   `op run --env-file=.env -- node scripts/dev-listing-test-helper.js restore --listing 6aa17447-bd2d-4465-9a24-38498e5daa62 --yes`
   then run `status`; it must say `nylasConfiguration: set (real)`.

| Who | What you should see |
|---|---|
| **Client** | Same as scenario 3: **"Confirming…"**, then **"That one didn't go through. You haven't been charged."** after about 10 to 15 seconds. |
| **Coach** | Nothing. |
| **Stripe** | **Uncaptured**, then **Canceled**. Never Succeeded. |
| **Sentry** | A **new issue** reading **"Nylas POST /v3/scheduling/sessions failed with status 404"**, tag `code: nylas-booking-failed-declined`, `lastStatus: 404`, `attempts: 1`. It is a different message from scenario 3, so it is a separate issue and should email you again. |

**Pass if** as scenario 3, and the listing is restored afterwards.

**What this does not test:** the retry. A 404 is treated as permanent and not retried, so there is one attempt, not two. The retry is covered by the automated tests only.

**If you forget to restore:** nobody can see available times on that listing until you do. The original id is saved in your temporary folder and `restore` reads it from there.

---

## Scenario 5: the wording, the invite and the session panel (added Oct 28)

**Before you start:** the PR is deployed to Render, `BOOKING_PROCESS_ALIAS` is on the service, and you have changed the Console marketplace texts in Test and copied them to Dev (the list is in the HANDOFF of Oct 28). Book on **revie-dev.onrender.com**, not localhost: the instant path and cancelling need Render's database.

**Do:**
1. Book a session more than 48 hours out. Look at the button, the checkout heading and the confirmed page.
2. Open the Google Calendar invite.
3. Open the order page, cancel, and watch the panel. Then reload the page.
4. Book another session less than 48 hours out and cancel that one.

| Where | What you should see |
|---|---|
| Booking button / checkout | **"Book a session"** and a heading with no "request" in it |
| Confirmed page | **"You're booked."** |
| Calendar event | Titled **"{session} with {coach}"**; description names the client and links to **that session's order page**; a **Google Meet** link; **no** Nylas cancel or reschedule link |
| Cancel (over 48 hours) | Asks first: **"Cancel this session? You'll get a full refund."**; afterwards **"Session cancelled. Your refund is on its way."**; Reschedule and Cancel gone, and still gone after a reload; Stripe shows a refund |
| Cancel (inside 48 hours) | Asks first, saying you will still be charged; afterwards says you have been charged; no refund in Stripe |
| Session length | If the listing has two lengths, switching the length changes the times offered (and they start on the hour and half hour) |

**Watch for:** the booking failing outright because Meet could not be created. If it does, the payment is released like any failed booking, and the Sentry issue will say why.

---

## Scenario 6: cancellation emails (added Oct 28, release-3)

**Before you start:** release-3 is on Dev, the Dev Test Session listing is on it, and the nine keys in `email-texts-release-3-paste-into-dev.json` are in Dev's Email texts. Use a client account and a coach account whose inboxes you can open, and test on **revie-dev.onrender.com**.

**Do:**
1. As the client, book a session **more than 48 hours** ahead.
2. On the order page, cancel it and confirm.
3. Open both inboxes (client and coach). Wait a minute.

| Who | What you should see |
|---|---|
| **Client inbox** | **Exactly one** cancellation email from Sharetribe: subject "Your session is cancelled.", saying the refund is on its way. No date in it. |
| **Coach inbox** | **Exactly one** email: "A session was cancelled." |
| **Nylas** | **Nothing** from Nylas for either person, no "booking cancelled" email. (Google Calendar may still send its own calendar notice; that is separate.) |
| **Stripe** | A refund, as in the cancel check above. |

Also book a second session and look at the **coach's "You've got a session"** email from the booking: it should now have a sentence naming the client and the time.

**Not covered here:** a cancellation **inside 48 hours** by the client (scenario 7, release-4) and a cancellation by the coach (scenario 8).

---

## Scenario 7: a late cancellation by the client (added Nov 5, release-4)

**Before you start:** release-4 is on Dev and Test, the Dev Test Session listing is on it (`node scripts/dev-listing-test-helper.js status --listing <id>` shows `default-booking/release-4`), the nine keys in `docs/email-texts-release-4-paste-into-dev.json` are in Dev's Email texts, and the new code is deployed to Render. Use a client and a coach whose inboxes you can open, on **revie-dev.onrender.com**. Book a session that starts **less than 48 hours** from now (the booking notice must allow it; lower the listing's notice for the test if needed).

**Do:**
1. As the client, book it and wait until the order page says "You're booked."
2. On the order page, cancel it and confirm (the confirmation says you will still be charged).
3. Wait about 10 seconds, then look at both order pages and both inboxes.

| Where | What you should see |
|---|---|
| **Client order page** | Heading "Session cancelled." with "It was less than 48 hours away, so you've still been charged for it." No review button. |
| **Coach sale page** | Heading "{client} cancelled late. You'll still be paid." |
| **Inbox** | Both sides: "Cancelled, charged" (client) / "Cancelled late, you'll be paid" (coach). Not "Booked", not "Leave a review"; the topbar dot does not light. |
| **Client inbox (email)** | **One** email, "Your session is cancelled.", saying they are still charged. |
| **Coach inbox (email)** | **One** email, "{client} cancelled late. You'll still be paid." |
| **Console** | The transaction is in state **late-cancelled** (last transition `transition/late-cancel`), metadata `lateCancelledAt` and `cancelledBy: client`. |
| **Stripe** | The charge stays; **no refund**. |
| **Calendar** | The event is gone from the coach's calendar. |
| **Later (booking end + 2 days)** | The transaction moves to `late-cancelled-completed`, the coach gets the "You have been paid" email, and **neither side gets a review email**. The payout transition is time-triggered only, so this part cannot be rushed from the app; Console shows it scheduled. |

**Older transactions (release-3):** a late cancel on one of those leaves it `accepted` with the same metadata, and the pages above still read correctly; the review emails are the one thing that still go out.

---

## Scenario 8: the coach cancels from their calendar, at any time (added Nov 5)

**Before you start:** as scenario 7. Book two sessions as the client: one **more than 48 hours** ahead, one **less than 48 hours** ahead.

**Do:** for each, delete the event from the coach's Google Calendar (not from Revie). Wait about 10 seconds.

| Where | What you should see |
|---|---|
| **Console** | State **cancelled** (last transition `transition/cancel`), metadata `cancelledBy: provider`, and **no** `lateCancelledAt`, for both sessions. |
| **Stripe** | A **full refund** for both, including the one inside 48 hours. |
| **Client** | The cancellation email with the refund, "Your session is cancelled." Order page heading "Session cancelled." |
| **Coach** | "{listing} with {client} is cancelled, and it's off your calendar." (It does not say the client cancelled.) |
| **Order page** | No "charged" wording anywhere. |

---

## Afterwards

- Cancel any accepted test bookings from the order page ("Your session" panel) so the calendar is clear. A cancellation more than 48 hours ahead should also refund in Stripe, which tests that path too.
- Sentry only emails on **new** issues. Repeating a scenario groups into the same issue and won't email again; that is expected.
- Write down anything that differed from the tables above. Those are the findings.
