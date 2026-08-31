import './notWiredUp.css';

/**
 * The honest face of an unconfigured deployment (T51): the whole app replaced
 * by a short screen that says sign-in — and with it projects — isn't wired up
 * yet. Rendered by the App's env gate before any controller is built, so
 * there is no navbar and nothing else to click: the app simply isn't
 * connected to a Supabase project, and pretending otherwise would show a
 * broken shell.
 */
export function NotWiredUpScreen() {
  return (
    <main className="not-wired">
      <div className="page-rail not-wired-inner">
        <h1>Rehearsal Marks</h1>
        <p>This deployment isn't wired up yet.</p>
        <p>
          Sign-in and saved projects need a Supabase project, and this build isn't connected to
          one. Once it is, everything works here.
        </p>
      </div>
    </main>
  );
}
