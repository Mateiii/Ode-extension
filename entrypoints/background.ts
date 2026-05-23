import { saveQuickNote } from '@/lib/researchStorage';

export default defineBackground(() => {
  chrome.runtime.onInstalled.addListener(() => {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  });

  chrome.runtime.onStartup.addListener(() => {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  });

  chrome.runtime.onMessage.addListener((message, sender) => {
    if (!message || typeof message !== 'object') return;

    if (message.type === 'selection-action') {
      const sidepanelMessage = {
        type: 'sidepanel-selection-action',
        action: message.action,
        text: message.text,
        metadata: message.metadata,
        tabId: sender.tab?.id,
        url: sender.tab?.url,
        title: sender.tab?.title,
      };

      if (message.action === 'save-note') {
        saveQuickNote({
          text: message.text,
          metadata: message.metadata,
          url: sender.tab?.url,
          title: sender.tab?.title,
        }).then((note) => {
          chrome.runtime.sendMessage({
            ...sidepanelMessage,
            note,
          });
        });

        return true;
      }

      chrome.runtime.sendMessage(sidepanelMessage);
    }

    if (message.type === 'selection-context') {
      chrome.runtime.sendMessage({
        type: 'sidepanel-selection-context',
        text: message.text,
        metadata: message.metadata,
        tabId: sender.tab?.id,
        url: sender.tab?.url,
        title: sender.tab?.title,
      });
    }
  });
});
