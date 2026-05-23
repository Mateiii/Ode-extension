import { FormEvent, useEffect, useRef, useState } from 'react';
import { BookOpen, Clipboard, FileText, Send, Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import type { PageMetadata } from '@/lib/pageMetadata';
import {
  formatCitation,
  getQuickNotes,
  QUICK_NOTES_STORAGE_KEY,
  type QuickNote,
} from '@/lib/researchStorage';

type ChatMessage = {
  id: string;
  role: 'assistant' | 'user';
  content: string;
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

type RuntimeMessage = SelectionMessage | SelectionContextMessage;
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

function App() {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [context, setContext] = useState<SelectionContextMessage | null>(null);
  const [notes, setNotes] = useState<QuickNote[]>([]);
  const [activeTab, setActiveTab] = useState<ActiveTab>('chat');
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getQuickNotes().then(setNotes);

    const listener = (
      changes: Record<string, { oldValue?: unknown; newValue?: unknown }>,
      areaName: string,
    ) => {
      if (areaName !== 'local' || !changes[QUICK_NOTES_STORAGE_KEY]) return;

      setNotes((changes[QUICK_NOTES_STORAGE_KEY].newValue as QuickNote[] | undefined) ?? []);
    };

    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, []);

  useEffect(() => {
    const listener = (message: RuntimeMessage) => {
      if (message.type === 'sidepanel-selection-context') {
        setContext(message);
        return;
      }

      if (message.type !== 'sidepanel-selection-action') return;

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
              ? 'Fact-check agent wiring is reserved for the backend phase. The selected claim is ready to send.'
              : 'Selection received. Backend AI handling will be connected in the next phase.',
        },
      ]);
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

      <section className="context-box" aria-label="Current page context">
        <div className="context-header">
          <div>
            <p className="eyebrow">Context</p>
            <h2>{context?.metadata?.title || context?.title || 'No page selected'}</h2>
          </div>
        </div>

        <dl className="metadata-list">
          <div>
            <dt>Author</dt>
            <dd>{context?.metadata?.author || 'Unknown author'}</dd>
          </div>
          <div>
            <dt>Canonical URL</dt>
            <dd>{context?.metadata?.canonicalUrl || context?.url || 'No URL captured yet'}</dd>
          </div>
        </dl>

        <blockquote>
          {context?.text || 'Highlight a sentence on the current page to send it here.'}
        </blockquote>
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
              <p>{message.content}</p>
            </article>
          ))}
        </section>
      ) : null}

      {activeTab === 'notes' ? (
        <section className="notes-area" aria-label="Quick notes">
          {notes.length === 0 ? (
            <p className="empty-state">Select text on a page and choose Save to Notes.</p>
          ) : (
            notes.map((note) => (
              <article className="note-item" key={note.id}>
                <p>{note.text}</p>
                <footer>
                  <span>{note.metadata?.title || note.title || 'Untitled page'}</span>
                  <time dateTime={note.createdAt}>
                    {new Intl.DateTimeFormat('en-US', {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    }).format(new Date(note.createdAt))}
                  </time>
                </footer>
              </article>
            ))
          )}
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
    </main>
  );
}

export default App;
