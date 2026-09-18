import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router';
import App from './App.tsx';

/**
 * History-mode URLs (T44): the SPA-fallback rewrite for unknown paths is a
 * deployment requirement, recorded for when the host is decided.
 *
 * **Data mode, not declarative (T60, ADR-0004's amendment).** The app is
 * served by a single splat route — `App` still owns its own `<Routes>`, whose
 * pages depend on state that lives inside the shell — but the router itself is
 * a data router. That is what makes `useBlocker` available: the markings page
 * must be able to refuse a navigation away from uncommitted work, and blocking
 * is a data-router capability. Nothing else changes: no loaders, no actions,
 * no server data loading, exactly as ADR-0004 promised.
 */
const router = createBrowserRouter([{ path: '*', element: <App /> }]);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
