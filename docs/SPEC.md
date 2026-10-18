# Cheese: Product Spec

Build status: see [STATUS.md](STATUS.md).

Cheese is a phone-first web app for tracking the movies, series, anime, manga, books and games you want to get to, making real time for them, and finding the ones you can do with friends.

Status: planning complete, not built yet.

---

## 1. Problems we're solving

| # | Problem | In scope |
|---|---|---|
| 1 | **Scattered**: lists live in Goodreads, Letterboxd, notes, screenshots | Yes |
| 2 | **No time**: things get added but never done. Free time is rare and has to be carved out | Yes |
| 3 | **Decision paralysis**: free time comes and I can't pick | Yes |
| 4 | Forgetting why I saved something | **No** |
| 5 | **No overlap with friends**: we don't know what we'd all enjoy together | Yes |
| 6 | **Coordination**: plans to do things together fall through | Yes |
| 7 | **No record**: I want a history of what I finished | Yes |

## 2. Who it's for

- Me and my friends. A small private group, not a public social network.
- Used mostly on the phone. Built as a responsive web app that can be added to the home screen (needed for reminders).
- Everyone starts fresh, except that movies can be imported from a Letterboxd export (Settings).

## 3. Categories and data sources

Items are added by searching an API, with manual entry as a fallback. No scraping. Each item stores the API's ID, which makes overlap between friends an exact match.

| Category | Source | Progress unit | Length |
|---|---|---|---|
| Movies | TMDB | watched / not | runtime |
| Series | TMDB | episodes | episodes × episode length |
| Anime | AniList | episodes | episodes × episode length |
| Manga | AniList | chapters | chapter count |
| Books | Open Library, Google Books | pages (percentage for shared progress) | page count |
| Video games | IGDB | hours played | time to beat |

## 4. Core rules

- **Statuses**: Want to, In progress, Paused, Done, Dropped.
- **Rating**: 5 stars with half stars (0.5 to 5).
- **Priority**: must do / someday.
- **"Together?" flag** on every item: solo, or open to doing with friends. Only "open" items count toward overlap.
- **Rewatches**: each watch, read or playthrough is its own log with its own date and rating.

## 5. Features

### Version 1

**Adding and library**
- One search box across all categories, plus manual entry
- Statuses, priority, filter and sort (category, length, genre, priority)
- One-tap progress (+1 episode, + pages, + time). Finishing prompts a rating and short review
- Finished log with dates

**Making time**
- Weekly time goal (e.g. 6 hours a week)
- Free time from two sources:
  - Your usual free times, set once and adjustable per week
  - Your Google Calendar (read only, to skip busy times). Fine for up to 100 test users without Google's review
- Plan screen shows free gaps and suggests what fits
- Book sessions (solo or with friends)
- Calendar link (.ics) that any calendar app can subscribe to
- Reminders on your phone before a session

**Deciding**
- "I have X minutes": suggests what fits
- "Pick for me": random pick from your list, with filters
- Continue section on Home

**Friends**
- Add friends by username or invite link
- Groups (e.g. Movie Nights, Anime crew)
- Hide specific items from friends
- Common list per group, ranked by how many want each item, with a taste match %
- Fits-the-group filters (same platform, under 2 hours, etc.)
- "Done it, would do it again" still counts as overlap
- See friends' lists and ratings
- Propose a night: pick an item, suggest times, friends vote, RSVP (going / maybe / can't)
- Share a session to WhatsApp. Friends can vote from the link without the app

### Version 2
- Weekly streak with freezes (weekly, not daily)
- Auto-reschedule missed sessions
- Weekly recap, stats, year in review
- Estimated finish dates based on pace
- Swipe to pick as a group
- Spoiler-safe shared progress (comments unlock at your episode, chapter or %)
- Activity feed with reactions, recommend an item to a friend
- New episode, season or chapter alerts
- Group sessions written to everyone's Google Calendar
- Data export

### Not doing
- Adding by pasting a link
- A cap on how many things can be in progress
- In-app chat (WhatsApp does this)
- Synced remote watching
- Importing from apps other than Letterboxd

## 6. Screens

Navigation is a bottom tab bar: **Home, Library, + (add), Plan, Friends**.

| Screen | Based on | What's on it |
|---|---|---|
| **Home** ("Tonight") | Netflix-style spotlight | Category chips, weekly goal pill, one big "up next" card with Start and +1, one Continue row |
| **Plan** | Apple TV / Structured-style timeline | Week strip, the day's timeline with free gaps and "Fill" suggestions, booked sessions with category color |
| **Friends** | Spotify Blend-style | Group chips, group match card, "You all want" list with counts (5/5, 4/5) |
| **Library** | To design | All items, filtered by status and category |
| **Add** | To design | Search across categories, tap to add |
| **Item / Propose a night** | To design | Details, progress, rating, "Plan a night", time votes, RSVPs |

Mockup: https://claude.ai/artifact/QszGgVZucNpYwwym9HMvmA

### Key flows
1. **Add in under 10 seconds**: tap +, type, tap a result. It lands in "Want to" with defaults.
2. **Log progress**: tap +1 on Home. On the last episode it asks "Done? Rate it".
3. **"I have 90 minutes"**: enter time, get 3 suggestions that fit, start or book one.
4. **Group night**: Friends → pick from the common list → Propose → friends vote on times → winner goes to everyone's calendar link → afterwards everyone marks it done and rates it.

## 7. Design

- **Theme**: follows the phone (light and dark).
- **Look**: calm. 2 to 3 sections per screen. Covers do the talking.
- **No gradients**: cover art shown flat, flat cards.
- **One accent**: coral, used only for actions, progress and counts.
- **Category colors**: anime pink, books amber, games purple, series blue (for tags and timeline blocks only).
- **Type**: Unbounded for headings, Manrope for text.

**Design system**: https://claude.ai/artifact/AWGS4UouMdYT66qZdUrhXT (tokens, components, all 7 screens). Where it differs from this spec, this spec wins:
- Priority has **2 levels** (must do / someday), not the 3 shown on the Item detail screen.
- Home also gets the **"I have __ min"** and **"Pick for me"** buttons.
- Still to design, using the same components: usual free times setup, Google Calendar connect, the review step after finishing.

Decisions taken from the design system: text on coral is dark (not white), spotlight text sits under the cover (never on it), the week starts on Sunday.

## 8. Lessons from the benchmark

- Nobody combines all categories, time planning, friend overlap and scheduling. That combination is the point of Cheese.
- People quit trackers when logging feels like a chore. Logging must be one tap.
- Long backlogs cause guilt. Don't show a giant item count, and make dropping things easy.
- Keep Continue near the top. Apple and Crunchyroll users complained when it moved down.
- Trackers shut down (TV Time closed in July 2026), so data export matters (V2).
