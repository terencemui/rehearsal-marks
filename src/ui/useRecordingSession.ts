import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import type { AudioController } from '../audio';
import { canonicalYouTubeUrl } from '../domain';
import type { Autosave } from '../projects/autosave';
import type { ServerProject } from '../projects/types';

export interface RecordingSessionOptions {
  /** The session's autosave — the record read, mutated, and flushed through. */
  autosave: Autosave;
  /** The AudioController seam instance this session runs on. */
  controller: AudioController;
  /**
   * A read-only session (T50): the public project view opens a stranger's
   * published project, which must never be written — not even the duration
   * stamp, the one write an editing session makes. The session then skips
   * every mutation and never flushes on teardown; playback, seeking, and the
   * marks are all read-only either way.
   */
  readOnly?: boolean;
}

/**
 * One surface's recording session: the embed's container, the load's
 * lifecycle, and the record the surface renders from. Extracted from the
 * player (T55) so the markings page runs the same session — the same
 * YouTube load through the seam, the same in-memory duration stamp, and the
 * same teardown — without either surface owning a copy of it.
 */
export interface RecordingSession {
  /** The element the audio layer loads the embed into. */
  containerRef: RefObject<HTMLDivElement | null>;
  /**
   * The record as React state, mirroring the autosave — the surface renders
   * from this, so an in-memory mutation (the duration stamp) redraws it.
   */
  record: ServerProject;
  /** Whether the load has resolved — on the success and the failure path alike. */
  settled: boolean;
  /** Whether the load reported that the recording cannot play. */
  loadFailed: boolean;
  /**
   * Applies a mutation to the session's record: the autosave takes it, and
   * React re-renders from the result. The way an editing surface changes what
   * the record holds — whether that reaches the server is the autosave's mode.
   */
  mutate(fn: (current: ServerProject) => ServerProject): void;
  /** Re-runs the load after a failure — the error card's Retry. */
  retryLoad(): void;
}

/**
 * The recording session behind a player surface: it owns the container the
 * embed loads into, runs the load once per session (again on a retry), and
 * stamps the measured duration into the record's in-memory copy — the ruler's
 * fallback length when the video is private, removed, or region-blocked. The
 * server never sees that stamp: the save wire skips a write whose persisted
 * fields are unchanged, so it neither demotes a published project through
 * review nor reorders the list. A read-only session (T50) makes no mutation
 * at all.
 *
 * Teardown is the session's too: on unmount the pending write settles, the
 * autosave is disposed, and the controller is destroyed. In the app a route
 * owns the exit as well (T45) and flushes around it — React cleans children
 * up first, so this flush is the no-op and the route's report is the point.
 */
export function useRecordingSession({
  autosave,
  controller,
  readOnly = false,
}: RecordingSessionOptions): RecordingSession {
  const containerRef = useRef<HTMLDivElement>(null);
  /**
   * Whether the recording's load has settled — until then the shortcuts are
   * inert, and the timeline has nothing to draw on.
   */
  const [settled, setSettled] = useState(false);
  /** Whether the load reported that the source cannot play. */
  const [loadFailed, setLoadFailed] = useState(false);
  /** Bumped by the failure card's Retry — re-runs the load effect. */
  const [loadAttempt, setLoadAttempt] = useState(0);
  /**
   * The record as React state. The one mutation a session makes is stamping
   * the measured duration after load; this mirrors the autosave so the
   * surface renders from the same record that persists.
   */
  const [record, setRecord] = useState<ServerProject>(() => autosave.get());
  // Derived every render, and fixed for the life of a session: a recording's
  // identity is not editable, so the URL never moves and the load never
  // re-runs for it. (A string dep compares by value, so the fresh call each
  // render is free.)
  const youtubeUrl = canonicalYouTubeUrl(autosave.get().videoId);

  /** Applies a mutation: the autosave gets it, React mirrors it. */
  const update = useCallback(
    (fn: (current: ServerProject) => ServerProject): void => {
      setRecord(autosave.mutate(fn));
    },
    [autosave],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;
    // Read through the autosave rather than from the render mirror: the
    // comparison below is against what the record holds, not against what a
    // previous stamp put on screen. Reading it here rather than in the deps
    // keeps the stamp itself from re-running the load.
    const storedDuration = autosave.get().duration;
    let cancelled = false;
    controller
      .load({
        // A project has only its canonical URL to play from — no blob, no
        // peaks — and the audio layer owns everything after that.
        source: 'youtube',
        url: youtubeUrl,
        container,
        // The stored duration is the failure state's timeline: a dead embed
        // reports nothing, so the timeline and the marks that ride on it
        // render from the last honest length the record has.
        duration: storedDuration,
      })
      .then((result) => {
        if (cancelled) return;
        setSettled(true);
        setLoadFailed(result.error !== undefined);
        // No decode supplies a duration; a bare project's 0 is a placeholder.
        // The media element's metadata is the recording's true duration —
        // kept in memory so the timeline and the list render honestly. The
        // epsilon keeps media-element measurement noise from dirtying the
        // record for a change no one made.
        if (!readOnly && result.duration > 0 && Math.abs(result.duration - storedDuration) > 0.001) {
          update((current) => ({ ...current, duration: result.duration }));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSettled(true);
          setLoadFailed(true);
        }
      });
    return () => {
      cancelled = true;
    };
    // The URL is fixed for the life of a session; `loadAttempt` is the failure
    // card's retry, the one deliberate re-run of the whole load.
  }, [autosave, controller, loadAttempt, readOnly, update, youtubeUrl]);

  useEffect(() => {
    // Teardown: write anything still pending, then release. The route that
    // built the session (T45) owns the exit as well — this is the safety net
    // beneath it, and its flush settles the pending write before the route's
    // own flush (which is then a no-op) reports the result. Two sessions never
    // flush: a read-only one (T50), which wrote nothing, and a manual one
    // (T56), whose pending record is a commit its owner has not made — writing
    // it here would be the write the mode exists to withhold.
    return () => {
      if (!readOnly && autosave.mode === 'auto') void autosave.flush().catch(() => {});
      autosave.dispose();
      controller.destroy();
    };
  }, [autosave, controller, readOnly]);

  return {
    containerRef,
    record,
    settled,
    loadFailed,
    mutate: update,
    /** The failure card's retry: back to loading, then a fresh load attempt. */
    retryLoad: useCallback(() => {
      setSettled(false);
      setLoadFailed(false);
      setLoadAttempt((attempt) => attempt + 1);
    }, []),
  };
}
