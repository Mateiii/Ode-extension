import { factCheckClaim } from '@/lib/factCheck';
import type { PageMetadata } from '@/lib/pageMetadata';
import { summarizePageNotes } from '@/lib/pageNotes';
import { formatCitation, savePageNote } from '@/lib/researchStorage';
import { setPendingSidepanelAction } from '@/lib/sidepanelQueue';

type ExtractedPage = {
  metadata?: PageMetadata;
  title?: string;
  url?: string;
  text?: string;
};

async function openSidePanel(tabId?: number) {
  if (!tabId || !chrome.sidePanel.open) return;

  try {
    await chrome.sidePanel.open({ tabId });
    await new Promise((resolve) => globalThis.setTimeout(resolve, 150));
  } catch (error) {
    console.warn('Unable to open side panel for selection action.', error);
  }
}

function getActiveTab() {
  return new Promise<{ id?: number; title?: string; url?: string } | null>((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      resolve(tabs[0] ?? null);
    });
  });
}

function requestPageText(tabId: number): Promise<ExtractedPage> {
  return chrome.scripting
    .executeScript({
      target: { tabId },
      func: () => {
        const getMeta = (name: string) =>
          (document.querySelector(`meta[name="${name}"]`) as HTMLMetaElement | null)?.content ||
          (document.querySelector(`meta[property="${name}"]`) as HTMLMetaElement | null)?.content ||
          '';

        const metadata = {
          title: getMeta('og:title') || document.title || '',
          author:
            getMeta('author') ||
            getMeta('article:author') ||
            getMeta('dc.creator') ||
            getMeta('DC.creator') ||
            getMeta('parsely-author') ||
            getMeta('sailthru.author') ||
            getMeta('byl') ||
            getMeta('twitter:creator') ||
            '',
          canonicalUrl:
            (document.querySelector('link[rel="canonical"]') as HTMLLinkElement | null)?.href ||
            window.location.href,
        };

        const main =
          document.querySelector<HTMLElement>('main, article, [role="main"]') ?? document.body;
        const text = (main?.innerText || document.body?.innerText || '')
          .replace(/\n{3,}/g, '\n\n')
          .replace(/[ \t]{2,}/g, ' ')
          .trim();

        return {
          metadata,
          title: metadata.title || document.title || 'Untitled page',
          url: metadata.canonicalUrl || window.location.href,
          text,
        };
      },
    })
    .then((results) => {
      const result = results?.[0]?.result;
      if (!result) {
        throw new Error('Could not read this page. Try reloading it and trying again.');
      }
      return result as ExtractedPage;
    });
}


export default defineBackground(() => {
  chrome.runtime.onInstalled.addListener(() => {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  });

  chrome.runtime.onStartup.addListener(() => {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
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
      const tabId = sender.tab?.id;
      const openAndAnnounce = async (messageToSend = sidepanelMessage) => {
        const openingSidePanel = openSidePanel(tabId);
        await setPendingSidepanelAction(messageToSend);
        await openingSidePanel;
        chrome.runtime.sendMessage(messageToSend);
      };

      if (message.action === 'save-note') {
        openAndAnnounce();
        return true;
      }

      if (message.action === 'fact-check') {
        openAndAnnounce()
          .then(() => factCheckClaim(message.text))
          .then((result) => {
            chrome.runtime.sendMessage({
              ...sidepanelMessage,
              type: 'sidepanel-fact-check-result',
              result,
            });
          })
          .catch((error: unknown) => {
            chrome.runtime.sendMessage({
              ...sidepanelMessage,
              type: 'sidepanel-fact-check-result',
              error: error instanceof Error ? error.message : 'Fact check failed.',
            });
          });

        return true;
      }

      if (message.action === 'extract-citation') {
        const fallback = { title: sender.tab?.title, url: sender.tab?.url };
        const apa = formatCitation('apa', message.metadata as PageMetadata | undefined, fallback);
        const mla = formatCitation('mla', message.metadata as PageMetadata | undefined, fallback);
        const citationText = `> "${message.text}"\n\nAPA: ${apa}\n\nMLA: ${mla}`;
        const citationMessage = { ...sidepanelMessage, citationText };
        openSidePanel(tabId).then(async () => {
          await setPendingSidepanelAction(citationMessage);
          chrome.runtime.sendMessage(citationMessage);
        });
        return true;
      }

      openAndAnnounce();

      return true;
    }

    if (message.type === 'capture-page-note') {
      getActiveTab()
        .then((tab) => {
          if (!tab?.id) throw new Error('No active tab found.');
          return requestPageText(tab.id).then((page) => ({ tab, page }));
        })
        .then(({ tab, page }) =>
          summarizePageNotes(page.text ?? '', page.title || tab.title || '').then((body) =>
            savePageNote({
              text: body,
              folderId: typeof message.folderId === 'string' ? message.folderId : undefined,
              metadata: page.metadata,
              title: page.title || tab.title,
              url: page.url || tab.url,
            }),
          ),
        )
        .then((note) => {
          chrome.runtime.sendMessage({ type: 'sidepanel-page-note-result', note }, () => {
            void chrome.runtime.lastError;
          });
        })
        .catch((error: unknown) => {
          chrome.runtime.sendMessage(
            {
              type: 'sidepanel-page-note-result',
              error: error instanceof Error ? error.message : 'Could not take page notes.',
            },
            () => { void chrome.runtime.lastError; },
          );
        });

      return true;
    }

    // Sidepanel chat requests raw page text via the background so the
    // scripting call runs in the service-worker context (proven reliable).
    if (message.type === 'request-page-text') {
      getActiveTab()
        .then((tab) => {
          if (!tab?.id) return { text: '' };
          return requestPageText(tab.id)
            .then((page) => ({ text: page.text ?? '' }))
            .catch(() => ({ text: '' }));
        })
        .then((result) => sendResponse(result))
        .catch(() => sendResponse({ text: '' }));
      return true; // keep message channel open for async response
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
