import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { deriveLabels } from '../domain';
import { marker } from '../test/marker-fixture';
import { PracticeReadout } from './PracticeReadout';

/**
 * The fixture: markers at 10s (alias "Recap") and 20s — labels A and B in
 * time order — over a 40-second recording.
 */
function renderReadout(currentTime: number, duration = 40) {
  const markers = deriveLabels([marker('a', 10, ['Recap']), marker('b', 20)]);
  return render(
    <PracticeReadout markers={markers} currentTime={currentTime} duration={duration} />,
  );
}

const readout = () => screen.getByRole('region', { name: 'Practice readout' });

describe('PracticeReadout', () => {
  it('reads Start with the 00:00.000 timestamp before the first mark', () => {
    renderReadout(4);

    const region = readout();
    expect(within(region).getByText('Start')).toBeInTheDocument();
    expect(within(region).getByText('00:00.000')).toBeInTheDocument();
    // The next slot names the first marker and its anchor time.
    expect(within(region).getByText('A')).toBeInTheDocument();
    expect(within(region).getByText('00:10.000')).toBeInTheDocument();
  });

  it('shows the passed marker with letter and first alias, and the next marker', () => {
    renderReadout(15);

    const region = readout();
    // The passed slot is the letter plus the first alias — the practice
    // label a student actually calls it.
    expect(within(region).getByText('A — Recap')).toBeInTheDocument();
    expect(within(region).getByText('B')).toBeInTheDocument();
  });

  it('renders a bare label when the passed marker has no alias', () => {
    renderReadout(25);

    const region = readout();
    expect(within(region).getByText('B')).toBeInTheDocument();
    expect(within(region).queryByText(/—/)).not.toBeInTheDocument();
  });

  it('reads End with the recording duration after the last mark', () => {
    renderReadout(35);

    const region = readout();
    expect(within(region).getByText('End')).toBeInTheDocument();
    expect(within(region).getByText('00:40.000')).toBeInTheDocument();
  });

  it('drives the progress bar from the live playhead', () => {
    renderReadout(15);

    const bar = within(readout()).getByRole('progressbar');
    // Halfway from the passed anchor (10s) to the next (20s).
    expect(bar).toHaveAttribute('aria-valuenow', '0.5');
    expect(bar.querySelector('.player-practice-bar-fill')).toHaveStyle({ width: '50%' });
  });

  it('keeps both timestamps under the bar, at its two ends', () => {
    renderReadout(15);

    const region = readout();
    // The bar and both slot timestamps are all in the readout; the times sit
    // in their own row after the bar, left and right aligned.
    const times = region.querySelector('.player-practice-times');
    expect(times).not.toBeNull();
    expect(within(times as HTMLElement).getByText('00:10.000')).toBeInTheDocument();
    expect(within(times as HTMLElement).getByText('00:20.000')).toBeInTheDocument();
    expect(region.querySelector('.player-practice-bar')).not.toBeNull();
  });
});
