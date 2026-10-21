/**
 * PROTOTYPE — three navbar + search layouts for Rehearsal Marks.
 *
 * Run:   npm run dev
 * Open:  /prototype/navbar                    (variant A, signed in)
 *        /prototype/navbar?variant=B&auth=out&q=brahms
 *
 * The question: how should the rebuilt navbar carry the public gallery's
 * search, the account menu, and the signed-out sign-in + legal line, without
 * losing the app's existing direction (score-white paper, hairlines, square
 * corners, a serif wordmark, and a grotesque for chrome)?
 *
 * Three structurally different answers, judged against the same gallery and
 * the same data:
 *
 *   A — Icon expands.      A quiet bar: wordmark, a boxed search glyph, the
 *                          account. The glyph becomes a field in place; on a
 *                          narrow window the field drops to a second row.
 *   B — Search in the bar.  A permanent rule-underlined field between the
 *                          wordmark and the account; on a narrow window it
 *                          drops to a second row.
 *   C — Catalogue masthead. Two rows at every width: identity and account
 *                          above, a boxed full-width search band below, with
 *                          the result count on its right.
 *   D — Centred, one box rule. B's single row with the search centred in the
 *                          rail, and one rule for every control: the search
 *                          field, the account trigger and the sign-in button
 *                          are all boxed, so nothing is outlined in one place
 *                          and underlined in another. Signed out, the
 *                          Privacy · Terms line sits to the left of the sign-in
 *                          button instead of beneath it.
 *
 * The account menu is the same object in all three: name + chevron, then
 * My projects / Privacy · Terms / Sign out / Delete account, with the delete
 * confirmation replacing the menu's items. Signed out, the sign-in button
 * carries the Privacy · Terms line beneath it.
 *
 * Throwaway. Governed by docs/prototypes.md: never merged, never imported, and
 * this file dies with the branch. The route exists only in DEV.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import './app.css';
import './gallery.css';
import './navbar.css';
import './navbarPrototype.css';
import './prototypeSwitcher.css';

type VariantKey = 'A' | 'B' | 'C' | 'D';
type AuthKey = 'in' | 'out';

interface Variant {
  key: VariantKey;
  name: string;
}

const VARIANTS: readonly Variant[] = [
  { key: 'A', name: 'Icon expands' },
  { key: 'B', name: 'Search in the bar' },
  { key: 'C', name: 'Catalogue masthead' },
  { key: 'D', name: 'Centred search, boxed controls' },
];

interface Entry {
  id: string;
  name: string;
  recordingTitle: string;
  markerCount: number;
}

/**
 * The gallery's density, faked with realistic data — a prototype must be
 * judged against content, not against an empty page. The recording titles are
 * the canonical ones a gallery groups by; the project names are the owners'.
 */
const PROJECTS: readonly Entry[] = [
  {
    id: 'p1',
    name: 'Brahms 4 — my marks',
    recordingTitle: 'Brahms: Symphony No. 4 — Wiener Philharmoniker, Carlos Kleiber',
    markerCount: 18,
  },
  {
    id: 'p2',
    name: 'Kleiber Brahms 4 (study copy)',
    recordingTitle: 'Brahms: Symphony No. 4 — Wiener Philharmoniker, Carlos Kleiber',
    markerCount: 9,
  },
  {
    id: 'p3',
    name: 'Tchaikovsky 5 — horns',
    recordingTitle: 'Tschaikowsky: Sinfonie Nr. 5 — hr-Sinfonieorchester, Manfred Honeck',
    markerCount: 24,
  },
  {
    id: 'p4',
    name: 'Mahler 2 — offstage brass',
    recordingTitle: 'Mahler: Symphony No. 2 — Lucerne Festival Orchestra, Claudio Abbado',
    markerCount: 31,
  },
  {
    id: 'p5',
    name: 'Mahler 2 (slow practice)',
    recordingTitle: 'Mahler: Symphony No. 2 — Lucerne Festival Orchestra, Claudio Abbado',
    markerCount: 12,
  },
  {
    id: 'p6',
    name: 'La Mer — rehearsal letters',
    recordingTitle: 'Debussy: La Mer — Orchestre de Paris, Daniel Barenboim',
    markerCount: 15,
  },
  {
    id: 'p7',
    name: 'Op. 131 — movements',
    recordingTitle: 'Beethoven: String Quartet Op. 131 — Danish String Quartet',
    markerCount: 7,
  },
  {
    id: 'p8',
    name: 'Rite — cues',
    recordingTitle: 'Stravinsky: The Rite of Spring — Berliner Philharmoniker, Simon Rattle',
    markerCount: 21,
  },
];

interface Group {
  recordingTitle: string;
  projects: Entry[];
}

