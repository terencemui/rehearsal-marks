-- A project names its marks the way its score does (T72).
--
-- Every surface used to print `label — alias`, which is right only when the
-- score letters its rehearsal marks. A score that numbers them (1, 2, 3) or
-- boxes the bar number ([17], [42], [63]) makes the derived letter name
-- nothing in the score — a row reading `D — 17`, where `D` is the app talking
-- to itself. `naming` records which convention the project's own score uses,
-- so the names a reader sees are a fact about the project (ADR-0005's reason
-- for putting movements in the label set, restated): a published project must
-- read to anonymous viewers exactly as it reads to its owner.
--
-- The column is additive and backfilled by its own default, so every existing
-- project reads back as today's behaviour. `visibility` is the precedent for a
-- client-settable enum: the DB default owns creation, so the insert grant and
-- the create payload are untouched, and a new project is always `letters`.

alter table public.projects
  add column naming text not null default 'letters'
    check (naming in ('letters', 'numbers', 'measures'));

-- The client sets it through its own operation, beside the visibility toggle —
-- never through the markings autosave, which writes the project's *markings*
-- and not a project-level setting (ADR-0007's save split). Update only: like
-- `visibility` and `publication_status`, the value at creation is the default,
-- so no insert grant is added.
--
-- No trigger change is needed. `projects_gate_writes` and `projects_review_edits`
-- are row-level, not column-aware, so flipping the setting on a published
-- public project returns it to review and off the gallery — the same rule a
-- rename already obeys (ADR-0006, T56), surfaced by the row's badge.
grant update (naming) on public.projects to authenticated;
