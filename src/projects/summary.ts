/**
 * Pure helpers for the Projects screen: display formatting and the rename
 * rule. Facts in, strings out — no storage or React knowledge, so every piece
 * is testable in isolation.
 */

/**
 * Last-modified as a relative stamp — "Just now", "5m ago", "3h ago",
 * "2d ago", "3w ago" — falling back to an ISO date once the stamp is eight
 * weeks old. Future timestamps (clock skew) read as "Just now".
 */
export function formatUpdatedAt(epochMs: number, now: number): string {
  if (!Number.isFinite(epochMs)) return '';
  const age = Math.max(0, now - epochMs);
  const MIN = 60_000;
  const HOUR = 3_600_000;
  const DAY = 86_400_000;
  const WEEK = 7 * DAY;
  if (age < MIN) return 'Just now';
  if (age < HOUR) return `${Math.floor(age / MIN)}m ago`;
  if (age < DAY) return `${Math.floor(age / HOUR)}h ago`;
  if (age < WEEK) return `${Math.floor(age / DAY)}d ago`;
  if (age < 8 * WEEK) return `${Math.floor(age / WEEK)}w ago`;
  return new Date(epochMs).toISOString().slice(0, 10);
}

export type ProjectNameValidation = { ok: true; name: string } | { ok: false };

/**
 * The rename rule: the new name must be non-empty after trimming and
 * different from the current one. An empty or identical name means "keep the
 * current name" — the caller exits the edit without saving.
 */
export function validateProjectName(raw: string, current: string): ProjectNameValidation {
  const trimmed = raw.trim();
  if (trimmed === '' || trimmed === current) return { ok: false };
  return { ok: true, name: trimmed };
}
