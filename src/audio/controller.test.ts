import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAudioController } from './controller';

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
  // The ruler is the only timeline — there is no waveform and no decode, so
  // every upload load renders the ruler and streams through the element.
  async function loadUpload(container: HTMLElement) {
    const controller = createAudioController();
    const pending = controller.load({
      source: 'upload',
      blob: new Blob(['audio']),
      url: null,
      container,
    });
    const element = audioElements.at(-1)!;
    element.duration = 42;
    element.dispatchEvent(new Event('loadedmetadata'));
    const result = await pending;
    return { controller, element, result };
  }

  it('renders the ruler and publishes the media duration', async () => {
    const container = document.createElement('div');
    const { controller, result } = await loadUpload(container);

    expect(result).toEqual({ duration: 42 });
    expect(container.querySelector('.rm-ruler')).not.toBeNull();
    expect(controller.getPlaybackState()).toMatchObject({
      duration: 42,
      playing: false,
      currentTime: 0,
    });
  });

  it('togglePlay plays and pauses the media element, tracking state', async () => {
    const container = document.createElement('div');
    const { controller, element } = await loadUpload(container);

    controller.togglePlay();
    expect(element.play).toHaveBeenCalledTimes(1);
    expect(controller.getPlaybackState().playing).toBe(true);

    controller.togglePlay();
    expect(element.pause).toHaveBeenCalledTimes(1);
    expect(controller.getPlaybackState().playing).toBe(false);
  });

  it('element timeupdate events move the playhead state', async () => {
    const container = document.createElement('div');
    const { controller, element } = await loadUpload(container);

    element.currentTime = 7.5;
    element.dispatchEvent(new Event('timeupdate'));

    expect(controller.getPlaybackState().currentTime).toBe(7.5);
  });

  it('seek clamps to the recording and moves the media element', async () => {
    const container = document.createElement('div');
    const { controller, element } = await loadUpload(container);

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
    const { controller, element } = await loadUpload(container);

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
    const { controller, element } = await loadUpload(container);
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
    const { controller, element } = await loadUpload(container);
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
      source: 'upload',
      blob: null,
      url: 'https://example.org/piece.mp3',
      container,
    });
    const element = audioElements.at(-1)!;
    element.duration = 30;
    element.dispatchEvent(new Event('loadedmetadata'));
    const result = await pending;

    expect(result).toEqual({ duration: 30 });
    expect(element.src).toBe('https://example.org/piece.mp3');
    expect(objectUrlMocks.create).not.toHaveBeenCalled();
    // Playback streams from the network — the "load instantly" path.
    controller.togglePlay();
    expect(element.play).toHaveBeenCalledTimes(1);
    controller.destroy();
    expect(objectUrlMocks.revoke).not.toHaveBeenCalled();
  });
});
