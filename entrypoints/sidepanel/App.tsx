import { FormEvent, useEffect, useRef, useState } from 'react';
import {
  BookOpen,
  Check,
  ChevronDown,
  Clipboard,
  Download,
  ExternalLink,
  FilePlus,
  FileText,
  FolderPlus,
  Pencil,
  Plus,
  Send,
  Settings,
  Trash2,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import type { FactCheckResult } from '@/lib/factCheck';
import type { PageMetadata } from '@/lib/pageMetadata';
import {
  formatCitation,
  createNoteFolder,
  deleteNoteFolder,
  deleteQuickNote,
  getNoteTitle,
  moveQuickNote,
  resolveNoteTitle,
  saveQuickNote,
  updateQuickNote,
  DEFAULT_FOLDER_ID,
  getNoteFolders,
  getQuickNotes,
  NOTE_FOLDERS_STORAGE_KEY,
  QUICK_NOTES_STORAGE_KEY,
  type NoteFolder,
  type QuickNote,
} from '@/lib/researchStorage';
import { clearPendingSidepanelAction, getPendingSidepanelAction } from '@/lib/sidepanelQueue';

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
type ActiveTab = 'chat' | 'notes' | 'citations';

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

function App() {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [context, setContext] = useState<SelectionContextMessage | null>(null);
  const [notes, setNotes] = useState<QuickNote[]>([]);
  const [folders, setFolders] = useState<NoteFolder[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState(DEFAULT_FOLDER_ID);
  const [activeTab, setActiveTab] = useState<ActiveTab>('chat');
  const [isContextExpanded, setIsContextExpanded] = useState(false);
  const [input, setInput] = useState('');
  const [newFolderName, setNewFolderName] = useState('');
  const [noteStatus, setNoteStatus] = useState('');
  const [isTakingPageNotes, setIsTakingPageNotes] = useState(false);
  const [expandedNotes, setExpandedNotes] = useState<Set<string>>(new Set());
  const [folderPendingDelete, setFolderPendingDelete] = useState<NoteFolder | null>(null);
  const [toast, setToast] = useState('');
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');
  const [editingTitleText, setEditingTitleText] = useState('');
  const [isCreatingNote, setIsCreatingNote] = useState(false);
  const [newNoteTitle, setNewNoteTitle] = useState('');
  const [newNoteText, setNewNoteText] = useState('');
  const [scrollToNoteId, setScrollToNoteId] = useState<string | null>(null);
  const handledActionKeysRef = useRef<Set<string>>(new Set());
  const toastTimerRef = useRef<number | undefined>(undefined);
  const selectedFolderIdRef = useRef(selectedFolderId);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    selectedFolderIdRef.current = selectedFolderId;
  }, [selectedFolderId]);

  const showToast = (text: string) => {
    setToast(text);
    window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(''), 3000);
  };

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

    getQuickNotes().then(setNotes);
    getNoteFolders().then((storedFolders) => {
      setFolders(storedFolders);
      setSelectedFolderId((current) =>
        storedFolders.some((folder) => folder.id === current) ? current : storedFolders[0]?.id ?? DEFAULT_FOLDER_ID,
      );
    });

    const listener = (
      changes: Record<string, { oldValue?: unknown; newValue?: unknown }>,
      areaName: string,
    ) => {
      if (areaName !== 'local') return;
      if (!changes[QUICK_NOTES_STORAGE_KEY] && !changes[NOTE_FOLDERS_STORAGE_KEY]) return;
      if (changes[QUICK_NOTES_STORAGE_KEY]) {
        setNotes((changes[QUICK_NOTES_STORAGE_KEY].newValue as QuickNote[] | undefined) ?? []);
      }
      if (changes[NOTE_FOLDERS_STORAGE_KEY]) {
        setFolders((changes[NOTE_FOLDERS_STORAGE_KEY].newValue as NoteFolder[] | undefined) ?? []);
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
              : message.action === 'fact-check'
              ? 'Checking the highlighted claim...'
              : 'Selection received. Backend AI handling will be connected in the next phase.',
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

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const content = input.trim();
    if (!content) return;

    setMessages((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        role: 'user',
        content,
      },
      {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: 'AI chat transport is ready for the backend integration phase.',
      },
    ]);
    setInput('');
  };

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
  const selectedFolder = folders.find((folder) => folder.id === selectedFolderId) ?? folders[0];
  const visibleNotes = notes.filter((note) => (note.folderId || DEFAULT_FOLDER_ID) === (selectedFolder?.id || DEFAULT_FOLDER_ID));

  const handleCreateFolder = async () => {
    const folder = await createNoteFolder(newFolderName);
    // Do not optimistically add here: the chrome.storage.onChanged listener
    // already syncs the folder list from storage. Adding it again would
    // duplicate the folder (and both copies render as selected).
    setSelectedFolderId(folder.id);
    setNewFolderName('');
  };

  const confirmDeleteFolder = async () => {
    const folder = folderPendingDelete;
    if (!folder || folder.id === DEFAULT_FOLDER_ID) {
      setFolderPendingDelete(null);
      return;
    }

    await deleteNoteFolder(folder.id);
    if (selectedFolderId === folder.id) {
      setSelectedFolderId(DEFAULT_FOLDER_ID);
    }
    setFolderPendingDelete(null);
    showToast(`Folder “${folder.name}” deleted.`);
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
    const target = folders.find((folder) => folder.id === folderId);
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

  const navigateToNote = (noteId: string) => {
    const target = notes.find((n) => n.id === noteId);
    if (!target) return;
    setSelectedFolderId(target.folderId || DEFAULT_FOLDER_ID);
    setActiveTab('notes');
    setExpandedNotes((current) => { const next = new Set(current); next.add(noteId); return next; });
    setScrollToNoteId(noteId);
  };

  return (
    <main className="sidepanel-shell">
      <header className="panel-header">
        <div>
          <p className="eyebrow">Research Workspace</p>
          <h1>Øde AI</h1>
        </div>
        <Button className="settings-button" type="button" variant="outline" size="icon" aria-label="Open settings">
          <Settings aria-hidden="true" size={16} />
        </Button>
      </header>

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
          className={activeTab === 'citations' ? 'active' : ''}
          onClick={() => setActiveTab('citations')}
          type="button"
        >
          <Clipboard aria-hidden="true" size={15} />
          Citations
        </button>
      </nav>

      {activeTab === 'chat' ? (
        <section ref={scrollRef} className="chat-area" aria-label="Research chat">
          {messages.map((message) => (
            <article className={`message ${message.role}`} key={message.id}>
              <span>{message.role === 'assistant' ? 'Øde' : 'You'}</span>
              {message.factCheck ? null : message.content.split('\n\n').map((para, i) => (
                <p key={i}>
                  {para.split('\n').flatMap((line, j) =>
                    j === 0 ? [line] : [<br key={j} />, line]
                  )}
                </p>
              ))}
              {message.loading ? (
                <div className="loading-dots" aria-label="Waiting for fact-check result">
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
          </div>

          {noteStatus ? <p className="note-status">{noteStatus}</p> : null}

          <div className="folder-create">
            <input
              aria-label="New folder name"
              onChange={(event) => setNewFolderName(event.target.value)}
              placeholder="New folder"
              value={newFolderName}
            />
            <Button
              aria-label="Create folder"
              disabled={newFolderName.trim().length === 0}
              onClick={handleCreateFolder}
              size="icon"
              type="button"
              variant="outline"
            >
              <FolderPlus aria-hidden="true" size={15} />
            </Button>
          </div>

          <div className="folder-list" aria-label="Note folders">
            {folders.map((folder) => {
              const count = notes.filter((note) => (note.folderId || DEFAULT_FOLDER_ID) === folder.id).length;
              const isDefault = folder.id === DEFAULT_FOLDER_ID;

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
          {visibleNotes.length === 0 && !isCreatingNote ? (
            <p className="empty-state">Take notes from the current page or save a highlighted passage.</p>
          ) : (
            visibleNotes.map((note) => {
              const isCollapsed = !expandedNotes.has(note.id);

              const isEditing = editingNoteId === note.id;

              return (
                <article className={`note-item ${isCollapsed ? 'collapsed' : ''} ${note.kind === 'citation' ? 'note-item--citation' : ''}`} id={`note-${note.id}`} key={note.id}>
                  <header>
                    <strong>{getNoteTitle(note)}</strong>
                    <span className="note-type-label">
                      {note.kind === 'page' ? 'Page notes' : note.kind === 'citation' ? 'Citation' : note.kind === 'manual' ? 'Note' : 'Selection note'}
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
                            const target = notes.find((n) => getNoteTitle(n).toLowerCase() === name.toLowerCase());
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
                            {folders.map((folder) => (
                              <option key={folder.id} value={folder.id}>
                                {folder.name}
                              </option>
                            ))}
                          </select>
                        </label>
                      </footer>
                    </>
                  )}
                </article>

              );
            })
          )}
          </div>
        </section>
      ) : null}

      {activeTab === 'citations' ? (
        <section className="citations-area" aria-label="Citations">
          {citationRows.map((citation) => (
            <article className="citation-item" key={citation.label}>
              <div>
                <h3>{citation.label}</h3>
                <p>{citation.value}</p>
              </div>
              <Button
                aria-label={`Copy ${citation.label} citation`}
                onClick={() => copyText(citation.value)}
                size="icon"
                type="button"
                variant="outline"
              >
                <Clipboard aria-hidden="true" size={15} />
              </Button>
            </article>
          ))}
        </section>
      ) : null}

      <form className="input-bar" onSubmit={handleSubmit}>
        <Textarea
          aria-label="Ask a research question"
          onChange={(event) => setInput(event.target.value)}
          placeholder="Ask about this page..."
          rows={2}
          value={input}
        />
        <Button type="submit" aria-label="Send message">
          <Send aria-hidden="true" size={16} />
          Send
        </Button>
      </form>

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
              “{folderPendingDelete.name}” will be deleted. Its notes will be moved to the General
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

      {toast ? (
        <div className="toast" role="status" aria-live="polite">
          {toast}
        </div>
      ) : null}
    </main>
  );
}

export default App;
