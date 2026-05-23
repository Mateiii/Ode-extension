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
      chrome.runtime.sendMessage({
        type: 'sidepanel-selection-action',
        action: message.action,
        text: message.text,
        tabId: sender.tab?.id,
        url: sender.tab?.url,
        title: sender.tab?.title,
      });
    }
  });
});
