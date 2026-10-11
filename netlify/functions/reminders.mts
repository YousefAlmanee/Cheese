// Runs every five minutes on Netlify and asks the app to send any reminders that are due.
// On other hosts, point any scheduler at GET /api/cron/reminders with the same Authorization header.
import type { Config } from "@netlify/functions";

export default async () => {
  const base = process.env.URL ?? process.env.DEPLOY_PRIME_URL;
  const secret = process.env.CRON_SECRET;
  if (!base || !secret) {
    console.log("reminders: URL or CRON_SECRET is missing, skipping");
    return;
  }
  // Scheduled functions are cut off after about 30 seconds, so give up a little before that and log why.
  try {
    const res = await fetch(`${base}/api/cron/reminders`, { headers: { Authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(25_000) });
    console.log("reminders:", res.status, await res.text());
  } catch (e) {
    console.error("reminders: request failed", e instanceof Error ? e.message : e);
  }
};

export const config: Config = { schedule: "*/5 * * * *" };
