import { vi } from 'vitest';
import type { AudioController, PeakData, RenderMode } from '../audio';

/**
 * Test double for the AudioController seam — the one seam component tests
 * mock. Every method records its calls and succeeds by default.
 */
export function mockController(overrides: Partial<AudioController> = {}): AudioController {
  return {
    extractPeaks: vi.fn(async (): Promise<PeakData> => ({ peaks: [[0, 1]], duration: 10 })),
    load: vi.fn(async () => ({ mode: 'waveform' as RenderMode, duration: 10 })),
    destroy: vi.fn(),
    ...overrides,
  };
}
