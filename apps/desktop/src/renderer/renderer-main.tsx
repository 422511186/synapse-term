import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import './styles.css';
import './prototype-tailwind.css';
import './prototype-fonts.css';
import { App } from './app.js';

const root = document.getElementById('root');
if (root === null) throw new Error('Renderer root element is missing');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