/**
 * The gallery's grouping and filter: a recording's title matching keeps the
 * whole group; otherwise only the matching project names survive. Empty
 * groups disappear. This is the behaviour the real gallery would take from
 * `?q=`.
 */
function filterGroups(q: string): Group[] {
  const groups: Group[] = [];
  const byTitle = new Map<string, Group>();
  for (const project of PROJECTS) {
    let group = byTitle.get(project.recordingTitle);
    if (group === undefined) {
      group = { recordingTitle: project.recordingTitle, projects: [] };
      byTitle.set(project.recordingTitle, group);
      groups.push(group);
    }
    group.projects.push(project);
  }

  const needle = q.trim().toLowerCase();
  if (needle === '') return groups;

  return groups.flatMap((group) => {
    if (group.recordingTitle.toLowerCase().includes(needle)) return [group];
    const matching = group.projects.filter((p) => p.name.toLowerCase().includes(needle));
    return matching.length === 0 ? [] : [{ ...group, projects: matching }];
  });
}

function markerCountLabel(count: number): string {
  return `${count} ${count === 1 ? 'marker' : 'markers'}`;
}

function SearchIcon() {
  return (
    <svg
      className="nb-search-icon"
      viewBox="0 0 16 16"
      width="16"
      height="16"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="6.75" cy="6.75" r="4.25" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M10 10l4 4" fill="none" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      className={`nb-chevron${open ? ' is-open' : ''}`}
      viewBox="0 0 10 6"
      width="10"
      height="6"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

interface WordmarkProps {
  href: string;
  onHome: () => void;
}

function Wordmark({ href, onHome }: WordmarkProps) {
  return (
    <h1 className="app-name">
      <Link className="app-name-link" to={href} onClick={onHome}>
        <span className="app-mark" aria-hidden="true">
          R
        </span>
        Rehearsal Marks
      </Link>
    </h1>
  );
}

interface SearchFieldProps {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  autoFocus?: boolean;
  /** Supplied by the icon-expands variant: clears and closes in one press. */
  onClose?: () => void;
}

function SearchField({ value, onChange, className = '', autoFocus = false, onClose }: SearchFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  return (
    <div className={`nb-search ${className}`}>
      <SearchIcon />
      <input
        ref={inputRef}
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return;
          onChange('');
          onClose?.();
        }}
        placeholder="Search projects and recordings"
        aria-label="Search the public gallery"
      />
      {(onClose !== undefined || value !== '') && (
        <button
          type="button"
          className="nb-clear"
          onClick={() => {
            onChange('');
            onClose?.();
          }}
          aria-label="Clear search"
        >
          ×
        </button>
      )}
    </div>
  );
}

interface AccountControlProps {
  auth: AuthKey;
  onAuth: (auth: AuthKey) => void;
  /** Variant D: the legal line reads to the left of the sign-in button. */
  legalFirst?: boolean;
}

/**
 * The account object: the signed-in menu, or the signed-out sign-in with the
 * legal line beneath it. The menu closes on outside click and Escape (focus
 * returns to the trigger), and its delete confirmation replaces the items.
 */
