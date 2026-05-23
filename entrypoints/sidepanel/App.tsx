import { FormEvent, useEffect, useRef, useState } from 'react';
import { Send, Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

type ChatMessage = {
  id: string;
  role: 'assistant' | 'user';
  content: string;
};

type SelectionMessage = {
  type: 'sidepanel-selection-action';
  action: 'ask-ai' | 'fact-check' | 'save-note';
  text: string;
  title?: string;
  url?: string;
};

const actionLabels: Record<SelectionMessage['action'], string> = {
  'ask-ai': 'Ask AI',
  'fact-check': 'Fact Check',
  'save-note': 'Save Note',
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
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const listener = (message: SelectionMessage) => {
      if (message.type !== 'sidepanel-selection-action') return;

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
            message.action === 'fact-check'
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

      <section ref={scrollRef} className="chat-area" aria-label="Research chat">
        {messages.map((message) => (
          <article className={`message ${message.role}`} key={message.id}>
            <span>{message.role === 'assistant' ? 'Øde' : 'You'}</span>
            <p>{message.content}</p>
          </article>
        ))}
      </section>

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
