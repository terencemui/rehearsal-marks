import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAudioController } from './controller';
import type { PeakData } from './peaks';

/** The wavesurfer surface the controller touches, as a test fake. */
interface FakeWaveSurfer {
  on: (event: string, callback: (...args: unknown[]) => void) => () => void;
  once: (event: string, callback: (...args: unknown[]) => void) => () => void;
  emit: (event: string, ...args: unknown[]) => void;
  playPause: ReturnType<typeof vi.fn>;
  setTime: ReturnType<typeof vi.fn>;
  setVolume: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
  loadBlob: ReturnType<typeof vi.fn>;
}

interface WaveSurferCapture {
  instance: FakeWaveSurfer;
  options: Record<string, unknown>;
}

const { waveSurferCaptures } = vi.hoisted(() => {
  const waveSurferCaptures: WaveSurferCapture[] = [];
  return { waveSurferCaptures };
});

vi.mock('wavesurfer.js', () => {
  /** A wavesurfer stand-in: spies for calls, a small emitter for events. */
  class FakeWaveSurfer implements FakeWaveSurfer {
    private listeners = new Map<string, Set<(...args: unknown[]) => void>>();

    on(event: string, callback: (...args: unknown[]) => void): () => void {
      let set = this.listeners.get(event);
      if (set === undefined) {
        set = new Set();
        this.listeners.set(event, set);
      }
      set.add(callback);
      return () => set.delete(callback);
    }

    once(event: string, callback: (...args: unknown[]) => void): () => void {
      const off = this.on(event, (...args: unknown[]) => {
        off();
        callback(...args);
      });
      return off;
    }

    emit(event: string, ...args: unknown[]): void {
      for (const callback of this.listeners.get(event) ?? []) callback(...args);
    }

    playPause = vi.fn(async () => {});
    setTime = vi.fn((time: number) => {
      // Mirrors wavesurfer's MediaElement path: setting the time re-emits
      // `timeupdate` with the new position.
      this.emit('timeupdate', time);
    });
    setVolume = vi.fn();
    destroy = vi.fn();
    loadBlob = vi.fn(async (_blob: Blob, _peaks?: number[][], duration?: number) => {
      this.emit('ready', duration ?? 0);
    });
  }

  return {
    default: {
      create: vi.fn((options: Record<string, unknown>) => {
        const instance = new FakeWaveSurfer();
        waveSurferCaptures.push({ instance, options });
        return instance;
      }),
    },
  };
});

/** A stand-in HTMLAudioElement: records the calls the controller makes on it. */
class FakeAudioElement extends EventTarget {
  paused = true;
  currentTime = 0;
  duration = 0;
  volume = 1;
  src = '';
  preload = '';
  play = vi.fn(async () => {
    this.paused = false;
    this.dispatchEvent(new Event('play'));
  });
  pause = vi.fn(() => {
    this.paused = true;
    this.dispatchEvent(new Event('pause'));
  });
  removeAttribute = vi.fn();
}

const audioElements: FakeAudioElement[] = [];

/** jsdom has no URL.createObjectURL — stub it onto the URL class directly. */
const objectUrlMocks = vi.hoisted(() => ({
  create: vi.fn(() => 'blob:fake'),
  revoke: vi.fn(),
}));