function AccountControl({ auth, onAuth, legalFirst = false }: AccountControlProps) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  function close() {
    setOpen(false);
    setConfirming(false);
  }

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (!wrapRef.current?.contains(event.target as Node)) close();
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      close();
      triggerRef.current?.focus();
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  // Opening lands on the first item; the confirmation lands on Cancel, the
  // safe choice for a one-way action.
  useEffect(() => {
    if (!open) return;
    if (confirming) cancelRef.current?.focus();
    else menuRef.current?.querySelector<HTMLElement>('button')?.focus();
  }, [open, confirming]);

  if (auth === 'out') {
    const legal = (
      <span className="nb-legal-line">
        <button type="button" className="nb-legal-link">
          Privacy
        </button>
        <span aria-hidden="true">·</span>
        <button type="button" className="nb-legal-link">
          Terms
        </button>
      </span>
    );
    const signIn = (
      <button type="button" className="nb-sign-in" onClick={() => onAuth('in')}>
        Sign in with Google
      </button>
    );

    return (
      <div className={`nb-signed-out${legalFirst ? ' nb-signed-out-row' : ''}`}>
        {legalFirst ? (
          <>
            {legal}
            {signIn}
          </>
        ) : (
          <>
            {signIn}
            {legal}
          </>
        )}
      </div>
    );
  }

  return (
    <div className="nb-account-slot" ref={wrapRef}>
      <button
        ref={triggerRef}
        type="button"
        className="nb-account-trigger"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => {
          setOpen((current) => !current);
          setConfirming(false);
        }}
      >
        Ava Cellist
        <Chevron open={open} />
      </button>

      {open && (
        <div className="nb-menu" ref={menuRef} role="group" aria-label="Account">
          {confirming ? (
            <div className="nb-confirm">
              <p>
                Deleting your account removes it and every project you've created. This can't be
                undone.
              </p>
              <div className="nb-confirm-actions">
                <button
                  type="button"
                  className="nb-confirm-delete"
                  onClick={() => {
                    onAuth('out');
                    close();
                  }}
                >
                  Delete forever
                </button>
                <button
                  ref={cancelRef}
                  type="button"
                  className="nb-confirm-cancel"
                  onClick={() => setConfirming(false)}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <>
              <button type="button" className="nb-menu-item" onClick={close}>
                My projects
              </button>
              <div className="nb-menu-legal">
                <button type="button" className="nb-legal-link">
                  Privacy
                </button>
                <span aria-hidden="true">·</span>
                <button type="button" className="nb-legal-link">
                  Terms
                </button>
              </div>
              <div className="nb-menu-sep" role="presentation" />
              <button
                type="button"
                className="nb-menu-item"
                onClick={() => {
                  onAuth('out');
                  close();
                }}
              >
                Sign out
              </button>
              <button
                type="button"
                className="nb-menu-item nb-menu-danger"
                onClick={() => setConfirming(true)}
              >
                Delete account
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

interface NavbarProps {
  auth: AuthKey;
  q: string;
  home: string;
  count: number;
  onQ: (value: string) => void;
  onAuth: (auth: AuthKey) => void;
  onHome: () => void;
}

interface NavbarAProps extends NavbarProps {
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
}

function NavbarA({ auth, q, home, count, onQ, onAuth, onHome, open, onOpen, onClose }: NavbarAProps) {
  const showSearch = open || q !== '';

  return (
    <nav className="nb nb-a" aria-label="Primary">
      <div className="page-rail nb-row nb-a-row">
        <Wordmark href={home} onHome={onHome} />
        <div className={`nb-a-search${showSearch ? ' is-open' : ''}`}>
          {showSearch ? (
            <SearchField value={q} onChange={onQ} autoFocus onClose={onClose} />
          ) : (
            <button
              type="button"
              className="nb-search-toggle"
              aria-label="Search the public gallery"
              onClick={onOpen}
            >
              <SearchIcon />
            </button>
          )}
        </div>
        <AccountControl auth={auth} onAuth={onAuth} />
        <span className="nb-sr-only" aria-live="polite">
          {count} results
        </span>
      </div>
    </nav>
  );
}

function NavbarB({ auth, q, home, count, onQ, onAuth, onHome }: NavbarProps) {
  return (
    <nav className="nb nb-b" aria-label="Primary">
      <div className="page-rail nb-row nb-b-row">
        <Wordmark href={home} onHome={onHome} />
        <SearchField className="nb-b-search" value={q} onChange={onQ} />
        <AccountControl auth={auth} onAuth={onAuth} />
        <span className="nb-sr-only" aria-live="polite">
          {count} results
        </span>
      </div>
    </nav>
  );
}

function NavbarC({ auth, q, home, count, onQ, onAuth, onHome }: NavbarProps) {
  return (
    <nav className="nb nb-c" aria-label="Primary">
      <div className="page-rail nb-c-top">
        <Wordmark href={home} onHome={onHome} />
        <AccountControl auth={auth} onAuth={onAuth} />
      </div>
      <div className="nb-c-band">
        <div className="page-rail nb-c-band-inner">
          <SearchField className="nb-c-search" value={q} onChange={onQ} />
          <span className="nb-c-count" aria-live="polite">
            {count} of {PROJECTS.length} projects
          </span>
        </div>
      </div>
    </nav>
  );
}

function NavbarD({ auth, q, home, count, onQ, onAuth, onHome }: NavbarProps) {
  return (
    <nav className="nb nb-d" aria-label="Primary">
      <div className="page-rail nb-d-row">
        <Wordmark href={home} onHome={onHome} />
        <SearchField className="nb-d-search" value={q} onChange={onQ} />
        <AccountControl auth={auth} onAuth={onAuth} legalFirst />
        <span className="nb-sr-only" aria-live="polite">
          {count} results
        </span>
      </div>
    </nav>
  );
}

interface GalleryProps {
  q: string;
  onQ: (value: string) => void;
}

function Gallery({ q, onQ }: GalleryProps) {
  const groups = useMemo(() => filterGroups(q), [q]);
  const query = q.trim();

  return (
    <section className="gallery" role="region" aria-label="Public gallery">
      <h2>Gallery</h2>
      <p className="gallery-intro">Published projects, newest first.</p>

      {groups.length === 0 &&
        (query === '' ? (
          <p className="gallery-empty">No public projects yet.</p>
        ) : (
          <div className="nb-empty">
            <p className="gallery-empty">No projects match “{query}”.</p>
            <button type="button" className="gallery-retry" onClick={() => onQ('')}>
              Clear search
            </button>
          </div>
        ))}

      {groups.map((group) => (
        <article className="gallery-group" key={group.recordingTitle}>
          <h3 className="gallery-recording">{group.recordingTitle}</h3>
          <ul className="gallery-list">
            {group.projects.map((project) => (
              <li key={project.id}>
                <button type="button" className="gallery-entry">
                  <span className="gallery-name">{project.name}</span>
                  <span className="gallery-count">{markerCountLabel(project.markerCount)}</span>
                </button>
              </li>
            ))}
          </ul>
        </article>
      ))}
    </section>
  );
}

interface SwitcherProps {
  variant: VariantKey;
  auth: AuthKey;
  count: number;
  onVariant: (variant: VariantKey) => void;
  onAuth: (auth: AuthKey) => void;
}

/**
 * The floating switcher: ←/→ cycle the variant, the button flips the auth
 * state, and the count reports what the current query left on the page. It
 * reads as scaffolding, not as part of the design.
 */
function PrototypeSwitcher({ variant, auth, count, onVariant, onAuth }: SwitcherProps) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      ) {
        return;
      }
      const delta = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
      if (delta === 0) return;
      event.preventDefault();
      const index = VARIANTS.findIndex((entry) => entry.key === variant);
      onVariant(VARIANTS[(index + delta + VARIANTS.length) % VARIANTS.length].key);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [variant, onVariant]);

  const index = VARIANTS.findIndex((entry) => entry.key === variant);
  const current = VARIANTS[index] ?? VARIANTS[0];

  return (
    <div className="prototype-switcher">
      <button
        type="button"
        onClick={() => onVariant(VARIANTS[(index - 1 + VARIANTS.length) % VARIANTS.length].key)}
        aria-label="Previous variant"
      >
        ←
      </button>
      <span className="prototype-switcher-label">
        {current.key} — {current.name}
      </span>
      <button
        type="button"
        onClick={() => onVariant(VARIANTS[(index + 1) % VARIANTS.length].key)}
        aria-label="Next variant"
      >
        →
      </button>
      <span className="prototype-switcher-sep" aria-hidden="true" />
      <button
        type="button"
        className="prototype-switcher-auth"
        onClick={() => onAuth(auth === 'in' ? 'out' : 'in')}
      >
        {auth === 'in' ? 'Signed in' : 'Signed out'}
      </button>
      <span className="prototype-switcher-count">{count} results</span>
    </div>
  );
}

export function NavbarPrototypePage() {
  const [params, setParams] = useSearchParams();
  const requested = params.get('variant');
  const variant = VARIANTS.find((entry) => entry.key === requested)?.key ?? 'A';
  const auth: AuthKey = params.get('auth') === 'out' ? 'out' : 'in';
  const q = params.get('q') ?? '';
  const [aOpen, setAOpen] = useState(false);

  function update(next: Record<string, string | null>) {
    const copy = new URLSearchParams(params);
    for (const [key, value] of Object.entries(next)) {
      if (value === null || value === '') copy.delete(key);
      else copy.set(key, value);
    }
    setParams(copy, { replace: true });
  }

  function setQ(value: string) {
    update({ q: value });
  }

  function setAuth(value: AuthKey) {
    update({ auth: value });
  }

  function setVariant(value: VariantKey) {
    setAOpen(false);
    update({ variant: value });
  }

  function goHome() {
    setAOpen(false);
    update({ q: null });
  }

  const count = useMemo(
    () => filterGroups(q).reduce((total, group) => total + group.projects.length, 0),
    [q],
  );
  const home = `/prototype/navbar?variant=${variant}&auth=${auth}`;
  const navProps: NavbarProps = {
    auth,
    q,
    home,
    count,
    onQ: setQ,
    onAuth: setAuth,
    onHome: goHome,
  };

  return (
    <div className="proto-shell">
      {variant === 'A' && (
        <NavbarA
          {...navProps}
          open={aOpen}
          onOpen={() => setAOpen(true)}
          onClose={() => {
            setAOpen(false);
            setQ('');
          }}
        />
      )}
      {variant === 'B' && <NavbarB {...navProps} />}
      {variant === 'C' && <NavbarC {...navProps} />}
      {variant === 'D' && <NavbarD {...navProps} />}

      <main className="page-rail app-page">
        <Gallery q={q} onQ={setQ} />
      </main>

      <PrototypeSwitcher
        variant={variant}
        auth={auth}
        count={count}
        onVariant={setVariant}
        onAuth={setAuth}
      />
    </div>
  );
}
