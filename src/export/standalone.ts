// Standalone entry point — exposes renderApp on window for <script> use (no modules)
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import App from '../App';

window.renderPropbookApp = (containerId: string) => {
  const container = document.getElementById(containerId);
  if (!container) {
    console.error('[PropBook] #root element not found');
    return;
  }
  const root = createRoot(container);
  root.render(createElement(App));
};
