/**
 * The server-project backend — the only module besides `auth/supabase.ts`
 * that references the supabase-js library, by the same containment rule. The
 * `ProjectsApi` surface in `api.ts` is the seam; this file is its real
 * implementation and nothing else.
 *
 * The write path rides the session: each call restores it from the shared
 * storage first, so a signed-out client fails with a clean `not-signed-in`
 * error instead of a token-less request RLS would refuse. Anonymous reads
 * carry no session at all — RLS, never the client, decides what they may see.
 */

import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ProjectsError } from './errors';
import type { ProjectsApi } from './api';
import { parseProjectRow, summarizeProject } from './types';
import type { ProjectValues, ServerProject } from './types';
import type { AuthEnv } from '../auth';

/** The `ProjectsApi` over a real supabase-js client. */
export function createSupabaseProjectsApi(env: AuthEnv): ProjectsApi {
  const client = createClient(env.url, env.anonKey);

  return {
    async listMyProjects() {
      await requireSession(client);
      const { data, error } = await client
        .from('projects')
        .select('*')
        .order('updated_at', { ascending: false });
      if (error) throw postgrestErrorToProjectsError(error);
      return data.map((row: unknown) => summarizeProject(parseProjectRow(row)));
    },

    async getProject(id) {
      const { data, error } = await client.from('projects').select('*').eq('id', id).maybeSingle();
      if (error) throw postgrestErrorToProjectsError(error);
      if (data === null) return null;
      return parseProjectRow(data);
    },

    async createProject(values) {
      await requireSession(client);
      const { data, error } = await client
        .from('projects')
        .insert(projectValuesToRow(values))
        .select()
        .single();
      if (error) throw postgrestErrorToProjectsError(error);
      return parseProjectRow(data);
    },

    async saveProject(id, update) {
      await requireSession(client);
      // The update grant only: name, markers, movements. Anything the caller
      // did not set stays absent, so a partial edit never resets siblings.
      const row: Record<string, unknown> = {};
      if (update.name !== undefined) row.name = update.name;
      if (update.markers !== undefined) row.markers = update.markers;
      if (update.movements !== undefined) row.movements = update.movements;
      const { error } = await client.from('projects').update(row).eq('id', id);
      if (error) throw postgrestErrorToProjectsError(error);
    },

    async setVisibility(id, visibility) {
      await requireSession(client);
      const { error } = await client.from('projects').update({ visibility }).eq('id', id);
      if (error) throw postgrestErrorToProjectsError(error);
    },

    async deleteProject(id) {
      await requireSession(client);
      const { error } = await client.from('projects').delete().eq('id', id);
      if (error) throw postgrestErrorToProjectsError(error);
    },

    async listPublishedForVideo(videoId) {
      const { data, error } = await client
        .from('projects')
        .select('*')
        .eq('video_id', videoId)
        .eq('visibility', 'public')
        .eq('publication_status', 'published')
        .order('updated_at', { ascending: false });
      if (error) throw postgrestErrorToProjectsError(error);
      return data.map((row: unknown) => summarizeProject(parseProjectRow(row)));
    },
  };
}

/** The create payload, snake_case — the insert grant's columns exactly. */
function projectValuesToRow(values: ProjectValues): Record<string, unknown> {
  return {
    name: values.name,
    recording_title: values.recordingTitle,
    video_id: values.videoId,
    duration: values.duration,
    markers: values.markers,
    movements: values.movements,
  };
}

/**
 * Restores the session into the client (and verifies it exists) before a
 * write, returning the signed-in user. The restore also makes the postgrest
 * client's own token attachment deterministic.
 */
async function requireSession(client: SupabaseClient): Promise<{ id: string }> {
  const { data, error } = await client.auth.getSession();
  if (error) throw postgrestErrorToProjectsError(error);
  if (data.session === null) {
    throw new ProjectsError('You need to sign in to do that.', 'not-signed-in');
  }
  return { id: data.session.user.id };
}

/**
 * A PostgREST rejection, translated into the app's own vocabulary. The
 * moderation-gate trigger's `BANNED` prefix (pinned by the migration contract
 * test) is the suspension; a missing row is the 404; everything else —
 * network trouble, an RLS refusal, a constraint that should not have fired —
 * is the server failing to do the thing, with a retry message that does not
 * blame one cause.
 */
export function postgrestErrorToProjectsError(error: unknown): ProjectsError {
  const message =
    typeof error === 'object' && error !== null && 'message' in error
      ? String((error as { message: unknown }).message)
      : '';
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code: unknown }).code)
      : '';

  if (message.startsWith('BANNED')) {
    return new ProjectsError(
      'This account is suspended from editing projects.',
      'banned',
    );
  }
  if (code === 'PGRST116' || code === '404') {
    return new ProjectsError('This project was not found.', 'not-found');
  }
  return new ProjectsError(
    "The server couldn't save that change. Check your connection and try again.",
    'fetch-failed',
  );
}

/** The type guard used by the adapter's row parsers. */
export type { ServerProject };
