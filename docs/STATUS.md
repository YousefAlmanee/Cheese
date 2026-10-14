# Build status

Everything in Version 1 of [SPEC.md](SPEC.md) is built. This file says what was checked, what could not be, and what is left.

## Checked

| What | How |
|---|---|
| Rules and database behaviour | 237 unit tests against a real PostgreSQL: progress, free time (including daylight saving), suggestions, taste match, friends and privacy, groups, nights, votes, RSVPs, reminders, calendar feed |
| Whole screens | Browser tests on a phone-sized screen: add, library, item, home, fit, pick, plan, friends, nights. Several tests use three or four separate signed-in people at once |
| Accessibility | The axe checker (WCAG 2 A and AA) finds nothing on 24 screens, in light and dark. This includes colour contrast |
| Privacy | Tests that hidden items never reach friends or groups, that strangers and non-members get a "not found" page, and that every action refuses entries that belong to someone else |
| Production build | `next build` succeeds |

## Not checked against the real service

This project was built in an environment that could not reach the outside world, so these were tested against sample responses written from each service's documentation, not against the live services:

- **TMDB, AniList, Open Library, Google Books, IGDB.** The code and its error handling are tested, but the first real search is the real test. If a result looks wrong (a missing cover, a wrong episode count), the fix is in `src/lib/providers/`.
- **Google sign-in and Google Calendar.** The token refresh, revoked access and outage handling are tested with a pretend Google. The consent screens and the "connect calendar later" step have not been run. If connecting the calendar fails, check the redirect URI and scope in SETUP.md step 3 first.
- **Push notifications to a real phone.** The sending, the schedule, the cleanup of dead devices and the secret on the cron address are tested. Delivery to a device and the permission prompt are not.
- **Hosting on Netlify.** The configuration is written but nothing has been deployed.

## Left for Version 2

Streaks, weekly recap, stats and year in review, estimated finish dates, spoiler-safe shared progress, activity feed and reactions, recommending an item to a friend, new-episode alerts, rewatch logs, data export, writing group sessions into Google Calendar (today they appear in the calendar link), and importing from other apps.

- **Swipe to pick as a group.** Friends shows "Swipe to pick together" for a group with things in common. The deck is the group's common list. Each member answers yes or no on their own time (drag the card, use the arrow keys, or tap a button; answers are saved one card at a time). Results list what got a yes, everyone-said-yes first, with a "Plan" link into the night form. Names are shown only for yes, never for no. When the last yes makes an item unanimous the others are notified once. "Start over" clears only your own answers. New table `group_swipe`.

## Known limits

- No rate limiting. Fine for a group of friends, worth adding before opening it to the public.
- No sign-in by email. Google only (email and password exists for local development and is switched off in production).
- No way to delete an account from the app yet.
- A friend's invite link works until you stop using it, there is no "make a new invite link" button yet.
- Taste match is a simple measure: how much two wish lists overlap, blended with how alike two people rate the same things. It shows "Not enough to compare yet" when there is no data, and does not guess.
- Book length is estimated at 90 seconds a page and manga at 8 minutes a chapter when a source gives no timing. Anywhere an estimate is shown, it says "about".
