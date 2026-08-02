// ────────────────────────────────────────────────────────────────
// main.tsx — Application entry point
// ────────────────────────────────────────────────────────────────

import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App.js';
import { installAuthFetchInterceptor } from './platform/authTransport.js';
import './styles/globals.css';

// Must run before any component mounts: it wraps `window.fetch` so every
// `/api/**` request carries a DPoP proof, including the raw `fetch` calls
// scattered through panels and hooks.
installAuthFetchInterceptor();

const root = ReactDOM.createRoot(document.getElementById('root')!);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
