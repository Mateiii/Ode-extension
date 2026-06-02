import { scrapePageMetadata } from '@/lib/pageMetadata';

export default defineContentScript({
  matches: ['http://*/*', 'https://*/*'],
  main() {
    const bar = document.createElement('div');
    const shadow = bar.attachShadow({ mode: 'open' });
    let selectedText = '';

    shadow.innerHTML = `
      <style>
        :host {
          all: initial;
        }

        .bar {
          align-items: center;
          background: #0f172a;
          border: 1px solid rgba(148, 163, 184, 0.28);
          border-radius: 8px;
          box-shadow: 0 12px 30px rgba(15, 23, 42, 0.22);
          box-sizing: border-box;
          display: none;
          gap: 4px;
          padding: 4px;
          position: fixed;
          z-index: 2147483647;
        }

        button {
          background: transparent;
          border: 0;
          border-radius: 6px;
          color: #f8fafc;
          cursor: pointer;
          font: 500 12px/1.2 Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          padding: 7px 9px;
          white-space: nowrap;
        }

        button:hover {
          background: rgba(248, 250, 252, 0.12);
        }
      </style>
      <div class="bar" part="bar">
        <button data-action="ask-ai" type="button">Ask AI</button>
        <button data-action="fact-check" type="button">Fact Check</button>
        <button data-action="save-note" type="button">Save to Notes</button>
      </div>
    `;

    document.documentElement.append(bar);

    const actionBar = shadow.querySelector<HTMLElement>('.bar')!;

    const hideBar = () => {
      actionBar.style.display = 'none';
    };

    const showBar = (selection: Selection) => {
      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();

      if (rect.width === 0 && rect.height === 0) {
        hideBar();
        return;
      }

      actionBar.style.display = 'flex';

      const barRect = actionBar.getBoundingClientRect();
      const top = Math.max(8, rect.top - barRect.height - 10);
      const left = Math.min(
        window.innerWidth - barRect.width - 8,
        Math.max(8, rect.left + rect.width / 2 - barRect.width / 2),
      );

      actionBar.style.top = `${top}px`;
      actionBar.style.left = `${left}px`;
    };

    const getSelectedText = () => window.getSelection()?.toString().trim() ?? '';

    const sendSelectionContext = () => {
      if (selectedText.length === 0) return;

      chrome.runtime.sendMessage({
        type: 'selection-context',
        text: selectedText,
        metadata: scrapePageMetadata(),
      });
    };

    const extractPageText = () => {
      const metadata = scrapePageMetadata();
      const main =
        document.querySelector<HTMLElement>('main, article, [role="main"]') ?? document.body;
      const text = (main?.innerText || document.body.innerText || '')
        .replace(/\n{3,}/g, '\n\n')
        .replace(/[ \t]{2,}/g, ' ')
        .trim();

      return {
        metadata,
        title: metadata.title || document.title || 'Untitled page',
        url: metadata.canonicalUrl || window.location.href,
        text,
      };
    };

    const updateSelection = () => {
      const selection = window.getSelection();
      selectedText = getSelectedText();

      if (!selection || selection.rangeCount === 0 || selectedText.length === 0) {
        hideBar();
        return;
      }

      showBar(selection);
    };

    document.addEventListener('selectionchange', () => {
      window.setTimeout(updateSelection, 0);
    });

    document.addEventListener('mouseup', () => {
      window.setTimeout(() => {
        updateSelection();
        sendSelectionContext();
      }, 0);
    });

    document.addEventListener('scroll', hideBar, { passive: true });

    shadow.addEventListener('click', (event) => {
      const target = event.target as HTMLElement;
      const action = target.dataset.action;

      if (!action || selectedText.length === 0) return;

      chrome.runtime.sendMessage({
        type: 'selection-action',
        action,
        text: selectedText,
        metadata: scrapePageMetadata(),
      });
    });

    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (!message || typeof message !== 'object' || message.type !== 'extract-page-notes') return;

      sendResponse(extractPageText());
    });
  },
});
