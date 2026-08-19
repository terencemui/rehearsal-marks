import { describe, expect, it } from 'vitest';
import { formatRulerTime, rulerTicks } from './ruler';

describe('rulerTicks', () => {
  it('picks a coarse interval so a recording gets at most ~10 ticks', () => {
    expect(rulerTicks(30)).toEqual([
      { time: 0, label: '0:00' },
      { time: 5, label: '0:05' },
      { time: 10, label: '0:10' },
      { time: 15, label: '0:15' },
      { time: 20, label: '0:20' },
      { time: 25, label: '0:25' },
      { time: 30, label: '0:30' },
    ]);

    // 123.4s: 10s interval would give 13 ticks, so 15s is chosen (9 ticks).
    expect(rulerTicks(123.4).map((tick) => tick.time)).toEqual([
      0, 15, 30, 45, 60, 75, 90, 105, 120,
    ]);
  });

  it('renders a single zero tick for a missing or zero duration', () => {
    expect(rulerTicks(0)).toEqual([{ time: 0, label: '0:00' }]);
    expect(rulerTicks(-1)).toEqual([{ time: 0, label: '0:00' }]);
  });
});

describe('formatRulerTime', () => {
  it('formats m:ss below an hour and h:mm:ss from an hour up', () => {
    expect(formatRulerTime(0)).toBe('0:00');
    expect(formatRulerTime(65)).toBe('1:05');
    expect(formatRulerTime(3599)).toBe('59:59');
    expect(formatRulerTime(3600)).toBe('1:00:00');
    expect(formatRulerTime(7325)).toBe('2:02:05');
  });
});
