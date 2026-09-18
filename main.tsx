import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Global uncaught error & unhandled rejection safety net to prevent browser crashes
if (typeof window !== 'undefined') {
  window.addEventListener('unhandledrejection', (event) => {
    console.warn('[Global Unhandled Rejection]', event.reason);
    event.preventDefault();
  });
  window.addEventListener('error', (event) => {
    console.warn('[Global Uncaught Error]', event.error || event.message);
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

