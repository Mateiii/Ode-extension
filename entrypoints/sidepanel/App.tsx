import { FormEvent, useEffect, useRef, useState } from 'react';
import {
  BookOpen,
  ChevronDown,
  Clipboard,
  Download,
  ExternalLink,
  FilePlus,
  FileText,
  FolderPlus,
  Send,
  Settings,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import type { FactCheckResult } from '@/lib/factCheck';
import type { PageMetadata } from '@/lib/pageMetadata';
import {
  formatCitation,
  createNoteFolder,
  deleteQuickNote,
  moveQuickNote,
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
  action: 'ask-ai' | 'fact-check' | 'save-note';
  text: string;
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
  const [collapsedNotes, setCollapsedNotes] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState('');
  const handledActionKeysRef = useRef<Set<string>>(new Set());
  const toastTimerRef = useRef<number | undefined>(undefined);
  const scrollRef = useRef<HTMLDivElement>(null);

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
            return {
              title: document.title.trim() || getMeta('meta[property="og:title"]', 'meta[name="twitter:title"]') || '',
              author: getMeta('meta[name="author"]', 'meta[property="article:author"]', 'meta[name="citation_author"]') || '',
              canonicalUrl:
                (document.querySelector('link[rel="canonical"]') as HTMLLinkElement | null)?.href ||
                getMeta('meta[property="og:url"]') ||
                window.location.href,
              publishedDate: getMeta('meta[property="article:published_time"]', 'meta[name="citation_publication_date"]', 'meta[name="date"]') || '',
              siteName: getMeta('meta[property="og:site_name"]', 'meta[name="application-name"]') || window.location.hostname,
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
                  title: meta.title || tab.title,
                  url: meta.canonicalUrl || tab.url,
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
        if (message.note) {
          const savedNote = message.note;
          setNotes((current) => {
            if (current.some((note) => note.id === savedNote.id)) return current;
            return [savedNote, ...current];
          });
        } else {
          getQuickNotes().then(setNotes);
        }

        setActiveTab('notes');
        showToast('Saved to notes.');
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

  const toggleNoteCollapsed = (noteId: string) => {
    setCollapsedNotes((current) => {
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

  const exportNote = (note: QuickNote, format: 'markdown' | 'json') => {
    const title = note.metadata?.title || note.title || 'Untitled note';
    const slug = title.replace(/[^a-z0-9]+/gi, '-').toLowerCase().replace(/^-+|-+$/g, '') || 'note';

    if (format === 'json') {
      downloadBlob(JSON.stringify(note, null, 2), `${slug}.json`, 'application/json');
      return;
    }

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
              {message.factCheck ? null : <p>{message.content}</p>}
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

              return (
                <button
                  className={folder.id === selectedFolderId ? 'active' : ''}
                  key={folder.id}
                  onClick={() => setSelectedFolderId(folder.id)}
                  type="button"
                >
                  <span>{folder.name}</span>
                  <small>{count}</small>
                </button>
              );
            })}
          </div>
          </div>

          <div className="notes-list">
          {visibleNotes.length === 0 ? (
            <p className="empty-state">Take notes from the current page or save a highlighted passage.</p>
          ) : (
            visibleNotes.map((note) => {
              const isCollapsed = collapsedNotes.has(note.id);

              return (
                <article className={`note-item ${isCollapsed ? 'collapsed' : ''}`} key={note.id}>
                  <header>
                    <strong>{note.metadata?.title || note.title || 'Untitled page'}</strong>
                    <span>{note.kind === 'page' ? 'Page notes' : 'Selection note'}</span>
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
                        onClick={() => exportNote(note, 'markdown')}
                        size="icon"
                        type="button"
                        variant="outline"
                      >
                        <Download aria-hidden="true" size={14} />
                      </Button>
                      <Button
                        aria-label="Export note as JSON"
                        className="note-icon-btn"
                        onClick={() => exportNote(note, 'json')}
                        size="icon"
                        type="button"
                        variant="outline"
                      >
                        <FileText aria-hidden="true" size={14} />
                      </Button>
                      <Button
                        aria-label="Delete note"
                        className="note-icon-btn note-delete"
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
                        onClick={() => toggleNoteCollapsed(note.id)}
                        size="icon"
                        type="button"
                        variant="outline"
                      >
                        <ChevronDown aria-hidden="true" size={14} />
                      </Button>
                    </div>
                  </header>
                  {isCollapsed ? null : (
                    <>
                      <p>{note.text}</p>
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

      {toast ? (
        <div className="toast" role="status" aria-live="polite">
          {toast}
        </div>
      ) : null}
    </main>
  );
}

export default App;
