import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './editor/App.js';
import './editor/app.css';

const container = document.getElementById('root');
if (container === null) {
  // A missing root renders a blank page with no console output, which is the hardest kind of
  // failure for a user to report.
  throw new Error('Expected an element with id "root" in index.html, found none.');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
