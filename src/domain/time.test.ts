import { describe, expect, it } from 'vitest';
import { DomainError, type DomainErrorCode } from './errors';
import { formatTime, formatWholeSeconds, parseTime } from './time';

function expectDomainError(fn: () => unknown, code: DomainErrorCode, message?: string): void {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).code).toBe(code);
    if (message !== undefined) {
      expect((error as DomainError).message).toContain(message);
    }
    return;
  }
  expect.unreachable(`expected a DomainError with code "${code}"`);
}

describe('parseTime', () => {
  it.each([
    ['5:10.5', 310.5],
    ['5:10', 310],
    ['310.5', 310.5],
    ['5 10', 310],
    ['5 10.5', 310.5],
    ['5  10', 310],
    ['5: 10', 310],
    ['1:05:10.5', 3910.5],
    ['1 5 10', 3910],
    ['0:05', 5],
    ['0', 0],
    [' 5:10 ', 310],
  ])('parses %j to %f seconds', (input, expected) => {
    expect(parseTime(input)).toBe(expected);
  });

  it.each(['abc', '', '5:', ':10', '5:10:', '1:2:3:4', '-5', '5-10', '5.', '.5', '5..5', '5e2', 'NaN', '5.5:10'])(
    'rejects %j',
    (input) => {
      expectDomainError(() => parseTime(input), 'invalid-time-format');
    },
  );

  it('rejects a value so large it is no longer finite', () => {
    expectDomainError(() => parseTime('9'.repeat(400)), 'invalid-time-format');
  });

  it('describes the bad input and the accepted formats in the error message', () => {
    expectDomainError(() => parseTime('abc'), 'invalid-time-format', 'abc');
    expectDomainError(() => parseTime('abc'), 'invalid-time-format', '5:10.5');
  });
});

describe('formatTime', () => {
  it.each([
    [0, 60, '00:00.000'],
    [5, 60, '00:05.000'],
    [59.999, 60, '00:59.999'],
    [65.5, 60, '01:05.500'],
    [310.5, 60, '05:10.500'],
    [3599.9, 60, '59:59.900'],
  ])('formats %f seconds as mm:ss.mmm for a sub-hour recording', (seconds, duration, expected) => {
    expect(formatTime(seconds, duration)).toBe(expected);
  });

  it.each([
    [0, 3600, '0:00:00.000'],
    [310.5, 3600, '0:05:10.500'],
    [3910.25, 3600, '1:05:10.250'],
    [36_005, 3600, '10:00:05.000'],
  ])('formats %f seconds as h:mm:ss.mmm for an hour-plus recording', (seconds, duration, expected) => {
    expect(formatTime(seconds, duration)).toBe(expected);
  });

  it('rounds to the displayed millisecond, not truncates', () => {
    expect(formatTime(310.555, 60)).toBe('05:10.555');
    expect(formatTime(1.9999, 60)).toBe('00:02.000');
  });

  it('clamps a negative time to zero instead of rendering a sign', () => {
    expect(formatTime(-0.5, 60)).toBe('00:00.000');
  });
});

describe('formatWholeSeconds', () => {
  it.each([
    [0, 60, '00:00'],
    [5, 60, '00:05'],
    [5.4, 60, '00:05'],
    [5.6, 60, '00:06'],
    [59.6, 60, '01:00'],
    [310.4, 60, '05:10'],
    [3599.4, 60, '59:59'],
  ])('formats %f seconds as mm:ss for a sub-hour recording', (seconds, duration, expected) => {
    expect(formatWholeSeconds(seconds, duration)).toBe(expected);
  });

  it.each([
    [0, 3600, '0:00:00'],
    [310.4, 3600, '0:05:10'],
    [3910.25, 3600, '1:05:10'],
    [3599.6, 3600, '1:00:00'],
    [36_005, 3600, '10:00:05'],
  ])('formats %f seconds as h:mm:ss for an hour-plus recording', (seconds, duration, expected) => {
    expect(formatWholeSeconds(seconds, duration)).toBe(expected);
  });

  it('rounds to the nearest whole second, not truncates', () => {
    expect(formatWholeSeconds(1.4, 60)).toBe('00:01');
    expect(formatWholeSeconds(1.6, 60)).toBe('00:02');
  });

  it('clamps a negative time to zero instead of rendering a sign', () => {
    expect(formatWholeSeconds(-0.5, 60)).toBe('00:00');
    expect(formatWholeSeconds(-12.9, 3600)).toBe('0:00:00');
  });

  it('formats zero as zero', () => {
    expect(formatWholeSeconds(0, 60)).toBe('00:00');
  });
});
