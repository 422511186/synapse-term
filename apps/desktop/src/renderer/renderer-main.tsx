import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './app.js';
import './styles.css';

const desktopPlatform = window.terminalAgent?.platform;
if (desktopPlatform !== undefined) {
  document.documentElement.dataset.desktopPlatform = desktopPlatform;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
