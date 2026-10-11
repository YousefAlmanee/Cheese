# Setting up Cheese for real

This takes about an hour, mostly waiting on sign-up screens. You need five things: a database, a Google sign-in, a movie key, a game key, and a place to host the app. Everything here has a free tier that is enough for you and your friends.

Keep a note of each value as you go. They all end up in one place at the end: your host's environment variables (listed in step 9).

## 1. A database

Cheese needs PostgreSQL. The easiest free one is Neon.

1. Sign up at neon.tech and create a project.
2. Copy the connection string. It looks like `postgres://user:password@host/dbname?sslmode=require`. This is `DATABASE_URL`.
3. Create the tables once, from this folder on your computer:
   ```bash
   npm install
   DATABASE_URL="paste the connection string" npm run db:migrate
   ```
   After this first run you don't need to repeat it: every production deploy on Netlify applies new migrations before building (`DATABASE_URL` must be set in Netlify, step 7). Previews and branch deploys do not touch the database.

## 2. Two secrets of your own

- `BETTER_AUTH_SECRET`: a long random string. Make one with `openssl rand -base64 32`. The app refuses to start in production with a short one.
- `BETTER_AUTH_URL`: the web address of your app, for example `https://cheese.netlify.app`. No slash at the end.

## 3. Google sign-in

1. Go to console.cloud.google.com and create a project called Cheese.
2. Open **APIs and Services, OAuth consent screen**. Choose **External**. Fill in the app name and your email. Add the scope `.../auth/calendar.freebusy` (only needed for the calendar feature).
3. Open **Credentials, Create credentials, OAuth client ID**, type **Web application**.
4. Under **Authorized redirect URIs** add `https://YOUR-SITE/api/auth/callback/google` (use your real address from step 2). For testing on your own computer also add `http://localhost:3000/api/auth/callback/google`.
5. Copy the client ID and secret. These are `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.
6. For the calendar feature, open **APIs and Services, Library** and enable **Google Calendar API**.

**Important about the consent screen.** Google keeps new apps in "Testing" mode. In Testing mode only people you list under "Test users" can sign in (up to 100), and Google expires the calendar permission every 7 days, so people would have to reconnect weekly. To avoid that, click **Publish app** to move it to "In production". You do not need Google's review for fewer than 100 users. The only effect is that when someone connects their calendar, Google shows an "unverified app" warning, and they continue through "Advanced". Sign-in alone shows no warning, because it only asks for name and email.

## 4. Movies and series (TMDB)

1. Make a free account at themoviedb.org, then open **Settings, API** and request an API key (choose Developer, personal use).
2. Copy the **API Key** (or the longer **API Read Access Token**, both work). This is `TMDB_API_KEY`.

## 5. Games (IGDB)

1. Make an account at dev.twitch.tv and turn on two-factor sign-in (Twitch requires it).
2. Open **Console, Applications, Register Your Application**. Name it Cheese, category Website Integration, and any redirect URL such as `http://localhost`.
3. Copy the **Client ID**, then create a **New Secret**. These are `TWITCH_CLIENT_ID` and `TWITCH_CLIENT_SECRET`.

Anime and manga (AniList) and books (Open Library) need no key. A `GOOGLE_BOOKS_API_KEY` is optional and only raises a quota you will not reach.

## 6. Reminders (optional)

Reminders are phone notifications before a session.

1. Make a key pair: `npx web-push generate-vapid-keys`. Copy the two values into `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY`.
2. Set `VAPID_SUBJECT` to `mailto:` plus your email.
3. Set `CRON_SECRET` to another random string. The scheduler uses it to prove it is allowed to trigger reminders.

On an iPhone, notifications only work once Cheese is added to the Home Screen (Share, then Add to Home Screen) and opened from there. Android and desktop browsers work directly.

## 7. Hosting on Netlify

1. Put this folder on GitHub (it already is).
2. At app.netlify.com choose **Add new site, Import an existing project**, pick the repository and this branch. The build settings come from `netlify.toml`.
3. Add every environment variable from step 9 under **Site configuration, Environment variables**.
4. Deploy. The file `netlify/functions/reminders.mts` is a scheduled function that runs every five minutes and triggers reminders. Nothing else to set up.

Another host works too. Any host that runs Next.js works, and any scheduler can call `GET /api/cron/reminders` every five minutes with the header `Authorization: Bearer YOUR_CRON_SECRET`.

## 8. First run

1. Open your site and sign in with Google.
2. On Plan, set your usual free time and (optionally) connect Google Calendar.
3. On Friends, send your invite link to your friends in WhatsApp.
4. On Settings, turn on reminders.

## 9. All the settings in one list

| Name | Needed | From |
|---|---|---|
| `DATABASE_URL` | yes | step 1 |
| `BETTER_AUTH_SECRET` | yes | step 2 |
| `BETTER_AUTH_URL` | yes | step 2 |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | yes | step 3 |
| `TMDB_API_KEY` | for movies and series | step 4 |
| `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET` | for games | step 5 |
| `GOOGLE_BOOKS_API_KEY` | no | step 5 |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | for reminders | step 6 |
| `CRON_SECRET` | for reminders | step 6 |
| `ENABLE_DEV_LOGIN` | never set this online | |

If a search key is missing, that category shows "Search is not set up for ... yet" and everything else keeps working. You can still add those things by hand.
