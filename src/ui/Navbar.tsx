import { useEffect, useState } from 'react';
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
 * The gallery search (T87) is the field centred between them. On the gallery
 * its value is the URL's `?q=`, written with history replace so Back leaves
 * the gallery rather than stepping through partial queries; everywhere else it
 * is an empty draft, and Enter carries it to the gallery.
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

  // The field follows the URL on the gallery and is empty on every other
  // page — including one page to the next, where neither the path's gallery
  // flag nor the search changes. Typing keeps the draft locally, so a
  // keystroke never waits on a navigation.
  useEffect(() => {
    setDraft(onGallery ? urlQuery : '');
  }, [onGallery, urlQuery, pathname]);

  function handleChange(event: ChangeEvent<HTMLInputElement>): void {
    const next = event.target.value;
    setDraft(next);
    if (!onGallery) return;
    void navigate(galleryPath(next), { replace: true });
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (onGallery) return;
    void navigate(galleryPath(draft.trim()));
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
        <form className="app-nav-search" role="search" onSubmit={handleSubmit}>
          <input
            type="search"
            className="app-nav-search-input"
            aria-label="Search the gallery"
            placeholder="Search the gallery"
            value={draft}
            onChange={handleChange}
          />
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
