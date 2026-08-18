import { describe, expect, it } from 'vitest';
import { DomainError, type DomainErrorCode } from './errors';
import { parseTime } from './time';

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
