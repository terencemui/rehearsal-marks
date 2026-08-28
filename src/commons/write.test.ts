import { describe, expect, it } from 'vitest';
import { CommonsError } from './errors';
import { createCommonsWriteController } from './write';
import { labelSetRow } from '../test/commons-fixture';
import { mockCommonsWriteBackend } from '../test/commons-write-fixture';
import type { LabelSetValues } from './labelSet';

/** A submission the app would send — the project file resolved to row values. */
const VALUES: LabelSetValues = {
  id: '11111111-1111-4111-8111-111111111111',
  video_id: 'dQw4w9WgXcQ',
  title: 'A labeled performance',
  duration: 604.2,
  markers: [
    { id: 'm1', time: 10, aliases: [], createdAt: 1 },
    { id: 'm2', time: 222.35, aliases: ['Recap'], createdAt: 2 },
  ],
  movements: [],
};

describe('createCommonsWriteController over a backend', () => {
  it('inserts a submission when the project has no Commons row yet', async () => {
    const backend = mockCommonsWriteBackend();
    const controller = createCommonsWriteController(backend);

    await controller.submit(VALUES, undefined);

    expect(backend.insertLabelSet).toHaveBeenCalledWith(VALUES);
    expect(backend.updateLabelSet).not.toHaveBeenCalled();
  });

  it('updates the existing row when the project already submitted one — re-submission is an update', async () => {
    const existing = labelSetRow();
    const backend = mockCommonsWriteBackend([existing]);
    const controller = createCommonsWriteController(backend);

    await controller.submit(VALUES, existing);

    expect(backend.updateLabelSet).toHaveBeenCalledWith(existing.id, {
      title: VALUES.title,
      duration: VALUES.duration,
      markers: VALUES.markers,
      movements: VALUES.movements,
    });
    expect(backend.insertLabelSet).not.toHaveBeenCalled();
  });

  it('lists the contributor\'s rows as the backend returns them', async () => {
    const rows = [labelSetRow({ publication_status: 'pending' })];
    const backend = mockCommonsWriteBackend(rows);
    const controller = createCommonsWriteController(backend);

    await expect(controller.listMySubmissions()).resolves.toEqual(rows);
  });
});

describe('createCommonsWriteController without a backend', () => {
  it('reports an empty submissions list', async () => {
    const controller = createCommonsWriteController(null);

    await expect(controller.listMySubmissions()).resolves.toEqual([]);
  });

  it('throws the honest not-configured error on submit', async () => {
    const controller = createCommonsWriteController(null);

    await expect(controller.submit(VALUES, undefined)).rejects.toMatchObject({
      code: 'not-configured',
    } satisfies Partial<CommonsError>);
  });
});
