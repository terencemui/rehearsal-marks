-- ADR-0005 — Movements in label sets
--
-- The Commons row gains the recording's movements alongside its markers: one
-- jsonb document, additive and optional. Rows written before this migration
-- read back with none (the default), exactly as a project with no movements
-- behaves — one flat label sequence, as always. The domain's shape rules are
-- enforced on the way in by the row parser (`parseMovements`), so the column
-- carries the same trust the markers column does; the schema itself checks
-- only that it is JSON.

alter table public.label_sets
  add column movements jsonb not null default '[]'::jsonb;

-- The contributor's insert and update now carry movements with the rest of
-- the set. Re-granting adds the column to the existing grants; the earlier
-- migration's RLS policies are column-agnostic and need no change.
grant insert (id, video_id, title, duration, markers, movements)
  on public.label_sets to authenticated;

grant update (title, duration, markers, movements)
  on public.label_sets to authenticated;
