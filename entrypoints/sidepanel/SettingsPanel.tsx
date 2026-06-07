import React from 'react';
import { Crown } from 'lucide-react';
import type { AppSettings } from '@/lib/useSettings';

type Props = {
  settings: AppSettings;
  updateSettings: (patch: Partial<AppSettings>) => void;
  isPremiumUser: boolean;
};

export function SettingsPanel({ settings, updateSettings, isPremiumUser }: Props) {
  return (
    <section className="settings-panel" aria-label="Settings">

      {/* Appearance */}
      <div className="settings-section">
        <p className="settings-section-label">Appearance</p>

        <div className="settings-row">
          <label className="settings-field-label" htmlFor="theme-select">Theme</label>
          <select
            id="theme-select"
            className="settings-select"
            value={settings.theme}
            onChange={(e) => updateSettings({ theme: e.target.value as AppSettings['theme'] })}
          >
            <option value="system">System default</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </div>

        <div className="settings-row">
          <label className="settings-field-label" htmlFor="citation-select">Default citation style</label>
          <select
            id="citation-select"
            className="settings-select"
            value={settings.citationStyle}
            onChange={(e) => updateSettings({ citationStyle: e.target.value as AppSettings['citationStyle'] })}
          >
            <option value="APA">APA</option>
            <option value="MLA">MLA</option>
            <option value="Harvard">Harvard</option>
            <option value="BibTeX">BibTeX</option>
          </select>
        </div>
      </div>

      {/* Layout */}
      <div className="settings-section">
        <p className="settings-section-label">Layout</p>

        <div className="settings-row">
          <span className="settings-field-label">Panel alignment</span>
          <div className="settings-pill-group" role="group" aria-label="Panel alignment">
            <button
              aria-pressed={settings.panelAlignment === 'left'}
              className={`settings-pill-btn${settings.panelAlignment === 'left' ? ' active' : ''}`}
              onClick={() => updateSettings({ panelAlignment: 'left' })}
              type="button"
            >
              Left
            </button>
            <button
              aria-pressed={settings.panelAlignment === 'right'}
              className={`settings-pill-btn${settings.panelAlignment === 'right' ? ' active' : ''}`}
              onClick={() => updateSettings({ panelAlignment: 'right' })}
              type="button"
            >
              Right
            </button>
          </div>
        </div>
      </div>

      {/* Storage */}
      <div className="settings-section">
        <p className="settings-section-label">Storage</p>

        <div className={`settings-row${isPremiumUser ? '' : ' settings-row--disabled'}`}>
          <div>
            <label
              className="settings-field-label"
              htmlFor={isPremiumUser ? 'cloud-toggle' : undefined}
            >
              Cloud storage sync
            </label>
            <p className="settings-field-hint">
              {isPremiumUser
                ? 'Sync notes and sources across all your devices'
                : 'Local only — upgrade to sync across devices'}
            </p>
          </div>
          <button
            id="cloud-toggle"
            role="switch"
            aria-checked={settings.storageMode === 'cloud'}
            aria-disabled={!isPremiumUser}
            className={`settings-switch${settings.storageMode === 'cloud' ? ' settings-switch--on' : ''}`}
            disabled={!isPremiumUser}
            onClick={() =>
              updateSettings({ storageMode: settings.storageMode === 'cloud' ? 'local' : 'cloud' })
            }
            type="button"
          >
            <span className="settings-switch-thumb" />
            <span className="sr-only">
              {settings.storageMode === 'cloud' ? 'Disable cloud sync' : 'Enable cloud sync'}
            </span>
          </button>
        </div>

        {!isPremiumUser && (
          <div className="settings-upgrade-card">
            <div className="settings-upgrade-header">
              <Crown aria-hidden="true" className="settings-upgrade-icon" size={15} />
              <strong>Unlock Cloud Sync</strong>
            </div>
            <p className="settings-upgrade-desc">
              Upgrade to Øde Pro and access your notes, sources, and research from any
              device — automatically kept in sync.
            </p>
            <button className="settings-upgrade-cta" type="button">
              Upgrade to Pro →
            </button>
          </div>
        )}
      </div>

    </section>
  );
}
