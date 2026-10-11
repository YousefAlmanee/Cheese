/**
 * Only allow same-site relative paths as post-login redirects.
 * Browsers drop tabs and newlines inside a URL and treat a backslash as a slash, so "/<tab>/evil.example" would
 * become "//evil.example". Control characters and backslashes are refused outright.
 */
export function safeNext(value: string | undefined | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";
  if (/[\u0000-\u001f\u007f\\]/.test(value)) return "/";
  return value;
}
