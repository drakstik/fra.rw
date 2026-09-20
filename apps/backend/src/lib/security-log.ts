/**
 * Structured logging for security-relevant events (suspected token theft,
 * and later: rejected cross-origin requests, lockouts, etc.).
 *
 * One JSON object per line on stderr, so events can be found with a plain
 * `docker compose logs backend | grep security_event` today, and picked
 * up by a log shipper later without changing call sites. No logging
 * library yet on purpose: this is the only structured log in the codebase
 * and a dependency isn't justified for one function.
 *
 * NEVER pass raw tokens, token hashes, passwords or cookies in `details`.
 * IDs (userId, familyId), IPs and user agents are fine: they are what an
 * operator needs to investigate, and they stay server-side.
 */
export type SecurityEventLevel = "warn" | "info";

export function logSecurityEvent(
  event: string,
  details: Record<string, unknown>,
  level: SecurityEventLevel = "warn",
): void {
  const line = JSON.stringify({
    security_event: event,
    level,
    at: new Date().toISOString(),
    ...details,
  });
  if (level === "warn") console.warn(line);
  else console.info(line);
}