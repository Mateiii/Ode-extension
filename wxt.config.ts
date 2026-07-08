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
    permissions: ['sidePanel', 'storage', 'activeTab', 'scripting', 'contextMenus'],
    host_permissions: ['file://*/*', 'http://*/*', 'https://*/*'],
    action: {
      default_title: 'Open Ode Research',
      default_icon: {
        16: 'icon/16.png',
        32: 'icon/32.png',
        48: 'icon/48.png',
        128: 'icon/128.png',
      },
    },
  },
});
