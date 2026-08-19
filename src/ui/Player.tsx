import { useEffect, useRef, useState } from 'react';
import type { AudioController, PeakData, RenderMode } from '../audio';
import { createAutosave } from '../storage';
import type { ProjectRecord, SaveStatus, Storage } from '../storage';

export interface PlayerProps {
  /** The project to play — the upload pipeline's freshly created record. */
  record: ProjectRecord;
  /** Decoded peaks, or `null` when decoding failed (ruler-only mode). */
  peaks: PeakData | null;
  /** The AudioController seam instance this session runs on. */
  controller: AudioController;
  storage: Storage;
}

const STATUS_TEXT: Record<SaveStatus, string> = {
  idle: 'Saved',
  dirty: 'Saving…',
  saving: 'Saving…',
  saved: 'Saved',
  'storage-full': 'Storage full — free up space to keep saving.',
  error: 'Save failed.',
};

/**
 * The player screen: waveform (or ruler-only timeline) plus the project's
 * name and the autosave status line. Everything audible goes through the
 * `controller`; the screen itself only owns persistence via autosave.
 */
export function Player({ record, peaks, controller, storage }: PlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<RenderMode | null>(null);
  const [status, setStatus] = useState<SaveStatus>('idle');
  const [autosave] = useState(() =>
    createAutosave(record, { save: (next) => storage.projects.save(next) }),
  );

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;
    let cancelled = false;
    controller
      .load({ blob: record.audio, container, peaks })
      .then((result) => {
        if (cancelled) return;
        setMode(result.mode);
        // Ruler mode has no decode duration; the record's 0 is a placeholder.
        // The media element's metadata is the recording's true duration —
        // persisting it keeps the project list (T09) and exports honest, so
        // the one write outside the upload path earns its place.
        if (result.duration > 0 && result.duration !== autosave.get().audioMeta.duration) {
          autosave.mutate((current) => ({
            ...current,
            audioMeta: { ...current.audioMeta, duration: result.duration },
          }));
        }
      })
      .catch(() => {
        if (!cancelled) setMode('ruler');
      });
    return () => {
      cancelled = true;
    };
  }, [autosave, controller, peaks, record.audio]);

  useEffect(() => {
    const unsubscribe = autosave.subscribe(setStatus);
    return () => {
      unsubscribe();
      // Page teardown: write anything still pending, then release.
      void autosave.flush().catch(() => {});
      autosave.dispose();
      controller.destroy();
    };
  }, [autosave, controller]);

  return (
    <main>
      <header>
        <h1>{record.name}</h1>
        <p role="status" data-save-status={status}>
          {STATUS_TEXT[status]}
        </p>
      </header>
      <div ref={containerRef} className="player-waveform" />
      {mode === 'ruler' && (
        <p className="ruler-note">Waveform unavailable — the timeline still works.</p>
      )}
    </main>
  );
}
