import { useEffect, useState } from 'react';

const SETTINGS_STORAGE_KEY = 'appSettings';

export type Theme = 'light' | 'dark' | 'system';
export type CitationStyle = 'APA' | 'MLA' | 'Harvard' | 'BibTeX';
export type StorageMode = 'local' | 'cloud';
export type PanelAlignment = 'left' | 'right';

export type AppSettings = {
  theme: Theme;
  citationStyle: CitationStyle;
  storageMode: StorageMode;
  panelAlignment: PanelAlignment;
};

const DEFAULTS: AppSettings = {
  theme: 'system',
  citationStyle: 'APA',
  storageMode: 'local',
  panelAlignment: 'right',
};

function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === 'dark') {
    root.classList.add('dark');
  } else if (theme === 'light') {
    root.classList.remove('dark');
  } else {
    root.classList.toggle('dark', window.matchMedia('(prefers-color-scheme: dark)').matches);
  }
}

export function useSettings() {
  const [settings, setSettings] = useState<AppSettings>(DEFAULTS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    chrome.storage.local.get(SETTINGS_STORAGE_KEY, (result) => {
      const stored = result[SETTINGS_STORAGE_KEY] as Partial<AppSettings> | undefined;
      const merged: AppSettings = { ...DEFAULTS, ...stored };
      setSettings(merged);
      applyTheme(merged.theme);
      setLoaded(true);
    });
  }, []);

  useEffect(() => {
    if (!loaded) return;
    applyTheme(settings.theme);
    if (settings.theme !== 'system') return;

    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => {
      document.documentElement.classList.toggle('dark', e.matches);
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [settings.theme, loaded]);

  function updateSettings(patch: Partial<AppSettings>): void {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      chrome.storage.local.set({ [SETTINGS_STORAGE_KEY]: next });
      return next;
    });
  }

  return { settings, updateSettings };
}
