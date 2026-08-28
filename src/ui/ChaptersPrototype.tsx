/**
 * UI prototype (throwaway): "Three variants of the bottom timeline + chapters
 * section, switchable via `?variant=` on a mock route (`/prototype/chapters`)."
 *
 * Mock data only — a fake recording (Tchaikovsky 5, 46:30) with a simulated
 * live playhead — so the question ("what should the chapters section and the
 * remade bottom timeline look like?") can be judged without a real project or
 * a YouTube embed. Sub-shape B: the real player is read-only (T39) and needs a
 * project with markers, so this route stands alone. Keep the answer, delete
 * the code.
 */

import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { formatWholeSeconds } from '../domain/time';
import { PrototypeSwitcher } from './PrototypeSwitcher';
import './chaptersPrototype.css';

/** Mock recording: Tchaikovsky 5, 46:30 — the four movements plus a coda, and a label-only mark. */
const DURATION = 2790;
const MARKERS = [
  { label: 'A', alias: 'I. Andante', time: 0 },
  { label: 'B', alias: 'II. Andante cantabile', time: 630 },
  { label: 'C', alias: 'III. Valse', time: 1420 },
  { label: 'D', alias: 'IV. Finale', time: 1990 },
  { label: 'E', alias: 'Coda', time: 2600 },
  { label: 'F', alias: null, time: 2760 },
] as const;

const VARIANTS = [
  { key: 'A', name: 'Stacked list' },
  { key: 'B', name: 'Side panel' },
  { key: 'C', name: 'Chip strip' },
];

/** The row title: `label — alias`, or the bare label when there's no alias. */
function rowLabel(marker: (typeof MARKERS)[number]): string {
  return marker.alias === null ? marker.label : `${marker.label} — ${marker.alias}`;
}

/** The active chapter's index — the last marker at or before the playhead. */
function activeChapter(playhead: number): number {
  let index = 0;
  for (let i = 0; i < MARKERS.length; i += 1) {
    if (MARKERS[i].time <= playhead) index = i;
    else break;
  }
  return index;
}

interface VariantProps {
  playhead: number;
  activeIndex: number;
  onSeek(time: number): void;
}

interface ProgressBarProps {
  playhead: number;
  onSeek(time: number): void;
  left?: ReactNode;
  right?: ReactNode;
}

/** The remade bottom timeline: a filled click-to-seek progress bar with times under both ends. */
function ProgressBar({ playhead, onSeek, left, right }: ProgressBarProps) {
  const percent = (playhead / DURATION) * 100;
  return (
    <div className="proto-track-wrap">
      <div
        className="proto-track"
        role="slider"
        aria-label="Recording timeline"
        aria-valuemin={0}
        aria-valuemax={DURATION}
        aria-valuenow={Math.round(playhead)}
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          const ratio = (event.clientX - rect.left) / rect.width;
          onSeek(Math.min(1, Math.max(0, ratio)) * DURATION);
        }}
      >
        <div className="proto-track-fill" style={{ width: `${percent}%` }} />
      </div>
      <div className="proto-track-times">
        <span>{left ?? formatWholeSeconds(playhead, DURATION)}</span>
        <span>{right ?? formatWholeSeconds(DURATION, DURATION)}</span>
      </div>
    </div>
  );
}

/** The chapters list: timestamp, then `label — alias`; the active row highlighted. */
function ChaptersList({
  activeIndex,
  onSelect,
  className,
}: {
  activeIndex: number;
  onSelect(index: number): void;
  className?: string;
}) {
  return (
    <ol className={`proto-chapters ${className ?? ''}`}>
      {MARKERS.map((marker, index) => (
        <li key={marker.label} className={index === activeIndex ? 'active' : undefined}>
          <button type="button" onClick={() => onSelect(index)}>
            <span className="proto-chapter-time">
              {formatWholeSeconds(marker.time, DURATION)}
            </span>
            <span className="proto-chapter-title">{rowLabel(marker)}</span>
          </button>
        </li>
      ))}
    </ol>
  );
}

/** The mock recording's stand-in — a dark 16:9 box where the embed would sit. */
function VideoBox() {
  return (
    <div className="proto-video" aria-hidden="true">
      <span>▶</span>
    </div>
  );
}

/** Variant A — the agreed design: full-width bar, times beneath, full-width list. */
function VariantA({ playhead, activeIndex, onSeek }: VariantProps) {
  return (
    <>
      <VideoBox />
      <div className="proto-a-body">
        <ProgressBar playhead={playhead} onSeek={onSeek} />
        <h2 className="proto-chapters-heading">Chapters</h2>
        <ChaptersList activeIndex={activeIndex} onSelect={(index) => onSeek(MARKERS[index].time)} />
      </div>
    </>
  );
}

/** Variant B — chapters as a scrollable side panel beside the video, like a description list. */
function VariantB({ playhead, activeIndex, onSeek }: VariantProps) {
  return (
    <>
      <div className="proto-b-top">
        <VideoBox />
        <aside className="proto-b-panel">
          <h2 className="proto-chapters-heading">Chapters</h2>
          <ChaptersList
            className="scroll"
            activeIndex={activeIndex}
            onSelect={(index) => onSeek(MARKERS[index].time)}
          />
        </aside>
      </div>
      <ProgressBar playhead={playhead} onSeek={onSeek} />
    </>
  );
}

/** Variant C — chapters as a horizontal chip strip; the current chapter named out loud. */
function VariantC({ playhead, activeIndex, onSeek }: VariantProps) {
  return (
    <>
      <VideoBox />
      <div className="proto-c-chips">
        {MARKERS.map((marker, index) => (
          <button
            key={marker.label}
            type="button"
            className={index === activeIndex ? 'active' : undefined}
            onClick={() => onSeek(marker.time)}
          >
            {marker.label}
            {marker.alias !== null && <span className="proto-chip-alias">{marker.alias}</span>}
          </button>
        ))}
      </div>
      <p className="proto-c-now">Now: {rowLabel(MARKERS[activeIndex])}</p>
      <ProgressBar playhead={playhead} onSeek={onSeek} />
    </>
  );
}

export function ChaptersPrototype() {
  const [searchParams] = useSearchParams();
  const variant = searchParams.get('variant') ?? 'A';
  const [playhead, setPlayhead] = useState(724);
  const activeIndex = activeChapter(playhead);

  useEffect(() => {
    const id = window.setInterval(() => setPlayhead((time) => (time + 1) % DURATION), 350);
    return () => window.clearInterval(id);
  }, []);

  function seek(time: number): void {
    setPlayhead(Math.min(DURATION, Math.max(0, time)));
  }

  return (
    <div className="proto-page">
      <h1 className="proto-title">Tchaikovsky: Symphony No. 5 in E minor, Op. 64</h1>
      <div className="proto-frame">
        {variant === 'A' && (
          <VariantA playhead={playhead} activeIndex={activeIndex} onSeek={seek} />
        )}
        {variant === 'B' && (
          <VariantB playhead={playhead} activeIndex={activeIndex} onSeek={seek} />
        )}
        {variant === 'C' && (
          <VariantC playhead={playhead} activeIndex={activeIndex} onSeek={seek} />
        )}
      </div>
      <PrototypeSwitcher variants={VARIANTS} />
    </div>
  );
}
