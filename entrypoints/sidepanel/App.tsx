import React, { FormEvent, useEffect, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  BookmarkPlus,
  BookOpen,
  Check,
  ChevronDown,
  Clipboard,
  Download,
  ExternalLink,
  FileDown,
  FilePlus,
  FileText,
  Layers,
  Pencil,
  Pin,
  Plus,
  Send,
  Settings,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import type { FactCheckResult } from '@/lib/factCheck';
import type { PageMetadata } from '@/lib/pageMetadata';
import {
  ensureProjectSourcesFolders,
  formatCitation,
  createNoteFolder,
  createProject,
  deleteNoteFolder,
  deleteProject,
  deleteQuickNote,
  getNoteTitle,
  getQuickNotes,
  moveQuickNote,
  pinQuickNote,
  resolveNoteTitle,
  saveQuickNote,
  swapQuickNotes,
  updateQuickNote,
  ACTIVE_PROJECT_STORAGE_KEY,
  DEFAULT_FOLDER_ID,
  DEFAULT_PROJECT_ID,
  NOTE_FOLDERS_STORAGE_KEY,
  PROJECTS_STORAGE_KEY,
  QUICK_NOTES_STORAGE_KEY,
  type NoteFolder,
  type Project,
  type QuickNote,
} from '@/lib/researchStorage';
import { formatBibtexBundle } from '@/lib/bibtex';
import { streamPageChat } from '@/lib/pageChat';
import { clearPendingSidepanelAction, getPendingSidepanelAction } from '@/lib/sidepanelQueue';
import { extractFileText, extractTextFromPdfUrl } from '@/lib/fileParsers';

type ChatMessage = {
  id: string;
  role: 'assistant' | 'user';
  content: string;
  factCheck?: FactCheckResult;
  error?: string;
  loading?: boolean;
  pendingActionKey?: string;
};

type SelectionMessage = {
  type: 'sidepanel-selection-action';
  action: 'ask-ai' | 'fact-check' | 'save-note' | 'extract-citation';
  text: string;
  citationText?: string;
  metadata?: PageMetadata;
  note?: QuickNote;
  title?: string;
  url?: string;
};

type SelectionContextMessage = {
  type: 'sidepanel-selection-context';
  text: string;
  metadata?: PageMetadata;
  title?: string;
  url?: string;
};

type FactCheckResultMessage = Omit<SelectionMessage, 'type' | 'action' | 'note'> & {
  type: 'sidepanel-fact-check-result';
  result?: FactCheckResult;
  error?: string;
};

type PageNoteResultMessage = {
  type: 'sidepanel-page-note-result';
  note?: QuickNote;
  error?: string;
};

type RuntimeMessage = SelectionMessage | SelectionContextMessage | FactCheckResultMessage | PageNoteResultMessage;
type ActiveTab = 'chat' | 'notes' | 'source';

const actionLabels: Record<SelectionMessage['action'], string> = {
  'ask-ai': 'Ask AI',
  'fact-check': 'Fact Check',
  'save-note': 'Save to Notes',
  'extract-citation': 'Cite',
};

const initialMessages: ChatMessage[] = [
  {
    id: 'welcome',
    role: 'assistant',
    content: 'Select text on a page or start a research question here.',
  },
];

function getActionKey(message: Pick<SelectionMessage, 'action' | 'text'>) {
  return `${message.action}:${message.text}`;
}

/** Matches [label](#scroll-quote=exact phrase) emitted by the AI. */
const SCROLL_QUOTE_RE = /\[([^\]]+)\]\(#scroll-quote=([^)]+)\)/g;

/**
 * Short phrases that mean "navigate to the text you just quoted" rather than
 * asking a new question. Checked before sending to the AI.
 */
const NAV_INTENT_RE =
  /^(take me there|show me( where)?|go there|scroll to (it|that)|bring me there|navigate there|go to that( part)?|jump to (it|that)|where is (it|that)|show (me )?(where it is|that part)|highlight it|jump there|find it on the page)[\s.!?]*$/i;

/**
 * Execute a scroll-and-highlight in the active browser tab.
 * Extracted to module level so both `sendChatMessage` and `handleScrollToQuote`
 * can call it without ordering issues.
 */
function executeScrollToQuote(quote: string) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tabId = tabs[0]?.id;
    if (!tabId) return;
    chrome.scripting.executeScript(
      {
        target: { tabId },
        func: (quotedText: string) => {
          // 1. Native Chromium "Scroll to Text Fragment" attempt.
          try {
            window.location.hash = `:~:text=${encodeURIComponent(quotedText)}`;
          } catch {
            /* some pages disallow hash writes — fall through to DOM search */
          }

          // 2. Reliable fallback: case-insensitive DOM text search + smooth scroll + highlight.
          const win = window as Window & { find?: (...a: unknown[]) => boolean };
          const found =
            win.find?.(quotedText, false, false, true, false, true, false) ??
            win.find?.(quotedText.slice(0, 60), false, false, true, false, true, false);
          if (!found) return;

          const sel = window.getSelection();
          if (!sel || sel.rangeCount === 0) return;

          const node = sel.getRangeAt(0).commonAncestorContainer;
          const el: HTMLElement | null =
            node.nodeType === Node.ELEMENT_NODE
              ? (node as HTMLElement)
              : (node as Text).parentElement;
          if (!el) return;

          el.scrollIntoView({ behavior: 'smooth', block: 'center' });

          const prevOutline = el.style.outline;
          const prevBorderRadius = el.style.borderRadius;
          el.style.outline = '2px solid rgba(251, 191, 36, 0.85)';
          el.style.borderRadius = '3px';
          setTimeout(() => {
            el.style.outline = prevOutline;
            el.style.borderRadius = prevBorderRadius;
          }, 2000);
        },
        args: [quote],
      },
      () => { void chrome.runtime.lastError; },
    );
  });
}

/**
 * Split a single line of AI text into an array of React nodes, turning any
 * #scroll-quote markdown links into clickable <a> elements.
 */
function parseScrollLinks(
  text: string,
  onQuoteClick: (quote: string) => void,
  keyPrefix: string,
): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;
  SCROLL_QUOTE_RE.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = SCROLL_QUOTE_RE.exec(text)) !== null) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index));

    const label = match[1];
    const rawQuote = match[2];
    const quote = decodeURIComponent(rawQuote);

    nodes.push(
      <a
        className="scroll-quote-link"
        href="#"
        key={`${keyPrefix}-sq-${match.index}`}
        onClick={(e) => { e.preventDefault(); onQuoteClick(quote); }}
        title="Click to jump to this text on the page"
      >
        {label}
      </a>,
    );
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes.length ? nodes : [text];
}

/**
 * Fallback post-processor: if the model returned plain-quoted text that exists
 * verbatim in the page, convert it to a scroll-quote link automatically.
 * Handles ASCII `"…"` and curly `"…"` quote pairs.
 */
