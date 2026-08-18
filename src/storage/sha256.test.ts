import { describe, expect, it } from 'vitest';
import { sha256 } from './sha256';

describe('sha256', () => {
  it('hashes the well-known "abc" vector', async () => {
    const hash = await sha256(new Blob(['abc']));
    expect(hash).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('hashes the empty blob', async () => {
    const hash = await sha256(new Blob([]));
    expect(hash).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('is deterministic for the same bytes and differs for different bytes', async () => {
    const bytes = new Uint8Array(1024 * 1024).map((_, i) => i % 251);
    const sameBlob = new Blob([bytes]);
    const differentBlob = new Blob([bytes.slice(1)]);

    const first = await sha256(sameBlob);
    const second = await sha256(new Blob([bytes]));
    const other = await sha256(differentBlob);

    expect(first).toBe(second);
    expect(first).not.toBe(other);
  });
});
