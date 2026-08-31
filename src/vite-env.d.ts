/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * The Supabase project URL behind the app's server (ADR-0006). Absent or
   * blank, the app renders the not-wired-up screen — see `supabase/README.md`
   * for the wiring contract.
   */
  readonly VITE_SUPABASE_URL?: string;
  /** The Supabase project's anon (public) key — same unavailability rule. */
  readonly VITE_SUPABASE_ANON_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