const PLAIN_QUOTE_RE = /["“]([^"“”\n]{10,200})["”]/g;

function injectScrollQuotes(text: string, pageText: string): string {
  if (!pageText) return text;
  const pageNorm = pageText.toLowerCase();

  return text.replace(PLAIN_QUOTE_RE, (match, quoted: string) => {
    const phrase = quoted.trim().replace(/[.!?,;:]+$/, ''); // strip trailing punctuation
    if (phrase.length < 10) return match;
    // Skip if already wrapped as a scroll-quote link
    if (text.includes(`(#scroll-quote=${phrase}`)) return match;
    if (pageNorm.includes(phrase.toLowerCase())) {
      return `[${phrase}](#scroll-quote=${phrase})`;
    }
    return match;
  });
}

/** Strip [label](#scroll-quote=phrase) links from AI output before saving to notes. */
function stripScrollQuotes(text: string): string {
  return text.replace(/\[([^\]]+)\]\(#scroll-quote=[^)]+\)/g, '$1');
}

const QUICK_ACTIONS = [
  {
    label: 'Summarize Page',
    prompt: 'Summarize the main points of this page in clear bullet points.',
  },
  {
    label: 'List Limitations',
    prompt: 'What are the key limitations, weaknesses, or caveats mentioned on this page?',
  },
] as const;

function isPdfUrl(url: string): boolean {
  // Only handle http/https — file:// URLs can't be fetch()ed from extension pages.
  if (!url.startsWith('http://') && !url.startsWith('https://')) return false;
  try {
    return new URL(url).pathname.toLowerCase().endsWith('.pdf');
  } catch {
    return false;
  }
}

function pdfFilenameFromUrl(url: string): string {
  try {
    const parts = new URL(url).pathname.split('/');
    return parts[parts.length - 1] || 'document.pdf';
  } catch {
    return 'document.pdf';
  }
}

function App() {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [context, setContext] = useState<SelectionContextMessage | null>(null);
  const [notes, setNotes] = useState<QuickNote[]>([]);
  const [folders, setFolders] = useState<NoteFolder[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string>(DEFAULT_PROJECT_ID);
  const [selectedFolderId, setSelectedFolderId] = useState(DEFAULT_FOLDER_ID);
  const [activeTab, setActiveTab] = useState<ActiveTab>('chat');
  const [isContextExpanded, setIsContextExpanded] = useState(false);
  const [input, setInput] = useState('');
  const [newFolderName, setNewFolderName] = useState('');
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [noteStatus, setNoteStatus] = useState('');
  const [isTakingPageNotes, setIsTakingPageNotes] = useState(false);
  const [expandedNotes, setExpandedNotes] = useState<Set<string>>(new Set());
  const [folderPendingDelete, setFolderPendingDelete] = useState<NoteFolder | null>(null);
  const [projectPendingDelete, setProjectPendingDelete] = useState<Project | null>(null);
  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [toast, setToast] = useState('');
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');
  const [editingTitleText, setEditingTitleText] = useState('');
  const [isCreatingNote, setIsCreatingNote] = useState(false);
  const [newNoteTitle, setNewNoteTitle] = useState('');
  const [newNoteText, setNewNoteText] = useState('');
  const [scrollToNoteId, setScrollToNoteId] = useState<string | null>(null);
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [fileText, setFileText] = useState<string | null>(null);
  const [fileSourceName, setFileSourceName] = useState<string | null>(null);
  const [isFileLoading, setIsFileLoading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [savingMessageId, setSavingMessageId] = useState<string | null>(null);
  const [saveAiFolderId, setSaveAiFolderId] = useState(DEFAULT_FOLDER_ID);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatInputRef = useRef<HTMLTextAreaElement>(null);
  const fileSourceIsAutoRef = useRef(false);
  const handledActionKeysRef = useRef<Set<string>>(new Set());
  const toastTimerRef = useRef<number | undefined>(undefined);
  const selectedFolderIdRef = useRef(selectedFolderId);
  const scrollRef = useRef<HTMLDivElement>(null);
  const chatAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    selectedFolderIdRef.current = selectedFolderId;
  }, [selectedFolderId]);

  // Auto-ingest web-hosted PDFs when the active tab is a PDF URL.
  useEffect(() => {
    let lastIngestedUrl = '';

    const tryIngestTab = async (url: string | undefined) => {
      if (!url || !isPdfUrl(url)) {
        // Navigated away from a PDF — only clear if the source was auto-loaded.
        if (fileSourceIsAutoRef.current) {
          setFileText(null);
          setFileSourceName(null);
          fileSourceIsAutoRef.current = false;
          if (fileInputRef.current) fileInputRef.current.value = '';
        }
        return;
      }

      // Skip if already loaded this exact URL.
      if (url === lastIngestedUrl) return;
      lastIngestedUrl = url;

      fileSourceIsAutoRef.current = true;
      setIsFileLoading(true);
      const filename = pdfFilenameFromUrl(url);

      try {
        const text = await extractTextFromPdfUrl(url);
        setFileText(text);
        setFileSourceName(filename);
        setToast(`Auto-loaded: ${filename}`);
        window.clearTimeout(toastTimerRef.current);
        toastTimerRef.current = window.setTimeout(() => setToast(''), 3000);
      } catch {
        setToast('Could not extract PDF from this tab.');
        window.clearTimeout(toastTimerRef.current);
        toastTimerRef.current = window.setTimeout(() => setToast(''), 3000);
        lastIngestedUrl = ''; // allow retry on next activation
        fileSourceIsAutoRef.current = false;
      } finally {
        setIsFileLoading(false);
      }
    };

    // Check current tab on mount.
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      void tryIngestTab(tabs[0]?.url);
    });

    // Fired when the user switches tabs.
    const onActivated = ({ tabId }: { tabId: number; windowId: number }) => {
      chrome.tabs.get(tabId, (tab) => {
        void tryIngestTab(tab.url);
      });
    };
    chrome.tabs.onActivated.addListener(onActivated);

    // Fired when the active tab navigates to a new URL.
    const onUpdated = (
      _tabId: number,
      changeInfo: { status?: string; url?: string },
      tab: { active?: boolean; url?: string },
    ) => {
      if (tab.active && changeInfo.status === 'complete') {
        void tryIngestTab(tab.url);
      }
    };
    chrome.tabs.onUpdated.addListener(onUpdated);

    return () => {
      chrome.tabs.onActivated.removeListener(onActivated);
      chrome.tabs.onUpdated.removeListener(onUpdated);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const showToast = (text: string) => {
    setToast(text);
    window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(''), 3000);
  };

  // Persist active project ID whenever it changes
  useEffect(() => {
    chrome.storage.local.set({ [ACTIVE_PROJECT_STORAGE_KEY]: activeProjectId });
  }, [activeProjectId]);

  useEffect(() => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (!tab?.id) return;
      chrome.scripting.executeScript(
        {
          target: { tabId: tab.id },
          func: () => {
            const getMeta = (...selectors: string[]) => {
              for (const sel of selectors) {
                const val = (document.querySelector(sel) as HTMLMetaElement | null)?.content?.trim();
                if (val) return val;
              }
              return '';
            };

            const byPrefix = /^(by|author|authored by|written by|posted by|from)\s*:?\s*/i;
            const cleanAuthor = (s: string) => s.replace(byPrefix, '').replace(/\s+/g, ' ').trim();
            const plausible = (s: string) => s.length > 1 && s.length < 100 && !/[{}[\]<>]/.test(s);

            const scrapeAuthor = (): string => {
              const fromMeta = getMeta(
                'meta[name="author"]',
                'meta[property="article:author"]',
                'meta[name="citation_author"]',
                'meta[name="byl"]',
                'meta[name="dc.creator"]',
                'meta[name="DC.creator"]',
                'meta[name="dcterms.creator"]',
                'meta[name="parsely-author"]',
                'meta[name="sailthru.author"]',
                'meta[name="twitter:creator"]',
              );
              if (fromMeta) return fromMeta;

              for (const script of Array.from(document.querySelectorAll('script[type="application/ld+json"]'))) {
                try {
                  const data: unknown = JSON.parse((script as HTMLScriptElement).textContent ?? '');
                  const items = Array.isArray(data) ? data : [data];
                  for (const item of items) {
                    if (typeof item !== 'object' || item === null) continue;
                    const raw = (item as Record<string, unknown>).author;
                    if (!raw) continue;
                    let name = '';
                    if (typeof raw === 'string') name = raw.trim();
                    else if (!Array.isArray(raw) && typeof raw === 'object') name = String((raw as Record<string, unknown>).name ?? '').trim();
                    else if (Array.isArray(raw) && raw.length > 0) {
                      const first = raw[0];
                      name = typeof first === 'string' ? first.trim() : String((first as Record<string, unknown>).name ?? '').trim();
                    }
                    if (name && plausible(name)) return name;
                  }
                } catch { /* skip malformed */ }
              }

              const relAuthor = document.querySelector<HTMLAnchorElement>('a[rel="author"]');
              if (relAuthor) {
                const t = cleanAuthor(relAuthor.textContent?.trim() ?? '');
                if (plausible(t)) return t;
              }

              const itemAuthor = document.querySelector<HTMLElement>('[itemprop="author"]');
              if (itemAuthor) {
                const nameEl = itemAuthor.querySelector<HTMLElement>('[itemprop="name"]');
                const t = cleanAuthor((nameEl ?? itemAuthor).textContent?.trim() ?? '');
                if (plausible(t)) return t;
              }

              for (const sel of [
                '[class*="byline"] [class*="author"]',
                '[class*="byline"] [class*="name"]',
                '[class*="author-name"]',
                '[class*="authorName"]',
                '[class*="author__name"]',
                '[data-testid*="byline"]',
                '[data-testid*="author"]',
                '.author-name',
                '.byline__name',
                '.author',
                '.byline',
              ]) {
                try {
                  const el = document.querySelector<HTMLElement>(sel);
                  if (!el) continue;
                  const t = cleanAuthor(el.textContent?.replace(/\s+/g, ' ').trim() ?? '');
                  if (plausible(t)) return t;
                } catch { /* skip */ }
              }

              return '';
            };

            return {
              title: document.title.trim() || getMeta('meta[property="og:title"]', 'meta[name="twitter:title"]', 'meta[name="citation_title"]') || '',
              author: scrapeAuthor(),
              canonicalUrl:
                (document.querySelector('link[rel="canonical"]') as HTMLLinkElement | null)?.href ||
                getMeta('meta[property="og:url"]') ||
                window.location.href,
              publishedDate: getMeta(
                'meta[property="article:published_time"]',
                'meta[name="citation_publication_date"]',
                'meta[name="date"]',
                'meta[name="dc.date"]',
                'meta[name="DC.date.issued"]',
              ) || '',
              siteName: getMeta('meta[property="og:site_name"]', 'meta[name="application-name"]', 'meta[name="twitter:site"]') || window.location.hostname,
            };
          },
        },
        (results) => {
          void chrome.runtime.lastError;
          const meta = results?.[0]?.result;
          if (!meta) return;
          setContext((current) =>
            current
              ? current
              : {
                  type: 'sidepanel-selection-context',
                  text: '',
                  metadata: meta,
                  title: (meta as { title?: string }).title || tab.title,
                  url: (meta as { canonicalUrl?: string }).canonicalUrl || tab.url,
                },
          );
        },
      );
    });

    // Load all data and active project in parallel; ensureProjectSourcesFolders runs
    // the Sources-folder migration and returns fresh projects + folders in one go.
    const loadInitialData = async () => {
      const [storedNotes, { projects: storedProjects, folders: storedFolders }] = await Promise.all([
        getQuickNotes(),
        ensureProjectSourcesFolders(),
      ]);

      const storedActiveId = await new Promise<string>((resolve) => {
        chrome.storage.local.get([ACTIVE_PROJECT_STORAGE_KEY], (result) => {
          resolve((result[ACTIVE_PROJECT_STORAGE_KEY] as string | undefined) ?? DEFAULT_PROJECT_ID);
        });
      });

      setNotes(storedNotes);
      setFolders(storedFolders);
      setProjects(storedProjects);

      const validProjectId = storedProjects.some((p) => p.id === storedActiveId)
        ? storedActiveId
        : storedProjects[0]?.id ?? DEFAULT_PROJECT_ID;

      setActiveProjectId(validProjectId);

      const activeProject = storedProjects.find((p) => p.id === validProjectId);
      const projectFolders = storedFolders.filter((f) => f.projectId === validProjectId);

      setSelectedFolderId((current) => {
        const currentIsInProject = projectFolders.some((f) => f.id === current);
        return currentIsInProject
          ? current
          : activeProject?.defaultFolderId ?? projectFolders[0]?.id ?? DEFAULT_FOLDER_ID;
      });
    };

    void loadInitialData();

    const listener = (
      changes: Record<string, { oldValue?: unknown; newValue?: unknown }>,
      areaName: string,
    ) => {
      if (areaName !== 'local') return;
      if (changes[QUICK_NOTES_STORAGE_KEY]) {
        setNotes((changes[QUICK_NOTES_STORAGE_KEY].newValue as QuickNote[] | undefined) ?? []);
      }
      if (changes[NOTE_FOLDERS_STORAGE_KEY]) {
        setFolders((changes[NOTE_FOLDERS_STORAGE_KEY].newValue as NoteFolder[] | undefined) ?? []);
      }
      if (changes[PROJECTS_STORAGE_KEY]) {
        setProjects((changes[PROJECTS_STORAGE_KEY].newValue as Project[] | undefined) ?? []);
      }
    };

    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, []);

  useEffect(() => {
    const handleSelectionAction = (message: SelectionMessage) => {
      const actionKey = getActionKey(message);
      if (handledActionKeysRef.current.has(actionKey)) return;
      handledActionKeysRef.current.add(actionKey);

      setContext({
        type: 'sidepanel-selection-context',
        text: message.text,
        metadata: message.metadata,
        title: message.title,
        url: message.url,
      });

      if (message.action === 'save-note') {
        const targetFolderId = selectedFolderIdRef.current || DEFAULT_FOLDER_ID;
        setSelectedFolderId(targetFolderId);
        setActiveTab('notes');

        const _now = new Date();
        const _MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        const _ts = `${_MONTHS[_now.getMonth()]} ${_now.getDate()}, ${String(_now.getHours()).padStart(2,'0')}:${String(_now.getMinutes()).padStart(2,'0')}`;
        const _raw = message.text.replace(/\s+/g, ' ').trim();
        const _short = _raw.length > 35 ? _raw.slice(0, 34).trimEnd() + '…' : _raw;
        const selectionCustomTitle = `[${_ts}] ${_short}`;

        resolveNoteTitle(selectionCustomTitle, targetFolderId)
          .then((customTitle) => saveQuickNote({
            text: message.text,
            metadata: message.metadata,
            url: message.url,
            title: message.title,
            folderId: targetFolderId,
            customTitle,
          }))
          .then((note) => {
            setExpandedNotes((current) => {
              const next = new Set(current);
              next.add(note.id);
              return next;
            });
            showToast('Saved to notes.');
          })
          .catch(() => {
            showToast('Could not save note.');
          });
      }

      if (message.action === 'ask-ai') {
        setActiveTab('chat');
        const quoted = `> "${message.text.trim()}"\n\n`;
        setInput(quoted);
        window.setTimeout(() => {
          const el = chatInputRef.current;
          if (el) {
            el.focus();
            el.setSelectionRange(el.value.length, el.value.length);
          }
        }, 100);
        return;
      }

      if (message.action === 'extract-citation') {
        const targetFolderId = selectedFolderIdRef.current || DEFAULT_FOLDER_ID;
        setSelectedFolderId(targetFolderId);
        setActiveTab('notes');

        const citationRawTitle = message.metadata?.title || message.title || 'Citation';
        resolveNoteTitle(citationRawTitle, targetFolderId)
          .then((customTitle) => saveQuickNote({
            text: message.citationText || '',
            folderId: targetFolderId,
            kind: 'citation',
            metadata: message.metadata,
            url: message.url,
            title: message.title,
            customTitle,
          }))
          .then((note) => {
            setExpandedNotes((current) => {
              const next = new Set(current);
              next.add(note.id);
              return next;
            });
            showToast('Citation saved to notes.');
          })
          .catch(() => {
            showToast('Could not save citation.');
        });

        return;
      }

      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: 'user',
          content: `${actionLabels[message.action]}: "${message.text}"`,
        },
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          content:
            message.action === 'save-note'
              ? 'Saved to Quick Notes.'
              : 'Checking the highlighted claim...',
          loading: message.action === 'fact-check',
          pendingActionKey: message.action === 'fact-check' ? actionKey : undefined,
        },
      ]);
    };

    getPendingSidepanelAction().then((pendingAction) => {
      if (!pendingAction) return;
      const message = pendingAction.message as RuntimeMessage;
      if (message?.type === 'sidepanel-selection-action') {
        handleSelectionAction(message);
        clearPendingSidepanelAction(pendingAction.id);
      }
    });

    const listener = (message: RuntimeMessage) => {
      if (message.type === 'sidepanel-selection-context') {
        setContext(message);
        return;
      }

      if (message.type === 'sidepanel-fact-check-result') {
        setActiveTab('chat');
        setMessages((current) => {
          const actionKey = getActionKey({ action: 'fact-check', text: message.text });
          const resultMessage: ChatMessage = {
            id: crypto.randomUUID(),
            role: 'assistant',
            content: message.error
              ? 'Fact check failed.'
              : `Status: ${message.result?.status ?? 'Disputed'}`,
            factCheck: message.result,
            error: message.error,
          };
          const loadingIndex = current.findIndex((item) => item.pendingActionKey === actionKey && item.loading);

          if (loadingIndex === -1) return [...current, resultMessage];

          return current.map((item, index) => (index === loadingIndex ? resultMessage : item));
        });
        return;
      }

      if (message.type === 'sidepanel-page-note-result') {
        setIsTakingPageNotes(false);
        if (message.note) {
          const savedNote = message.note;
          setNotes((current) => {
            if (current.some((note) => note.id === savedNote.id)) return current;
            return [savedNote, ...current];
          });
          setSelectedFolderId(savedNote.folderId || DEFAULT_FOLDER_ID);
          setNoteStatus('');
          showToast('Page notes saved.');
        } else {
          setNoteStatus('');
          showToast(message.error || 'Could not take page notes.');
        }
        return;
      }

      if (message.type !== 'sidepanel-selection-action') return;

      handleSelectionAction(message);
      clearPendingSidepanelAction();
    };

    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: 'smooth',
    });
  }, [messages]);

  useEffect(() => {
    if (!scrollToNoteId) return;
    const timer = window.setTimeout(() => {
      document.getElementById(`note-${scrollToNoteId}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      setScrollToNoteId(null);
    }, 50);
    return () => window.clearTimeout(timer);
  }, [scrollToNoteId]);

  const sendChatMessage = async (rawContent: string) => {
    const content = rawContent.trim();
    if (!content || isChatLoading) return;

    setInput('');
    setActiveTab('chat');

    // Navigation intent: user said "take me there" / "show me" etc.
    // Scroll to the first scroll-quote in the last assistant message instead of calling the AI.
    if (NAV_INTENT_RE.test(content)) {
      const lastAiContent = [...messages].reverse().find((m) => m.role === 'assistant' && m.content)?.content ?? '';
      SCROLL_QUOTE_RE.lastIndex = 0;
      const match = SCROLL_QUOTE_RE.exec(lastAiContent);
      if (match) {
        const quote = decodeURIComponent(match[2]);
        executeScrollToQuote(quote);
        setMessages((current) => [
          ...current,
          { id: crypto.randomUUID(), role: 'user', content },
          { id: crypto.randomUUID(), role: 'assistant', content: 'Scrolling to the source text on the page.' },
        ]);
        return;
      }
    }

    const userMsgId = crypto.randomUUID();
    const assistantMsgId = crypto.randomUUID();

    setMessages((current) => [
      ...current,
      { id: userMsgId, role: 'user', content },
      { id: assistantMsgId, role: 'assistant', content: '', loading: true },
    ]);
    setIsChatLoading(true);

    // Cancel any in-flight request before starting a new one
    chatAbortRef.current?.abort();
    const controller = new AbortController();
    chatAbortRef.current = controller;

    try {
      // When a file is loaded, use its extracted text; otherwise ask the background.
      const pageText = fileText !== null
        ? fileText
        : await new Promise<string>((resolve) => {
            chrome.runtime.sendMessage({ type: 'request-page-text' }, (response) => {
              void chrome.runtime.lastError;
              const text =
                typeof response === 'object' &&
                response !== null &&
                'text' in response &&
                typeof (response as { text: unknown }).text === 'string'
                  ? (response as { text: string }).text
                  : '';
              resolve(text);
            });
          });

      // Build conversational memory: prior real turns + this new user message,
      // mapped to OpenAI {role, content} shape, capped at the last 6 turns.
      const history = [
        ...messages
          .filter(
            (m) =>
              (m.role === 'user' || m.role === 'assistant') &&
              m.content.trim() !== '' &&
              !m.loading &&
              !m.factCheck &&
              m.id !== 'welcome',
          )
          .map((m) => ({ role: m.role, content: m.content })),
        { role: 'user' as const, content },
      ].slice(-6);

      // Stream the response, updating the placeholder message on every chunk
      let accum = '';
      await streamPageChat(
        pageText,
        history,
        (delta) => {
          accum += delta;
          const snapshot = accum;
          setMessages((current) =>
            current.map((m) =>
              m.id === assistantMsgId ? { ...m, content: snapshot, loading: false } : m,
            ),
          );
        },
        controller.signal,
      );

      // Post-process: if the model used plain quotes for page text, convert them
      // to scroll-quote links. Also clears loading for the zero-chunks case.
      const finalContent = injectScrollQuotes(accum, pageText);
      setMessages((current) =>
        current.map((m) =>
          m.id === assistantMsgId ? { ...m, content: finalContent, loading: false } : m,
        ),
      );
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      const errorMsg = err instanceof Error ? err.message : 'Something went wrong.';
      setMessages((current) =>
        current.map((m) =>
          m.id === assistantMsgId
            ? { ...m, content: '', loading: false, error: errorMsg }
            : m,
        ),
      );
    } finally {
      setIsChatLoading(false);
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void sendChatMessage(input);
  };

  /** Scroll the active browser tab to the quoted text and briefly highlight it. */
  const handleScrollToQuote = (quote: string) => executeScrollToQuote(quote);

  // Derived: project-scoped data
  const activeProject = projects.find((p) => p.id === activeProjectId) ?? projects[0];
  const projectFolders = folders.filter((f) => f.projectId === activeProjectId);
  const activeProjectFolderIds = new Set(projectFolders.map((f) => f.id));
  const projectNotes = notes.filter((n) =>
    activeProjectFolderIds.has(n.folderId || DEFAULT_FOLDER_ID),
  );

  const projectSourcesFolder = projectFolders.find((f) => f.id === activeProject?.sourcesFolderId);

  const currentCitationFallback = {
    title: context?.title,
    url: context?.url,
  };

  const citationRows = [
    {
      label: 'APA',
      value: formatCitation('apa', context?.metadata, currentCitationFallback),
    },
    {
      label: 'MLA',
      value: formatCitation('mla', context?.metadata, currentCitationFallback),
    },
  ];

  const copyText = (value: string) => {
    navigator.clipboard?.writeText(value);
  };

  const contextTitle = context?.metadata?.title || context?.title || 'No page selected';
  const contextUrl = context?.metadata?.canonicalUrl || context?.url || 'No URL captured yet';
  const selectedFolder = projectFolders.find((f) => f.id === selectedFolderId) ?? projectFolders[0];
  const visibleNotes = projectNotes.filter(
    (note) => (note.folderId || DEFAULT_FOLDER_ID) === (selectedFolder?.id || DEFAULT_FOLDER_ID),
  );

  const sortedVisibleNotes = [
    ...visibleNotes.filter((n) => n.pinned),
    ...visibleNotes.filter((n) => !n.pinned),
  ];

  // Project handlers
  const switchProject = (projectId: string) => {
    const project = projects.find((p) => p.id === projectId);
    if (!project) return;
    setActiveProjectId(projectId);
    const newProjectFolders = folders.filter((f) => f.projectId === projectId);
    const defaultFolder = newProjectFolders.find((f) => f.id === project.defaultFolderId) ?? newProjectFolders[0];
    setSelectedFolderId(defaultFolder?.id ?? DEFAULT_FOLDER_ID);
  };

  const handleCreateProject = async () => {
    const name = newProjectName.trim();
    if (!name) return;
    const project = await createProject(name);
    setActiveProjectId(project.id);
    setSelectedFolderId(project.defaultFolderId);
    setIsCreatingProject(false);
    setNewProjectName('');
    showToast(`Project "${project.name}" created.`);
  };

  const confirmDeleteProject = async () => {
    const project = projectPendingDelete;
    if (!project || project.id === DEFAULT_PROJECT_ID) {
      setProjectPendingDelete(null);
      return;
    }
    await deleteProject(project.id);
    setActiveProjectId(DEFAULT_PROJECT_ID);
    setSelectedFolderId(DEFAULT_FOLDER_ID);
    setProjectPendingDelete(null);
    showToast(`Project "${project.name}" and all its data deleted.`);
  };

  // Folder handlers
  const handleCreateFolder = async () => {
    const folder = await createNoteFolder(newFolderName, activeProjectId);
    setSelectedFolderId(folder.id);
    setNewFolderName('');
    setIsCreatingFolder(false);
  };

  const confirmDeleteFolder = async () => {
    const folder = folderPendingDelete;
    if (!folder || folder.id === activeProject?.defaultFolderId || folder.id === DEFAULT_FOLDER_ID) {
      setFolderPendingDelete(null);
      return;
    }

    await deleteNoteFolder(folder.id);
    if (selectedFolderId === folder.id) {
      setSelectedFolderId(activeProject?.defaultFolderId ?? DEFAULT_FOLDER_ID);
    }
    setFolderPendingDelete(null);
    showToast(`Folder "${folder.name}" deleted.`);
  };

  const toggleNoteCollapsed = (noteId: string) => {
    setExpandedNotes((current) => {
      const next = new Set(current);
      if (next.has(noteId)) {
        next.delete(noteId);
      } else {
        next.add(noteId);
      }
      return next;
    });
  };

  const takePageNotes = () => {
    setActiveTab('notes');
    setIsTakingPageNotes(true);
    setNoteStatus('Reading the current page...');

    const safetyTimer = window.setTimeout(() => {
      setIsTakingPageNotes(false);
      setNoteStatus('Timed out. Reload the page and try again.');
    }, 12000);

    chrome.runtime.sendMessage(
      { type: 'capture-page-note', folderId: selectedFolder?.id || DEFAULT_FOLDER_ID },
      () => { void chrome.runtime.lastError; },
    );

    const originalHandler = (message: RuntimeMessage) => {
      if (message.type !== 'sidepanel-page-note-result') return;
      clearTimeout(safetyTimer);
    };
    chrome.runtime.onMessage.addListener(originalHandler);
    window.setTimeout(() => chrome.runtime.onMessage.removeListener(originalHandler), 13000);
  };

  const downloadBlob = (payload: string, filename: string, mime: string) => {
    const blob = new Blob([payload], { type: mime });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  };

  const exportNote = (note: QuickNote) => {
    const title = getNoteTitle(note);
    const slug = title.replace(/[^a-z0-9]+/gi, '-').toLowerCase().replace(/^-+|-+$/g, '') || 'note';
    const source = note.metadata?.canonicalUrl || note.url || '';
    const md = `# ${title}\n\n${note.text}\n\n${source ? `Source: ${source}\n\n` : ''}Created: ${note.createdAt}`;
    downloadBlob(md, `${slug}.md`, 'text/markdown');
  };

  const exportFolderBibtex = () => {
    if (sortedVisibleNotes.length === 0) {
      showToast('No notes in this folder to export.');
      return;
    }
    const content = formatBibtexBundle(sortedVisibleNotes);
    const folderName = selectedFolder?.name || 'notes';
    const slug = folderName.replace(/[^a-z0-9]+/gi, '-').toLowerCase().replace(/^-+|-+$/g, '') || 'notes';
    downloadBlob(content, `${slug}.bbt`, 'text/plain');
  };

  const handleDeleteNote = async (note: QuickNote) => {
    setNotes((current) => current.filter((item) => item.id !== note.id));
    await deleteQuickNote(note.id);
    showToast('Note deleted.');
  };

  const handleMoveNote = async (note: QuickNote, folderId: string) => {
    if (folderId === (note.folderId || DEFAULT_FOLDER_ID)) return;
    setNotes((current) =>
      current.map((item) => (item.id === note.id ? { ...item, folderId } : item)),
    );
    await moveQuickNote(note.id, folderId);
    const target = projectFolders.find((f) => f.id === folderId);
    showToast(`Moved to ${target?.name || 'folder'}.`);
  };

  const startEditNote = (note: QuickNote) => {
    if (!expandedNotes.has(note.id)) toggleNoteCollapsed(note.id);
    setEditingNoteId(note.id);
    setEditingText(note.text);
    setEditingTitleText(getNoteTitle(note));
  };

  const saveEditNote = async (note: QuickNote) => {
    const trimmedText = editingText.trim();
    let trimmedTitle = editingTitleText.trim();
    setEditingNoteId(null);
    const textChanged = trimmedText && trimmedText !== note.text;
    const titleChanged = trimmedTitle && trimmedTitle !== getNoteTitle(note);
    if (!textChanged && !titleChanged) return;
    if (titleChanged) {
      trimmedTitle = await resolveNoteTitle(
        trimmedTitle,
        note.folderId || DEFAULT_FOLDER_ID,
        note.id,
      );
    }
    const updates = {
      text: trimmedText || note.text,
      customTitle: trimmedTitle || undefined,
    };
    setNotes((current) =>
      current.map((n) => n.id === note.id ? { ...n, ...updates, edited: true } : n),
    );
    await updateQuickNote(note.id, updates);
    showToast(titleChanged && trimmedTitle !== editingTitleText.trim() ? `Renamed to "${trimmedTitle}".` : 'Note updated.');
  };

  const cancelEditNote = () => setEditingNoteId(null);

  const buildDefaultNoteTitle = () => {
    const now = new Date();
    const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const ts = `${MONTHS[now.getMonth()]} ${now.getDate()}, ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
    const pageTitle = context?.metadata?.title || context?.title || '';
    const shortened = pageTitle.length > 35 ? pageTitle.slice(0, 34).trimEnd() + '…' : pageTitle;
    return pageTitle ? `[${ts}] ${shortened}` : `[${ts}]`;
  };

  const startCreateNote = () => {
    setIsCreatingNote(true);
    setNewNoteTitle(buildDefaultNoteTitle());
    setNewNoteText('');
  };

  const saveNewNote = async () => {
    const text = newNoteText.trim();
    if (!text) { setIsCreatingNote(false); return; }
    setIsCreatingNote(false);
    const targetFolderId = selectedFolderIdRef.current || DEFAULT_FOLDER_ID;
    const rawTitle = newNoteTitle.trim() || buildDefaultNoteTitle();
    const customTitle = await resolveNoteTitle(rawTitle, targetFolderId);
    const note = await saveQuickNote({ text, kind: 'manual', folderId: targetFolderId, customTitle });
    setExpandedNotes((current) => { const next = new Set(current); next.add(note.id); return next; });
    setScrollToNoteId(note.id);
    showToast(customTitle !== rawTitle ? `Note created as "${customTitle}".` : 'Note created.');
  };

  const cancelCreateNote = () => setIsCreatingNote(false);

  const handlePinNote = (note: QuickNote) => {
    const newPinned = !note.pinned;
    setNotes((current) => current.map((n) => n.id === note.id ? { ...n, pinned: newPinned } : n));
    void pinQuickNote(note.id, newPinned);
    showToast(newPinned ? 'Note pinned.' : 'Note unpinned.');
  };

  const handleReorderNote = (note: QuickNote, direction: 'up' | 'down') => {
    // Reorder within the note's own group (pinned ↔ pinned, unpinned ↔ unpinned)
    const group = sortedVisibleNotes.filter((n) => !!n.pinned === !!note.pinned);
    const idx = group.findIndex((n) => n.id === note.id);
    if (direction === 'up' && idx <= 0) return;
    if (direction === 'down' && idx >= group.length - 1) return;
    const swapWith = group[direction === 'up' ? idx - 1 : idx + 1];
    setNotes((current) => {
      const next = [...current];
      const iA = next.findIndex((n) => n.id === note.id);
      const iB = next.findIndex((n) => n.id === swapWith.id);
      if (iA === -1 || iB === -1) return current;
      [next[iA], next[iB]] = [next[iB], next[iA]];
      return next;
    });
    void swapQuickNotes(note.id, swapWith.id);
  };

  const handleFileUpload = async (file: File) => {
    fileSourceIsAutoRef.current = false;
    setIsFileLoading(true);
    try {
      const text = await extractFileText(file);
      setFileText(text);
      setFileSourceName(file.name);
      setActiveTab('chat');
      showToast(`Loaded: ${file.name}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not read file.';
      showToast(msg);
    } finally {
      setIsFileLoading(false);
    }
  };

  const openAiSavePicker = (messageId: string) => {
    setSaveAiFolderId(selectedFolderIdRef.current || DEFAULT_FOLDER_ID);
    setSavingMessageId(messageId);
  };

  const handleSaveAiResponse = async (content: string) => {
    const targetFolderId = saveAiFolderId || DEFAULT_FOLDER_ID;
    const stripped = stripScrollQuotes(content);
    const _MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const _now = new Date();
    const _ts = `${_MONTHS[_now.getMonth()]} ${_now.getDate()}, ${String(_now.getHours()).padStart(2,'0')}:${String(_now.getMinutes()).padStart(2,'0')}`;
    const _plain = stripped.replace(/\s+/g, ' ').trim();
    const _short = _plain.length > 35 ? _plain.slice(0, 34).trimEnd() + '…' : _plain;
    const rawTitle = `[${_ts}] ${_short}`;
    try {
      const customTitle = await resolveNoteTitle(rawTitle, targetFolderId);
      await saveQuickNote({ text: stripped, kind: 'ai-chat', folderId: targetFolderId, customTitle });
      setSavingMessageId(null);
      showToast('AI response saved to notes.');
    } catch {
      showToast('Could not save note.');
    }
  };

  const clearFileSource = () => {
    setFileText(null);
    setFileSourceName(null);
    fileSourceIsAutoRef.current = false;
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const saveCitationAsNote = async (label: string, value: string) => {
    const sourcesFolder = projectFolders.find((f) => f.id === activeProject?.sourcesFolderId);
    const targetFolderId = sourcesFolder?.id ?? selectedFolderIdRef.current ?? DEFAULT_FOLDER_ID;
    const rawTitle = `${label}: ${contextTitle}`;
    const customTitle = await resolveNoteTitle(rawTitle, targetFolderId);
    await saveQuickNote({
      text: value,
      kind: 'citation',
      folderId: targetFolderId,
      metadata: context?.metadata,
      url: context?.url,
      title: context?.title,
      customTitle,
    });
    showToast(`${label} citation saved to notes.`);
  };

  const navigateToNote = (noteId: string) => {
    const target = projectNotes.find((n) => n.id === noteId);
    if (!target) return;
    setSelectedFolderId(target.folderId || DEFAULT_FOLDER_ID);
    setActiveTab('notes');
    setExpandedNotes((current) => { const next = new Set(current); next.add(noteId); return next; });
    setScrollToNoteId(noteId);
  };

  // Counts for project delete confirmation
  const pendingDeleteFolderCount = projectPendingDelete
    ? folders.filter((f) => f.projectId === projectPendingDelete.id).length
    : 0;
  const pendingDeleteNoteCount = projectPendingDelete
    ? notes.filter((n) => {
        const f = folders.find((folder) => folder.id === (n.folderId || DEFAULT_FOLDER_ID));
        return f?.projectId === projectPendingDelete.id;
      }).length
    : 0;

  return (
    <main className="sidepanel-shell">

      {/* Project switcher bar */}
      <div className="project-bar">
        <Layers aria-hidden="true" className="project-bar-icon" size={14} />
        <select
          aria-label="Active project"
          className="project-select"
          onChange={(e) => switchProject(e.target.value)}
          value={activeProjectId}
        >
          {projects.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        <button
          aria-label="New project"
          className="project-bar-btn"
          onClick={() => { setIsCreatingProject(true); setNewProjectName(''); }}
          title="New project"
          type="button"
        >
          <Plus aria-hidden="true" size={14} />
        </button>
        <button
          aria-label="Delete project"
          className="project-bar-btn project-bar-btn--danger"
          disabled={activeProjectId === DEFAULT_PROJECT_ID}
          onClick={() => setProjectPendingDelete(activeProject ?? null)}
          title={activeProjectId === DEFAULT_PROJECT_ID ? 'Cannot delete the default project' : 'Delete project'}
          type="button"
        >
          <Trash2 aria-hidden="true" size={14} />
        </button>
      </div>

      <header className="panel-header">
        <div className="panel-wordmark">
          <span className="panel-wordmark-mark" aria-hidden="true" />
          <h1>Øde</h1>
        </div>
        <Button className="settings-button" type="button" variant="outline" size="icon" aria-label="Open settings">
          <Settings aria-hidden="true" size={16} />
        </Button>
      </header>

      <nav className="panel-tabs" aria-label="Sidepanel sections">
        <button
          className={activeTab === 'chat' ? 'active' : ''}
          onClick={() => setActiveTab('chat')}
          type="button"
        >
          <BookOpen aria-hidden="true" size={15} />
          Chat
        </button>
        <button
          className={activeTab === 'notes' ? 'active' : ''}
          onClick={() => setActiveTab('notes')}
          type="button"
        >
          <FileText aria-hidden="true" size={15} />
          Notes
        </button>
        <button
          className={activeTab === 'source' ? 'active' : ''}
          onClick={() => setActiveTab('source')}
          type="button"
        >
          <Clipboard aria-hidden="true" size={15} />
          Source
        </button>
      </nav>

      {activeTab === 'chat' ? (
        <section ref={scrollRef} className="chat-area" aria-label="Research chat">
          {fileSourceName ? (
            <div className="file-source-banner">
              <FileText aria-hidden="true" size={14} />
              <span>Active file: <strong>{fileSourceName}</strong></span>
              <button
                aria-label="Clear file source"
                className="file-source-dismiss"
                onClick={clearFileSource}
                type="button"
              >
                <X aria-hidden="true" size={13} />
              </button>
            </div>
          ) : null}
          {messages.map((message) => (
            <article className={`message ${message.role}`} key={message.id}>
              <span>{message.role === 'assistant' ? 'Øde' : 'You'}</span>
              {message.factCheck ? null : message.content.split('\n\n').map((para, i) => (
                <p key={i}>
                  {para.split('\n').flatMap((line, j) => {
                    const nodes = parseScrollLinks(line, handleScrollToQuote, `${message.id}-${i}-${j}`);
                    return j === 0 ? nodes : [<br key={`br-${i}-${j}`} />, ...nodes];
                  })}
                </p>
              ))}
              {message.loading && !message.content ? (
                <div className="loading-dots" aria-label="Loading response">
                  <i />
                  <i />
                  <i />
                </div>
              ) : null}
              {message.error ? <p className="message-error">{message.error}</p> : null}
              {message.factCheck ? (
                <div className="fact-check-result">
                  <p className="fact-check-summary">
                    <strong className={message.factCheck.status.toLowerCase()}>
                      {message.factCheck.status}
                    </strong>
                    {' '}
                    {message.factCheck.summary}
                  </p>
                  {message.factCheck.sources.length > 0 ? (
                    <ul>
                      {message.factCheck.sources.map((source) => (
                        <li key={source.url}>
                          <a href={source.url} rel="noreferrer" target="_blank">
                            <span>{source.title}</span>
                            <ExternalLink aria-hidden="true" size={13} />
                          </a>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : null}
              {message.role === 'assistant' && !message.loading && message.content && !message.error ? (
                savingMessageId === message.id ? (
                  <div className="message-save-picker">
                    <select
                      aria-label="Choose folder"
                      value={saveAiFolderId}
                      onChange={(e) => setSaveAiFolderId(e.target.value)}
                    >
                      {projectFolders.map((f) => (
                        <option key={f.id} value={f.id}>{f.name}</option>
                      ))}
                    </select>
                    <button
                      className="message-save-picker-btn message-save-picker-btn--confirm"
                      type="button"
                      onClick={() => { void handleSaveAiResponse(message.content); }}
                    >
                      <Check aria-hidden="true" size={13} />
                      Save
                    </button>
                    <button
                      aria-label="Cancel"
                      className="message-save-picker-btn message-save-picker-btn--cancel"
                      type="button"
                      onClick={() => setSavingMessageId(null)}
                    >
                      <X aria-hidden="true" size={13} />
                    </button>
                  </div>
                ) : (
                  <div className="message-save-row">
                    <button
                      aria-label="Save to notes"
                      className="message-save-btn"
                      type="button"
                      onClick={() => openAiSavePicker(message.id)}
                    >
                      <BookmarkPlus aria-hidden="true" size={13} />
                      Save to notes
                    </button>
                  </div>
                )
              ) : null}
            </article>
          ))}
        </section>
      ) : null}

      {activeTab === 'notes' ? (
        <section className="notes-area" aria-label="Research notes">
          <div className="notes-header">
          <div className="notes-toolbar">
            <Button onClick={startCreateNote} type="button" disabled={isCreatingNote}>
              <Plus aria-hidden="true" size={15} />
              New note
            </Button>
            <Button onClick={takePageNotes} type="button" disabled={isTakingPageNotes}>
              <FilePlus aria-hidden="true" size={15} />
              {isTakingPageNotes ? 'Taking notes...' : 'Take page notes'}
            </Button>
            <Button
              onClick={exportFolderBibtex}
              title="Export all notes in this folder as BibTeX"
              type="button"
              variant="outline"
            >
              <FileDown aria-hidden="true" size={15} />
              Export .bbt
            </Button>
          </div>

          {noteStatus ? <p className="note-status">{noteStatus}</p> : null}

          <div className="folder-list" aria-label="Note folders">
            {projectFolders.map((folder) => {
              const count = projectNotes.filter((note) => (note.folderId || DEFAULT_FOLDER_ID) === folder.id).length;
              const isDefault = folder.id === activeProject?.defaultFolderId || folder.id === DEFAULT_FOLDER_ID;

              return (
                <div
                  className={`folder-chip ${folder.id === selectedFolderId ? 'active' : ''}`}
                  key={folder.id}
                >
                  <button
                    className="folder-select"
                    onClick={() => setSelectedFolderId(folder.id)}
                    type="button"
                  >
                    <span>{folder.name}</span>
                    <small>{count}</small>
                  </button>
                  {isDefault ? null : (
                    <button
                      aria-label={`Delete folder ${folder.name}`}
                      className="folder-delete"
                      onClick={() => setFolderPendingDelete(folder)}
                      type="button"
                    >
                      <X aria-hidden="true" size={13} />
                    </button>
                  )}
                </div>
              );
            })}
            <button
              aria-label="New folder"
              className="folder-add-btn"
              onClick={() => setIsCreatingFolder(true)}
              type="button"
            >
              <Plus aria-hidden="true" size={14} />
            </button>
          </div>
          </div>

          <div className="notes-list">
          {isCreatingNote ? (
            <div className="note-item note-create-form">
              <input
                autoFocus
                className="note-title-input"
                onChange={(e) => setNewNoteTitle(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Escape') cancelCreateNote(); }}
                placeholder="Title (optional)"
                type="text"
                value={newNoteTitle}
              />
              <Textarea
                onChange={(e) => setNewNoteText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') cancelCreateNote();
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) saveNewNote();
                }}
                placeholder="Write your note…"
                rows={5}
                value={newNoteText}
              />
              <div className="note-edit-actions">
                <Button onClick={saveNewNote} type="button">
                  <Check aria-hidden="true" size={13} />
                  Save
                </Button>
                <Button onClick={cancelCreateNote} type="button" variant="outline">
                  Cancel
                </Button>
              </div>
            </div>
          ) : null}
          {sortedVisibleNotes.length === 0 && !isCreatingNote ? (
            <p className="empty-state">Take notes from the current page or save a highlighted passage.</p>
          ) : (
            sortedVisibleNotes.map((note) => {
              const isCollapsed = !expandedNotes.has(note.id);
              const isEditing = editingNoteId === note.id;

              // Determine position within the note's own group (pinned / unpinned)
              const group = sortedVisibleNotes.filter((n) => !!n.pinned === !!note.pinned);
              const groupIdx = group.findIndex((n) => n.id === note.id);
              const isFirstInGroup = groupIdx === 0;
              const isLastInGroup = groupIdx === group.length - 1;

              return (
                <article
                  className={`note-item ${isCollapsed ? 'collapsed' : ''} ${note.kind === 'citation' ? 'note-item--citation' : ''} ${note.pinned ? 'note-item--pinned' : ''}`}
                  id={`note-${note.id}`}
                  key={note.id}
                >
                  {/* Left column — reorder arrows */}
                  <div className="note-reorder">
                    <Button
                      aria-label="Move note up"
                      className="note-reorder-btn"
                      disabled={isEditing || isFirstInGroup}
                      onClick={() => handleReorderNote(note, 'up')}
                      size="icon"
                      type="button"
                      variant="ghost"
                    >
                      <ArrowUp aria-hidden="true" size={12} />
                    </Button>
                    <Button
                      aria-label="Move note down"
                      className="note-reorder-btn"
                      disabled={isEditing || isLastInGroup}
                      onClick={() => handleReorderNote(note, 'down')}
                      size="icon"
                      type="button"
                      variant="ghost"
                    >
                      <ArrowDown aria-hidden="true" size={12} />
                    </Button>
                  </div>

                  {/* Right column — all note content */}
                  <div className="note-content">
                    <header>
                      <strong>{getNoteTitle(note)}</strong>
                      <span className="note-type-label">
                        {note.kind === 'page' ? 'Page notes' : note.kind === 'citation' ? 'Citation' : note.kind === 'manual' ? 'Note' : note.kind === 'ai-chat' ? 'AI response' : 'Selection note'}
                        {note.edited ? <Pencil aria-label="Edited" className="note-edited-icon" size={10} /> : null}
                      </span>
                      <time dateTime={note.createdAt}>
                        {new Intl.DateTimeFormat('en-US', {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        }).format(new Date(note.createdAt))}
                      </time>
                      <div className="note-button-row">
                        <Button
                          aria-label={note.pinned ? 'Unpin note' : 'Pin note'}
                          className={`note-icon-btn ${note.pinned ? 'note-pin-btn--active' : ''}`}
                          disabled={isEditing}
                          onClick={() => handlePinNote(note)}
                          size="icon"
                          title={note.pinned ? 'Unpin' : 'Pin to top'}
                          type="button"
                          variant="outline"
                        >
                          <Pin aria-hidden="true" size={14} />
                        </Button>
                        <Button
                          aria-label="Export note as Markdown"
                          className="note-icon-btn"
                          disabled={isEditing}
                          onClick={() => exportNote(note)}
                          size="icon"
                          type="button"
                          variant="outline"
                        >
                          <Download aria-hidden="true" size={14} />
                        </Button>
                        <Button
                          aria-label="Copy note to clipboard"
                          className="note-icon-btn"
                          disabled={isEditing}
                          onClick={() => { copyText(note.text); showToast('Copied to clipboard.'); }}
                          size="icon"
                          type="button"
                          variant="outline"
                        >
                          <Clipboard aria-hidden="true" size={14} />
                        </Button>
                        {note.kind !== 'citation' ? (
                          <Button
                            aria-label="Edit note"
                            className="note-icon-btn"
                            disabled={isEditing}
                            onClick={() => startEditNote(note)}
                            size="icon"
                            type="button"
                            variant="outline"
                          >
                            <Pencil aria-hidden="true" size={14} />
                          </Button>
                        ) : null}
                        <Button
                          aria-label="Delete note"
                          className="note-icon-btn note-delete"
                          disabled={isEditing}
                          onClick={() => handleDeleteNote(note)}
                          size="icon"
                          type="button"
                          variant="outline"
                        >
                          <Trash2 aria-hidden="true" size={14} />
                        </Button>
                        <Button
                          aria-expanded={!isCollapsed}
                          aria-label={isCollapsed ? 'Expand note' : 'Collapse note'}
                          className="note-icon-btn note-collapse-toggle"
                          disabled={isEditing}
                          onClick={() => toggleNoteCollapsed(note.id)}
                          size="icon"
                          type="button"
                          variant="outline"
                        >
                          <ChevronDown aria-hidden="true" size={14} />
                        </Button>
                      </div>
                    </header>
                    {isCollapsed ? null : isEditing ? (
                      <div className="note-edit-area">
                        <input
                          className="note-title-input"
                          value={editingTitleText}
                          onChange={(e) => setEditingTitleText(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Escape') cancelEditNote(); }}
                          placeholder="Note title"
                          type="text"
                        />
                        <Textarea
                          autoFocus
                          value={editingText}
                          onChange={(e) => setEditingText(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Escape') cancelEditNote();
                            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) saveEditNote(note);
                          }}
                          rows={Math.max(3, editingText.split('\n').length + 1)}
                        />
                        <div className="note-edit-actions">
                          <Button onClick={() => saveEditNote(note)} type="button">
                            <Check aria-hidden="true" size={13} />
                            Save
                          </Button>
                          <Button onClick={cancelEditNote} type="button" variant="outline">
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <p>
                          {note.text.split(/(\[\[[^\]\n]+\]\])/).map((part, i) => {
                            const match = part.match(/^\[\[([^\]\n]+)\]\]$/);
                            if (match) {
                              const name = match[1];
                              const target = projectNotes.find((n) => getNoteTitle(n).toLowerCase() === name.toLowerCase());
                              return target ? (
                                <span
                                  className="note-link"
                                  key={i}
                                  onClick={() => navigateToNote(target.id)}
                                  role="button"
                                  tabIndex={0}
                                >{name}</span>
                              ) : (
                                <span className="note-link note-link--missing" key={i}>{part}</span>
                              );
                            }
                            return <span key={i}>{part}</span>;
                          })}
                        </p>
                        {note.metadata?.canonicalUrl || note.url ? (
                          <a href={note.metadata?.canonicalUrl || note.url} rel="noreferrer" target="_blank">
                            {note.metadata?.canonicalUrl || note.url}
                          </a>
                        ) : null}
                        <footer className="note-actions">
                          <label className="note-move">
                            <span className="sr-only">Move note to folder</span>
                            <select
                              aria-label="Move note to folder"
                              onChange={(event) => handleMoveNote(note, event.target.value)}
                              value={note.folderId || DEFAULT_FOLDER_ID}
                            >
                              {projectFolders.map((folder) => (
                                <option key={folder.id} value={folder.id}>
                                  {folder.name}
                                </option>
                              ))}
                            </select>
                          </label>
                        </footer>
                      </>
                    )}
                  </div>
                </article>
              );
            })
          )}
          </div>
        </section>
      ) : null}

      {activeTab === 'source' ? (
        <div className="source-area">
          <section className={`context-box ${isContextExpanded ? 'expanded' : 'collapsed'}`} aria-label="Current page context">
            <div className="context-header">
              <div>
                <p className="eyebrow">Context</p>
                <h2>{contextTitle}</h2>
                {!isContextExpanded ? <p className="context-preview">{context?.text || contextUrl}</p> : null}
              </div>
              <Button
                aria-expanded={isContextExpanded}
                aria-label={isContextExpanded ? 'Collapse context' : 'Expand context'}
                className="context-toggle"
                onClick={() => setIsContextExpanded((current) => !current)}
                size="icon"
                type="button"
                variant="outline"
              >
                <ChevronDown aria-hidden="true" size={15} />
              </Button>
            </div>

            {isContextExpanded ? (
              <>
                <dl className="metadata-list">
                  <div>
                    <dt>Author</dt>
                    <dd>{context?.metadata?.author || 'Unknown author'}</dd>
                  </div>
                  <div>
                    <dt>Canonical URL</dt>
                    <dd>{contextUrl}</dd>
                  </div>
                </dl>

                <blockquote>
                  {context?.text || 'Highlight a sentence on the current page to send it here.'}
                </blockquote>
              </>
            ) : null}
          </section>

          <section className="citations-area" aria-label="Source">
          <div className="citation-source-info">
            <p className="eyebrow">Source</p>
            <p className="citation-source-title">{contextTitle}</p>
            {contextUrl !== 'No URL captured yet' ? (
              <a className="citation-source-url" href={contextUrl} rel="noreferrer" target="_blank">
                {contextUrl}
              </a>
            ) : null}
          </div>
          {citationRows.map((citation) => (
            <article className="citation-item" key={citation.label}>
              <div>
                <h3>{citation.label}</h3>
                <p>{citation.value}</p>
              </div>
              <div className="citation-actions">
                <Button
                  aria-label={`Copy ${citation.label} citation`}
                  onClick={() => copyText(citation.value)}
                  size="icon"
                  title="Copy to clipboard"
                  type="button"
                  variant="outline"
                >
                  <Clipboard aria-hidden="true" size={15} />
                </Button>
                <Button
                  aria-label={`Save ${citation.label} citation to notes`}
                  onClick={() => saveCitationAsNote(citation.label, citation.value)}
                  size="icon"
                  title={`Save to ${projectSourcesFolder?.name ?? 'Sources'} folder`}
                  type="button"
                  variant="outline"
                >
                  <BookmarkPlus aria-hidden="true" size={15} />
                </Button>
              </div>
            </article>
          ))}
          </section>
        </div>
      ) : null}

      <div className="input-section">
        {activeTab === 'chat' ? (
          <>
            <div className="chat-chips" aria-label="Quick actions" role="toolbar">
              {QUICK_ACTIONS.map(({ label, prompt }) => (
                <button
                  className="chat-chip"
                  disabled={isChatLoading}
                  key={label}
                  onClick={() => { void sendChatMessage(prompt); }}
                  type="button"
                >
                  {label}
                </button>
              ))}
            </div>
            <div
              className={`file-dropzone ${isDragOver ? 'file-dropzone--over' : ''} ${isFileLoading ? 'file-dropzone--loading' : ''}`}
              onDragLeave={() => setIsDragOver(false)}
              onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
              onDrop={(e) => {
                e.preventDefault();
                setIsDragOver(false);
                const file = e.dataTransfer.files[0];
                if (file) void handleFileUpload(file);
              }}
              onClick={() => fileInputRef.current?.click()}
              role="button"
              tabIndex={0}
              aria-label="Upload a document to use as chat context"
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click(); }}
            >
              <Upload aria-hidden="true" size={14} />
              <span>{isFileLoading ? 'Reading file…' : 'Drop or click to load PDF, DOCX, PPTX'}</span>
              <input
                accept=".pdf,.docx,.pptx"
                aria-hidden="true"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void handleFileUpload(file);
                }}
                ref={fileInputRef}
                style={{ display: 'none' }}
                tabIndex={-1}
                type="file"
              />
            </div>
          </>
        ) : null}
        <form className="input-bar" onSubmit={handleSubmit}>
          <Textarea
            aria-label="Ask a research question"
            disabled={isChatLoading}
            onChange={(event) => setInput(event.target.value)}
            ref={chatInputRef}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void sendChatMessage(input);
              }
            }}
            placeholder="Ask about this page..."
            rows={2}
            value={input}
          />
          <Button disabled={isChatLoading} type="submit" aria-label="Send message">
            <Send aria-hidden="true" size={16} />
            Send
          </Button>
        </form>
      </div>

      {/* Folder delete confirmation */}
      {folderPendingDelete ? (
        <div
          className="modal-overlay"
          onClick={() => setFolderPendingDelete(null)}
          role="presentation"
        >
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-folder-title"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id="delete-folder-title">Delete folder?</h2>
            <p>
              "{folderPendingDelete.name}" will be deleted. Its notes will be moved to the General
              folder, not deleted.
            </p>
            <div className="modal-actions">
              <Button type="button" variant="outline" onClick={() => setFolderPendingDelete(null)}>
                Cancel
              </Button>
              <Button type="button" className="modal-danger" onClick={confirmDeleteFolder}>
                Delete folder
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Project delete confirmation */}
      {projectPendingDelete ? (
        <div
          className="modal-overlay"
          onClick={() => setProjectPendingDelete(null)}
          role="presentation"
        >
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-project-title"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id="delete-project-title">Delete project?</h2>
            <p className="modal-warning-label">This action is permanent and cannot be undone.</p>
            <p>
              Deleting <strong>"{projectPendingDelete.name}"</strong> will permanently erase:
            </p>
            <ul className="modal-delete-list">
              <li>{pendingDeleteFolderCount} folder{pendingDeleteFolderCount !== 1 ? 's' : ''}</li>
              <li>{pendingDeleteNoteCount} note{pendingDeleteNoteCount !== 1 ? 's' : ''} and citation{pendingDeleteNoteCount !== 1 ? 's' : ''}</li>
            </ul>
            <p>There is no recovery. All research data in this project will be gone forever.</p>
            <div className="modal-actions">
              <Button type="button" variant="outline" onClick={() => setProjectPendingDelete(null)}>
                Cancel
              </Button>
              <Button type="button" className="modal-danger" onClick={confirmDeleteProject}>
                Delete everything
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {/* New project modal */}
      {isCreatingProject ? (
        <div
          className="modal-overlay"
          onClick={() => { setIsCreatingProject(false); setNewProjectName(''); }}
          role="presentation"
        >
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-project-title"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id="new-project-title">New project</h2>
            <input
              autoFocus
              className="note-title-input"
              onChange={(e) => setNewProjectName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') { setIsCreatingProject(false); setNewProjectName(''); }
                if (e.key === 'Enter') handleCreateProject();
              }}
              placeholder="Project name"
              style={{ marginBottom: '16px' }}
              type="text"
              value={newProjectName}
            />
            <div className="modal-actions">
              <Button
                type="button"
                variant="outline"
                onClick={() => { setIsCreatingProject(false); setNewProjectName(''); }}
              >
                Cancel
              </Button>
              <Button
                type="button"
                disabled={!newProjectName.trim()}
                onClick={handleCreateProject}
              >
                Create project
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {/* New folder modal */}
      {isCreatingFolder ? (
        <div
          className="modal-overlay"
          onClick={() => { setIsCreatingFolder(false); setNewFolderName(''); }}
          role="presentation"
        >
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-folder-title"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id="new-folder-title">New folder</h2>
            <input
              autoFocus
              className="note-title-input"
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') { setIsCreatingFolder(false); setNewFolderName(''); }
                if (e.key === 'Enter' && newFolderName.trim()) handleCreateFolder();
              }}
              placeholder="Folder name"
              style={{ marginBottom: '16px' }}
              type="text"
              value={newFolderName}
            />
            <div className="modal-actions">
              <Button
                type="button"
                variant="outline"
                onClick={() => { setIsCreatingFolder(false); setNewFolderName(''); }}
              >
                Cancel
              </Button>
              <Button
                type="button"
                disabled={!newFolderName.trim()}
                onClick={handleCreateFolder}
              >
                Create folder
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {toast ? (
        <div className="toast" role="status" aria-live="polite">
          {toast}
        </div>
      ) : null}
    </main>
  );
}

export default App;
