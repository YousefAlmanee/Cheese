/** Why a Better Auth secret is not safe to run in production, or null if it is fine. */
export function secretProblem(secret: string | undefined): string | null {
  const s = secret ?? "";
  if (s.length < 32) return "BETTER_AUTH_SECRET must be a random string of at least 32 characters in production.";
  if (/^change-?me/i.test(s)) return "BETTER_AUTH_SECRET is still the placeholder from .env.example. Generate a real one (openssl rand -base64 32).";
  return null;
}
