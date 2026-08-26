import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './editor/App.js';
import { LanguageProvider } from './i18n/LanguageProvider.js';
import './editor/app.css';

const container = document.getElementById('root');
if (container === null) {
  // A missing root renders a blank page with no console output, which is the hardest kind of
  // failure for a user to report.
  throw new Error('Expected an element with id "root" in index.html, found none.');
}

createRoot(container).render(
  <StrictMode>
    {/* The provider is what makes the language changeable. Components render correct English
        without it -- see `i18n/context.ts` -- which is why every suite can mount one on its own. */}
    <LanguageProvider>
      <App />
    </LanguageProvider>
  </StrictMode>,
);
