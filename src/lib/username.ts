const MAX_BASE = 14;

/** Turns any display name or email prefix into a lowercase handle base: a-z, 0-9, underscore. */
export function usernameBase(input: string): string {
  const cleaned = input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/@.*$/, "")
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, MAX_BASE);
  return cleaned.length >= 3 ? cleaned : (cleaned + "user").slice(0, MAX_BASE);
}

export const USERNAME_RE = /^[a-z0-9_]{3,20}$/;

export function isValidUsername(value: string): boolean {
  return USERNAME_RE.test(value);
}

/** The sign-in PIN is exactly four digits. It is stored as the account password (hashed). */
export const PIN_RE = /^[0-9]{4}$/;

export function isValidPin(value: string): boolean {
  return PIN_RE.test(value);
}

/**
 * Username sign-in has no email, but better-auth's user model requires one, so we store a
 * stable placeholder derived from the (already lowercased) username.
 */
export const usernameEmail = (username: string) => `${username}@users.cheese.local`;

/** Candidate handles in order of preference: the base, then base plus a short number. */
export function* usernameCandidates(base: string, random: () => number = Math.random): Generator<string> {
  yield base;
  for (let i = 0; i < 50; i++) yield `${base}${Math.floor(random() * 900 + 100)}`;
  for (let i = 0; i < 50; i++) yield `${base}${Math.floor(random() * 90000 + 10000)}`;
}
