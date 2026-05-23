import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  vite: () => ({
    plugins: [tailwindcss()],
  }),
  manifest: {
    name: 'Ode AI Research Assistant',
    description: 'A Chromium side panel research assistant for AI chat, fact checks, notes, and citations.',
    permissions: ['sidePanel', 'storage', 'activeTab', 'scripting'],
    host_permissions: ['http://*/*', 'https://*/*'],
    action: {
      default_title: 'Open Ode Research',
    },
  },
});
