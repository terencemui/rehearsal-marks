/**
 * Pure helpers for the Projects screen: display formatting and the rename
 * rule. Facts in, strings out — no storage or React knowledge, so every piece
 * is testable in isolation.
 */

/**
 * Recording duration as mm:ss.mmm, extending to h:mm:ss.mmm from an hour up —
 * the same display precision the player shows for marker timestamps.
 * Rounding is display-only; negative and non-finite values render as zero.
 */
export function formatDuration(seconds: number): string {
  const clamped = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const totalMs = Math.round(clamped * 1000);
  const hours = Math.floor(totalMs / 3_600_000);
  const minutes = Math.floor((totalMs % 3_600_000) / 60_000);
  const secs = Math.floor((totalMs % 60_000) / 1000);
  const ms = totalMs % 1000;
  const mm = String(minutes).padStart(2, '0');
  const ss = String(secs).padStart(2, '0');
  const mmm = String(ms).padStart(3, '0');
  return hours > 0 ? `${hours}:${mm}:${ss}.${mmm}` : `${minutes}:${ss}.${mmm}`;
}

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
