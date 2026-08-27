import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import App from './App.tsx';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* History-mode URLs (T44): the SPA-fallback rewrite for unknown paths is
        a deployment requirement, recorded for when the host is decided. */}
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
