/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * The Supabase project URL behind the Commons (ADR-0001). Absent or blank,
   * sign-in reports itself unavailable and browsing is untouched — see
   * `supabase/README.md` for the wiring contract.
   */
  readonly VITE_SUPABASE_URL?: string;
  /** The Supabase project's anon (public) key — same unavailability rule. */
  readonly VITE_SUPABASE_ANON_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
