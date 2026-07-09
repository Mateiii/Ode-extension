import { scrapePageMetadata } from '@/lib/pageMetadata';

export default defineContentScript({
  matches: ['http://*/*', 'https://*/*'],
  main() {
    // Abort on non-HTML documents (XML feeds, S3 error pages, JSON APIs,
    // plain-text responses): no <body> to inject into, and the toolbar's
    // text nodes would corrupt the raw document tree / clipboard copies.
    const contentType = document.contentType?.toLowerCase() ?? '';
    const rootTag = document.documentElement?.nodeName ?? '';
    if (
      rootTag !== 'HTML' ||
      contentType.includes('xml') ||
      contentType.includes('json') ||
      contentType.includes('text/plain')
    ) {
      return;
    }

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
          background: oklch(0.151 0.022 247);
          border: 1px solid oklch(0.640 0.015 248 / 0.24);
          border-radius: 8px;
          box-shadow: 0 8px 24px oklch(0.151 0.022 247 / 0.28), 0 2px 6px oklch(0.151 0.022 247 / 0.14);
          box-sizing: border-box;
          display: flex;
          gap: 2px;
          opacity: 0;
          padding: 4px;
          pointer-events: none;
          position: fixed;
          transform: translateY(5px) scale(0.97);
          transition: opacity 130ms cubic-bezier(0.16, 1, 0.3, 1), transform 130ms cubic-bezier(0.16, 1, 0.3, 1);
          z-index: 2147483647;
        }

        .bar.bar--visible {
          opacity: 1;
          pointer-events: auto;
          transform: none;
        }

        @media (prefers-reduced-motion: reduce) {
          .bar {
            transition: none;
          }
        }

        .sep {
          background: oklch(1.000 0.000 0 / 0.14);
          border-radius: 1px;
          flex-shrink: 0;
          height: 16px;
          margin: 0 2px;
          width: 1px;
        }

        button {
          background: transparent;
          border: 0;
          border-radius: 6px;
          color: oklch(0.855 0.007 248);
          cursor: pointer;
          font: 600 12px/1 Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          min-height: 28px;
          padding: 0 9px;
          transition: background 120ms cubic-bezier(0.16, 1, 0.3, 1), color 120ms cubic-bezier(0.16, 1, 0.3, 1);
          white-space: nowrap;
        }

        button:hover {
          background: oklch(1.000 0.000 0 / 0.10);
          color: oklch(1.000 0.000 0);
        }

        button:focus-visible {
          outline: 2px solid oklch(0.51 0.11 89);
          outline-offset: 2px;
        }

        button:disabled {
          cursor: not-allowed;
          opacity: 0.55;
        }

        button:disabled:hover {
          background: transparent;
          color: oklch(0.855 0.007 248);
        }

        button[data-action="ask-ai"] {
          background: oklch(0.51 0.11 89);
          color: oklch(1.000 0.000 0);
          font-weight: 700;
        }

        button[data-action="ask-ai"]:hover {
          background: oklch(0.44 0.10 89);
          color: oklch(1.000 0.000 0);
        }
      </style>
      <div class="bar" part="bar">
        <button data-action="ask-ai" type="button">Ask AI</button>
        <span class="sep" aria-hidden="true"></span>
        <button data-action="fact-check" type="button">Fact Check</button>
        <button data-action="save-note" type="button">Save to Notes</button>
        <button data-action="extract-citation" type="button">Cite</button>
      </div>
    `;

    document.documentElement.append(bar);

    const FACT_CHECK_MAX_LENGTH = 400;

    const actionBar = shadow.querySelector<HTMLElement>('.bar')!;
    const factCheckBtn = shadow.querySelector<HTMLButtonElement>('[data-action="fact-check"]')!;

    const hideBar = () => {
      actionBar.classList.remove('bar--visible');
    };

    const showBar = (selection: Selection) => {
      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();

      if (rect.width === 0 && rect.height === 0) {
        hideBar();
        return;
      }

      const barRect = actionBar.getBoundingClientRect();
      const top = Math.max(8, rect.top - barRect.height - 10);
      const left = Math.min(
        window.innerWidth - barRect.width - 8,
        Math.max(8, rect.left + rect.width / 2 - barRect.width / 2),
      );

      actionBar.style.top = `${top}px`;
      actionBar.style.left = `${left}px`;
      actionBar.classList.add('bar--visible');
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

      const tooLong = selectedText.length > FACT_CHECK_MAX_LENGTH;
      factCheckBtn.disabled = tooLong;
      factCheckBtn.textContent = tooLong ? 'Text too long' : 'Fact Check';

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
      if ((target as HTMLButtonElement).disabled) return;

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
