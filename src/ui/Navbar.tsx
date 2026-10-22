import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import type { AuthState } from '../auth';
import { UserControl } from './UserControl';
import './navbar.css';

export interface NavbarProps {
  /**
   * The frame the page under this navbar takes (T84) — the shell's own class
   * string, handed in rather than decided here, so the navbar and the page it
   * heads are the same width on every route. The rail itself is defined in
   * the shell stylesheet (app.css); nothing in navbar.css may cap it.
   */
  railClass: string;
  /** The user session — the same state the workspace's create gate reads. */
  authState: AuthState;
  onSignIn: () => void;
  onSignOut: () => void;
  /** Requests the signed-in user's account deletion (T26). */
  onDeleteAccount: () => void;
}

/**
 * The gallery's address for a query: `/?q=` for text, `/` for none — the one
 * spelling both the gallery's live URL and Enter-from-elsewhere use.
 */
function galleryPath(query: string): string {
  return query === '' ? '/' : `/?${new URLSearchParams({ q: query }).toString()}`;
}

/** The search glyph: the magnifier, or the close mark while the panel is open. */
function SearchGlyph({ close = false }: { close?: boolean }) {
  return (
    <svg
      className="app-nav-search-icon"
      viewBox="0 0 16 16"
      width="14"
      height="14"
      aria-hidden="true"
      focusable="false"
    >
      {close ? (
        <path d="M3 3l10 10M13 3L3 13" fill="none" stroke="currentColor" strokeWidth="1.5" />
      ) : (
        <>
          <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M10.5 10.5L14 14" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </>
      )}
    </svg>
  );
}

/**
 * The one global navbar (T44): the wordmark and the account control, and
 * nothing else (T86). The Gallery, Projects, and Help links are gone: the
 * wordmark is the way home, the account menu is the way to the workspace and
 * the account actions, and the legal documents are linked from the account
 * control in both auth states. Renders on every routed page, including the
 * project page (T45).
 *
 * The wordmark wears the direction (T76): the name is set in the document's
 * face with the rehearsal mark in its box in front of it, and it is the
 * navbar's way home — a link rather than a label, so the identity is also a
 * control. The box is markup carrying `aria-hidden`, not a decorative
 * pseudo-element as it was on the prototype, since the mark is no longer
 * throwaway and only a real element can be kept out of the accessible name:
 * the wordmark is announced as the app's name alone, and the box that draws
 * its initial adds nothing to read.
 *
 * The gallery search (T87, T93) is the field between them. On the gallery its
 * value is the URL's `?q=`, written with history replace so Back leaves the
 * gallery rather than stepping through partial queries; everywhere else it is
 * an empty draft. Enter and the magnifier button share one submit path, which
 * trims the draft and carries it to the gallery, replacing when already there.
 * When the rail is too narrow to hold the full field, it collapses into a
 * magnifier trigger whose panel drops below the navbar.
 */
export function Navbar({
  railClass,
  authState,
  onSignIn,
  onSignOut,
  onDeleteAccount,
}: NavbarProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const pathname = location.pathname;
  const onGallery = pathname === '/';
  const urlQuery = new URLSearchParams(location.search).get('q') ?? '';
  const [draft, setDraft] = useState(urlQuery);
  const [searchOpen, setSearchOpen] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // The field follows the URL on the gallery and is empty on every other
  // page — including one page to the next, where neither the path's gallery
  // flag nor the search changes. Typing keeps the draft locally, so a
  // keystroke never waits on a navigation.
  useEffect(() => {
    setDraft(onGallery ? urlQuery : '');
  }, [onGallery, urlQuery, pathname]);

  // The narrow trigger's disclosure: the field takes focus when it opens, and
  // a press anywhere outside the form puts the panel away.
  useEffect(() => {
    if (searchOpen) inputRef.current?.focus();
  }, [searchOpen]);

  useEffect(() => {
    if (!searchOpen) return;
    function handlePointerDown(event: PointerEvent): void {
      if (!formRef.current?.contains(event.target as Node)) setSearchOpen(false);
    }
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [searchOpen]);

  // Escape closes the panel from wherever focus has wandered, not only from
  // inside the form, and gives the trigger the focus back.
  useEffect(() => {
    if (!searchOpen) return;
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key !== 'Escape') return;
      setSearchOpen(false);
      triggerRef.current?.focus();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [searchOpen]);

  function handleChange(event: ChangeEvent<HTMLInputElement>): void {
    const next = event.target.value;
    setDraft(next);
    if (!onGallery) return;
    void navigate(galleryPath(next), { replace: true });
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setSearchOpen(false);
    // One path for Enter and the button: trim, and replace on the gallery so
    // Back still leaves it rather than stepping through submissions.
    void navigate(galleryPath(draft.trim()), { replace: onGallery });
  }

  return (
    <nav className="app-nav" aria-label="Primary">
      <div className={`${railClass} app-nav-inner`}>
        <h1 className="app-name">
          <Link to="/" className="app-name-link">
            <span className="app-mark" aria-hidden="true">R</span>
            Rehearsal Marks
          </Link>
        </h1>
        <form
          ref={formRef}
          className="app-nav-search"
          role="search"
          data-open={searchOpen ? 'true' : 'false'}
          onSubmit={handleSubmit}
        >
          <button
            ref={triggerRef}
            type="button"
            className="app-nav-search-trigger"
            aria-label={searchOpen ? 'Close search' : 'Open search'}
            aria-expanded={searchOpen}
            aria-controls="app-nav-search-panel"
            onClick={() => setSearchOpen((open) => !open)}
          >
            {searchOpen ? <SearchGlyph close /> : <SearchGlyph />}
          </button>
          <div className="app-nav-search-panel" id="app-nav-search-panel">
            <input
              ref={inputRef}
              type="search"
              className="app-nav-search-input"
              aria-label="Search the gallery"
              placeholder="Search the gallery"
              value={draft}
              onChange={handleChange}
            />
            <button type="submit" className="app-nav-search-submit" aria-label="Search">
              <SearchGlyph />
            </button>
          </div>
        </form>
        <div className="app-nav-auth">
          <UserControl
            state={authState}
            onSignIn={onSignIn}
            onSignOut={onSignOut}
            onDeleteAccount={onDeleteAccount}
          />
        </div>
      </div>
    </nav>
  );
}
