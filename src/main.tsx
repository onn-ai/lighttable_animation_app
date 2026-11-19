import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './app/App';
import './app/styles/app.css';

const root = document.getElementById('root');
if (!root) throw new Error('LightTable root element is missing.');
createRoot(root).render(<React.StrictMode><App /></React.StrictMode>);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js').catch((error) => console.warn('Offline app worker could not be registered.', error));
  });
}
