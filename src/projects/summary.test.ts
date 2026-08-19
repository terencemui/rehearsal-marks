import { describe, expect, it } from 'vitest';
import { formatBytes, formatDuration, formatUpdatedAt, totalUsageBytes, validateProjectName } from './summary';

describe('formatDuration', () => {
  it('renders mm:ss.mmm below an hour, whole or fractional', () => {
    expect(formatDuration(0)).toBe('0:00.000');
    expect(formatDuration(59.999)).toBe('0:59.999');
    expect(formatDuration(123.456)).toBe('2:03.456');
    expect(formatDuration(3599.999)).toBe('59:59.999');
  });

  it('renders h:mm:ss.mmm from an hour up', () => {
    expect(formatDuration(3600)).toBe('1:00:00.000');
    expect(formatDuration(3723.5)).toBe('1:02:03.500');
  });

  it('rounds to the millisecond on display', () => {
    expect(formatDuration(59.9996)).toBe('1:00.000');
  });

  it('clamps negative and non-finite durations to zero', () => {
    expect(formatDuration(-5)).toBe('0:00.000');
    expect(formatDuration(Number.NaN)).toBe('0:00.000');
  });
});

describe('formatBytes', () => {
  it('renders whole bytes under 1000', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(4)).toBe('4 B');
    expect(formatBytes(999)).toBe('999 B');
  });

  it('renders SI units with one decimal from 1000 up', () => {
    expect(formatBytes(1000)).toBe('1.0 KB');
    expect(formatBytes(1500)).toBe('1.5 KB');
    expect(formatBytes(1_000_000)).toBe('1.0 MB');
    expect(formatBytes(12_345_678)).toBe('12.3 MB');
    expect(formatBytes(4_500_000_000)).toBe('4.5 GB');
  });

  it('clamps negative and non-finite sizes to zero', () => {
    expect(formatBytes(-1)).toBe('0 B');
    expect(formatBytes(Number.NaN)).toBe('0 B');
  });
});

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

describe('totalUsageBytes', () => {
  it('sums per-project sizes and is zero for no projects', () => {
    expect(totalUsageBytes([])).toBe(0);
    expect(
      totalUsageBytes([{ sizeBytes: 4 }, { sizeBytes: 285 }, { sizeBytes: 1_000_000 }]),
    ).toBe(1_000_289);
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
