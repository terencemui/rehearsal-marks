import { describe, expect, it } from 'vitest';
import { formatUpdatedAt, validateProjectName } from './summary';

describe('formatUpdatedAt', () => {
  const NOW = 1_700_000_000_000;
  const MIN = 60_000;
  const HOUR = 3_600_000;
  const DAY = 86_400_000;

  it('renders "Just now" for the first minute, including the future', () => {
    expect(formatUpdatedAt(NOW, NOW)).toBe('Just now');
    expect(formatUpdatedAt(NOW - 45_000, NOW)).toBe('Just now');
    expect(formatUpdatedAt(NOW + 45_000, NOW)).toBe('Just now');
  });

  it('renders minutes and hours ago', () => {
    expect(formatUpdatedAt(NOW - MIN, NOW)).toBe('1m ago');
    expect(formatUpdatedAt(NOW - 5 * MIN, NOW)).toBe('5m ago');
    expect(formatUpdatedAt(NOW - 59 * MIN, NOW)).toBe('59m ago');
    expect(formatUpdatedAt(NOW - HOUR, NOW)).toBe('1h ago');
    expect(formatUpdatedAt(NOW - 23 * HOUR, NOW)).toBe('23h ago');
  });

  it('renders days, then weeks, then the date', () => {
    expect(formatUpdatedAt(NOW - DAY, NOW)).toBe('1d ago');
    expect(formatUpdatedAt(NOW - 6 * DAY, NOW)).toBe('6d ago');
    expect(formatUpdatedAt(NOW - 7 * DAY, NOW)).toBe('1w ago');
    expect(formatUpdatedAt(NOW - 7 * 7 * DAY, NOW)).toBe('7w ago');
    expect(formatUpdatedAt(NOW - 8 * 7 * DAY, NOW)).toBe('2023-09-19');
  });
});

describe('validateProjectName', () => {
  it('trims surrounding whitespace', () => {
    expect(validateProjectName('  New Name  ', 'Old Name')).toEqual({ ok: true, name: 'New Name' });
  });

  it('rejects empty and whitespace-only input', () => {
    expect(validateProjectName('', 'Old Name').ok).toBe(false);
    expect(validateProjectName('   ', 'Old Name').ok).toBe(false);
  });

  it('rejects a name identical to the current one, exactly', () => {
    expect(validateProjectName('Same', 'Same').ok).toBe(false);
    // Case differences are real changes — no uniqueness rule exists.
    expect(validateProjectName('same', 'Same')).toEqual({ ok: true, name: 'same' });
  });
});
