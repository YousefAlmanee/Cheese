# Cheese

A phone-first web app for the movies, series, anime, manga, books and games you want to get to. It keeps them in one place, finds time for them, and shows what your friends want too, so you can do things together.

- Product spec: [docs/SPEC.md](docs/SPEC.md)
- What is built, and what is not: [docs/STATUS.md](docs/STATUS.md)
- Putting it online: [SETUP.md](SETUP.md)
- Design system: https://claude.ai/artifact/AWGS4UouMdYT66qZdUrhXT

## What it does

- **One list for everything.** Search movies, series, anime, manga, books and games in one box. Add things by hand when a source does not have them.
- **Make time.** Set a weekly goal and your usual free evenings. The Plan screen shows free gaps (and skips anything on your Google Calendar) with what fits in each. Book sessions, get reminders, and subscribe to a calendar link.
- **Decide fast.** "I have 90 minutes" suggests what fits. "Pick for me" chooses for you.
- **Do things together.** Add friends with a link or username, make groups, see what everyone wants, and propose a night. Friends vote on times, even from a WhatsApp link without an account.

## Stack

Next.js 16 (App Router) and TypeScript, PostgreSQL with Drizzle, Better Auth (Google sign-in), web push for reminders. Styling comes from the Cheese design system (`design/`), with no CSS framework.

## Run it on your machine

You need Node 22 and a PostgreSQL 14+ server. On a machine with PostgreSQL installed, `npm run db:local` starts a throwaway one.

```bash
npm install
cp .env.example .env.local          # then edit it, see SETUP.md for each value
npm run db:local                    # optional: start a local PostgreSQL on port 54329
npm run db:migrate                  # reads DATABASE_URL from .env.local
npm run dev                         # http://localhost:3000
```

On Windows use `copy .env.example .env.local` in Command Prompt (or `cp` in Git Bash). `db:local` is a bash script for Linux; elsewhere start any PostgreSQL 14+ yourself and put its address in `DATABASE_URL`.

With `ENABLE_DEV_LOGIN=1` in `.env.local`, the sign-in page also offers email and password so you can try the app without setting up Google. That option is switched off in production builds, whatever the setting.

No API keys yet? `npm run dev:mock` answers the movie, anime, book and game searches from a small built-in catalog, which is enough to click through the whole app.

## Tests

```bash
npm test             # unit and database tests (needs the local PostgreSQL)
npm run test:e2e     # browser tests on a phone-sized screen, with the search APIs faked
npm run typecheck
```

`SHOTS_DIR=/some/folder npx playwright test screens` saves a screenshot of every screen in light and dark. `tests/e2e/a11y.spec.ts` runs the axe accessibility checker on all of them.

## Where things are

| Path | What |
|---|---|
| `src/app/(tabs)` | Home, Library, Plan, Friends (the four tabs) |
| `src/app/(stack)` | Screens opened from a tab: item, add, fit, pick, plan setup and booking, friends pages, night, settings |
| `src/app/n/[token]`, `src/app/i/[code]` | Public pages: vote on a night, accept an invite |
| `src/app/api` | Search, the calendar feed, sign-in, the reminder job |
| `src/app/actions` | Server actions. Each one checks who is signed in |
| `src/lib` | The rules: progress, free time, suggestions, matching, friends, nights, reminders |
| `src/lib/providers` | TMDB, AniList, Open Library, Google Books, IGDB |
| `src/db` | Schema (`drizzle/` holds the SQL migration) |
| `design/` | Design tokens and component CSS from the design system |
| `scripts/` | Migration, local database, icon and CSS generation, the fake search APIs |