beforeEach(() => {
  audioElements.length = 0;
  waveSurferCaptures.length = 0;
  objectUrlMocks.create.mockClear();
  objectUrlMocks.revoke.mockClear();
  Object.assign(URL, {
    createObjectURL: objectUrlMocks.create,
    revokeObjectURL: objectUrlMocks.revoke,
  });
  vi.stubGlobal('Audio', function FakeAudio() {
    const element = new FakeAudioElement();
    audioElements.push(element);
    return element;
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AudioController playback', () => {
  describe('ruler mode (peaks unavailable)', () => {
    async function loadRuler(container: HTMLElement) {
      const controller = createAudioController();
      const pending = controller.load({
        blob: new Blob(['audio']),
        url: null,
        container,
        peaks: null,
      });
      const element = audioElements.at(-1)!;
      element.duration = 42;
      element.dispatchEvent(new Event('loadedmetadata'));
      const result = await pending;
      return { controller, element, result };
    }

    it('renders the ruler and publishes the media duration', async () => {
      const container = document.createElement('div');
      const { controller, result } = await loadRuler(container);

      expect(result).toEqual({ mode: 'ruler', duration: 42 });
      expect(container.querySelector('.rm-ruler')).not.toBeNull();
      expect(controller.getPlaybackState()).toMatchObject({
        duration: 42,
        playing: false,
        currentTime: 0,
      });
    });

    it('togglePlay plays and pauses the media element, tracking state', async () => {
      const container = document.createElement('div');
      const { controller, element } = await loadRuler(container);

      controller.togglePlay();
      expect(element.play).toHaveBeenCalledTimes(1);
      expect(controller.getPlaybackState().playing).toBe(true);

      controller.togglePlay();
      expect(element.pause).toHaveBeenCalledTimes(1);
      expect(controller.getPlaybackState().playing).toBe(false);
    });

    it('element timeupdate events move the playhead state', async () => {
      const container = document.createElement('div');
      const { controller, element } = await loadRuler(container);

      element.currentTime = 7.5;
      element.dispatchEvent(new Event('timeupdate'));

      expect(controller.getPlaybackState().currentTime).toBe(7.5);
    });

    it('seek clamps to the recording and moves the media element', async () => {
      const container = document.createElement('div');
      const { controller, element } = await loadRuler(container);

      controller.seek(150);
      expect(element.currentTime).toBe(42);
      expect(controller.getPlaybackState().currentTime).toBe(42);

      controller.seek(-5);
      expect(element.currentTime).toBe(0);

      controller.seek(10);
      expect(element.currentTime).toBe(10);
    });

    it('setVolume clamps to 0–1 and applies to the media element', async () => {
      const container = document.createElement('div');
      const { controller, element } = await loadRuler(container);

      controller.setVolume(0.4);
      expect(element.volume).toBe(0.4);
      expect(controller.getPlaybackState().volume).toBe(0.4);

      controller.setVolume(9);
      expect(element.volume).toBe(1);

      controller.setVolume(-1);
      expect(element.volume).toBe(0);
    });

    it('a ruler click seeks the element and the playhead', async () => {
      const container = document.createElement('div');
      const { controller, element } = await loadRuler(container);
      const ruler = container.querySelector('.rm-ruler') as HTMLElement;
      Object.defineProperty(ruler, 'getBoundingClientRect', {
        value: () => ({ left: 0, width: 200, right: 200, top: 0, bottom: 96 }),
      });

      ruler.dispatchEvent(new MouseEvent('click', { clientX: 50 }));

      expect(element.currentTime).toBe(10.5);
      expect(controller.getPlaybackState().currentTime).toBe(10.5);
    });

    it('destroy pauses the element, drops the src, and revokes the object URL', async () => {
      const container = document.createElement('div');
      const { controller, element } = await loadRuler(container);
      controller.togglePlay(); // so the element is playing when destroyed

      controller.destroy();

      expect(element.pause).toHaveBeenCalled();
      expect(element.removeAttribute).toHaveBeenCalledWith('src');
      expect(objectUrlMocks.revoke).toHaveBeenCalledWith('blob:fake');
    });

    it('a url load streams the element from that url without an object URL', async () => {
      const container = document.createElement('div');
      const controller = createAudioController();
      const pending = controller.load({
        blob: null,
        url: 'https://example.org/piece.mp3',
        container,
        peaks: null,
      });
      const element = audioElements.at(-1)!;
      element.duration = 30;
      element.dispatchEvent(new Event('loadedmetadata'));
      const result = await pending;

      expect(result).toEqual({ mode: 'ruler', duration: 30 });
      expect(element.src).toBe('https://example.org/piece.mp3');
      expect(objectUrlMocks.create).not.toHaveBeenCalled();
      // Playback streams from the network — the "load instantly" path.
      controller.togglePlay();
      expect(element.play).toHaveBeenCalledTimes(1);
      controller.destroy();
      expect(objectUrlMocks.revoke).not.toHaveBeenCalled();
    });

    it('a url load never reaches wavesurfer, even with peaks present', async () => {
      const container = document.createElement('div');
      const controller = createAudioController();
      const pending = controller.load({
        blob: null,
        url: 'https://example.org/piece.mp3',
        container,
        peaks: { peaks: [[0, 1]], duration: 30 },
      });
      audioElements.at(-1)!.dispatchEvent(new Event('loadedmetadata'));
      await pending;

      expect(waveSurferCaptures).toHaveLength(0);
    });
  });

  describe('waveform mode', () => {
    const peaks: PeakData = { peaks: [[0, 1]], duration: 99 };

    async function loadWaveform() {
      const controller = createAudioController();
      const container = document.createElement('div');
      const result = await controller.load({
        blob: new Blob(['audio']),
        url: null,
        container,
        peaks,
      });
      const capture = waveSurferCaptures.at(-1)!;
      return { controller, result, fake: capture.instance, options: capture.options };
    }

    it('creates wavesurfer without an audioContext — playback stays on the HTMLAudioElement path', async () => {
      const { options } = await loadWaveform();

      expect(options.container).toBeInstanceOf(HTMLDivElement);
      expect(options).not.toHaveProperty('audioContext');
      expect(options.backend).toBeUndefined();
      // Click-to-seek is wavesurfer's `interact` flag — pin it: T05 requires
      // a waveform click to seek (adding a marker there is T06's concern).
      expect(options.interact).toBe(true);
      // The media element lives behind wavesurfer's default backend; the
      // controller must not create one of its own for the waveform path.
      expect(audioElements).toHaveLength(0);
    });

    it('resolves with the decoded duration and publishes it', async () => {
      const { controller, result } = await loadWaveform();

      expect(result).toEqual({ mode: 'waveform', duration: 99 });
      expect(controller.getPlaybackState()).toMatchObject({ duration: 99, playing: false });
    });

    it('togglePlay delegates to wavesurfer', async () => {
      const { controller, fake } = await loadWaveform();

      controller.togglePlay();

      expect(fake.playPause).toHaveBeenCalledTimes(1);
    });

    it('forwards wavesurfer play, timeupdate, and pause events', async () => {
      const { controller, fake } = await loadWaveform();

      fake.emit('play');
      expect(controller.getPlaybackState().playing).toBe(true);

      fake.emit('timeupdate', 12.5);
      expect(controller.getPlaybackState().currentTime).toBe(12.5);

      fake.emit('pause');
      expect(controller.getPlaybackState().playing).toBe(false);
    });

    it('drops wavesurfer emissions that carry no time', async () => {
      const { controller, fake } = await loadWaveform();

      // Some wavesurfer paths (the WebAudio backend's seek) emit bare
      // `seeking`/`timeupdate` events. The store's currentTime contract is a
      // finite number — an empty payload must not leak `undefined` into it.
      fake.emit('seeking');
      expect(controller.getPlaybackState().currentTime).toBe(0);

      fake.emit('timeupdate');
      expect(controller.getPlaybackState().currentTime).toBe(0);

      fake.emit('timeupdate', 4.5);
      expect(controller.getPlaybackState().currentTime).toBe(4.5);
    });

    it('seek and setVolume delegate, clamped', async () => {
      const { controller, fake } = await loadWaveform();

      controller.seek(33);
      expect(fake.setTime).toHaveBeenCalledWith(33);

      controller.seek(10_000);
      expect(fake.setTime).toHaveBeenLastCalledWith(99);

      controller.setVolume(0.7);
      expect(fake.setVolume).toHaveBeenCalledWith(0.7);

      controller.setVolume(3);
      expect(fake.setVolume).toHaveBeenLastCalledWith(1);
    });

    it('subscribers can unsubscribe', async () => {
      const { controller } = await loadWaveform();
      const listener = vi.fn();

      const unsubscribe = controller.subscribe(listener);
      controller.seek(1);
      expect(listener).toHaveBeenCalledTimes(1);

      unsubscribe();
      controller.seek(2);
      expect(listener).toHaveBeenCalledTimes(1);
    });
  });
});
