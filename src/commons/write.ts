/**
 * The Commons write pipeline — the contributor's side of the moderation gate
 * (T25): submit a label set (which lands `pending`, invisible to readers),
 * re-submit an edited one (an UPDATE of the same row, back into review), and
 * read back the contributor's own rows with their publication status. Pure
 * orchestration over the write backend, which `auth/write.ts` implements
 * with supabase-js under the containment rule; the tests fake the backend
 * exactly like they fake `SupabaseAuth`.
 *
 * An unconfigured deployment degrades like auth does: the controller stays
 * usable, the submissions list is empty, and a submit throws the honest
 * `not-configured` error instead of crashing.
 */

import { createSupabaseCommonsWrite, readAuthEnv } from '../auth';
import type { SupabaseCommonsWrite } from '../auth';
import { CommonsError } from './errors';
import type { LabelSetRow, LabelSetValues } from './labelSet';

/** The app's Commons write surface — the seam component tests inject. */
export interface CommonsWriteController {
  /** The contributor's own rows, newest first — their submissions and statuses. */
  listMySubmissions(): Promise<LabelSetRow[]>;
  /**
   * Submits the values, or updates the existing row when this project has
   * already submitted one — re-submission is an UPDATE, never a second row.
   */
  submit(values: LabelSetValues, existing: LabelSetRow | undefined): Promise<void>;
}

export function createCommonsWriteController(
  backend: SupabaseCommonsWrite | null,
): CommonsWriteController {
  if (backend === null) {
    // No backend means no Commons at all: there is nothing to list and the
    // submit reports the unconfigured deployment honestly.
    return {
      listMySubmissions: async () => [],
      submit: async () => {
        throw notConfigured();
      },
    };
  }

  return {
    listMySubmissions: () => backend.listMyLabelSets(),
    submit: async (values, existing) => {
      if (existing !== undefined) {
        await backend.updateLabelSet(existing.id, {
          title: values.title,
          duration: values.duration,
          markers: values.markers,
        });
      } else {
        await backend.insertLabelSet(values);
      }
    },
  };
}

/**
 * The default controller for the real app: built from the deployment env, or
 * `not-configured` when the app is not wired to a Supabase project — the
 * honest unconfigured state, never a crash.
 */
export function createDefaultCommonsWrite(): CommonsWriteController {
  const env = readAuthEnv();
  if (env === null) return createCommonsWriteController(null);
  try {
    return createCommonsWriteController(createSupabaseCommonsWrite(env));
  } catch {
    // readAuthEnv covers the known eager-throw cases; anything else the
    // client constructor can raise is still an unconfigured deployment, not
    // a crash — the degradation contract holds either way.
    return createCommonsWriteController(null);
  }
}

function notConfigured(): CommonsError {
  return new CommonsError("Contributing isn't set up for this deployment yet.", 'not-configured');
}
