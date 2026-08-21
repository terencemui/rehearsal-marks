import { describe, expect, it } from 'vitest';
import { clearOAuthErrorReturn, isOAuthErrorReturn, readAuthEnv } from './supabase';

/**
 * The adapter's pure helpers — the pieces of the real supabase-js wiring that
 * are testable without a live project. The eager-throw URL cases are exactly
 * what readAuthEnv must catch (supabase-js throws on those, and a config typo
 * must mean `unavailable`, never a blank app), and the OAuth error-return
 * helpers are the deny-consent recovery: the fragment must not outlive the
 * failed return, or session recovery is skipped on every later load.
 */

const GOOD_ENV = {
  VITE_SUPABASE_URL: 'https://abc.supabase.co',
  VITE_SUPABASE_ANON_KEY: 'anon-key',
};

const GOOD_AUTH_ENV = { url: 'https://abc.supabase.co', anonKey: 'anon-key' };

describe('readAuthEnv', () => {
  it('returns the env when both vars are set', () => {
    expect(readAuthEnv(GOOD_ENV)).toEqual(GOOD_AUTH_ENV);
  });

  it('trims surrounding whitespace', () => {
    expect(readAuthEnv({ ...GOOD_ENV, VITE_SUPABASE_ANON_KEY: '  anon-key  ' })).toEqual(
      GOOD_AUTH_ENV,
    );
  });

  it('returns null when either var is missing or blank', () => {
    expect(readAuthEnv({ VITE_SUPABASE_URL: 'https://abc.supabase.co' })).toBeNull();
    expect(readAuthEnv({ VITE_SUPABASE_URL: '', VITE_SUPABASE_ANON_KEY: 'anon-key' })).toBeNull();
    expect(readAuthEnv({ ...GOOD_ENV, VITE_SUPABASE_ANON_KEY: '   ' })).toBeNull();
    expect(readAuthEnv({})).toBeNull();
  });

  it('returns null for a URL supabase-js would throw on', () => {
    expect(readAuthEnv({ ...GOOD_ENV, VITE_SUPABASE_URL: 'not a url' })).toBeNull();
    expect(readAuthEnv({ ...GOOD_ENV, VITE_SUPABASE_URL: 'ftp://example.com/x' })).toBeNull();
    expect(readAuthEnv({ ...GOOD_ENV, VITE_SUPABASE_URL: 'abc.supabase.co' })).toBeNull();
  });
});

describe('isOAuthErrorReturn', () => {
  it.each(['#error=access_denied', '#error_code=popup_closed', '#error_description=denied'])(
    'flags an OAuth error fragment: %s',
    (hash) => {
      expect(isOAuthErrorReturn(hash)).toBe(true);
    },
  );

  it.each(['', '#notes', '#section-2', '#not-an-error'])(
    'ignores a non-OAuth fragment: %s',
    (hash) => {
      expect(isOAuthErrorReturn(hash)).toBe(false);
    },
  );
});

describe('clearOAuthErrorReturn', () => {
  it('strips an OAuth error return, keeping the path and query', () => {
    window.history.replaceState(null, '', '/?tab=projects#error=access_denied');

    clearOAuthErrorReturn();

    expect(window.location.pathname).toBe('/');
    expect(window.location.search).toBe('?tab=projects');
    expect(window.location.hash).toBe('');
  });

  it('leaves a non-OAuth fragment alone', () => {
    window.history.replaceState(null, '', '/#notes');

    clearOAuthErrorReturn();

    expect(window.location.hash).toBe('#notes');
  });
});
