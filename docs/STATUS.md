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

Streaks, stats and year in review, estimated finish dates, spoiler-safe shared progress, activity feed and reactions, new-episode alerts, rewatch logs, writing group sessions into Google Calendar (today they appear in the calendar link), and importing from apps other than Letterboxd.

- **Data export.** Settings has a "Your data" section: everything as JSON, and the library as CSV. It holds the person's own list (hidden items too), ratings, time log, planned sessions and free time. It leaves out the calendar link, invite code, push devices and anything about other people. Spreadsheet formulas in titles are defused in the CSV.

- **Weekly streak with freezes.** Home shows "N-week streak" once there is one. A week (Monday to Sunday, the person's timezone) counts if they logged time or finished a title. The week in progress never breaks the streak. Every 4 counted weeks in a row earns a freeze (up to 2); a missed week spends one and keeps the streak without adding to it. Worked out from existing history, no new tables.

- **Recommend to a friend.** An item has "Recommend to a friend": tick friends, add a note of up to 200 characters. They get a notification and a "Recommended to you" list on Friends with Add and Dismiss. Only friends, only your own items that are not hidden, once per item per friend (even after they dismiss it). Friends who already have it are not offered it. New table `recommendation`.

- **Swipe to pick as a group.** Friends shows "Swipe to pick together" for a group with things in common. The deck is the group's common list. Each member answers yes or no on their own time (drag the card, use the arrow keys, or tap a button; answers are saved one card at a time). Results list what got a yes, everyone-said-yes first, with a "Plan" link into the night form. Names are shown only for yes, never for no. When the last yes makes an item unanimous the others are notified once. "Start over" clears only your own answers. New table `group_swipe`.

## Added since Version 1

- **Weekly recap.** On Sunday from 18:00 (the person's own timezone), anyone with activity that week gets one "Your week" notification: time logged, titles finished and planned sessions kept. It appears in the app's notifications and, where reminders are on, as a push. It runs inside the existing reminder job, is sent at most once a week per person, and can be turned off in Settings. The same numbers are on the `/recap` screen. Tested with sample data only, like the other pushes.

## Known limits

- No rate limiting. Fine for a group of friends, worth adding before opening it to the public.
- No sign-in by email. Google only (email and password exists for local development and is switched off in production).
- No way to delete an account from the app yet.
- A friend's invite link works until you stop using it, there is no "make a new invite link" button yet.
- Taste match is a simple measure: how much two wish lists overlap, blended with how alike two people rate the same things. It shows "Not enough to compare yet" when there is no data, and does not guess.
- Book length is estimated at 90 seconds a page and manga at 8 minutes a chapter when a source gives no timing. Anywhere an estimate is shown, it says "about".
