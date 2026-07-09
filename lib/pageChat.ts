const OPENAI_CHAT_URL = 'https://api.openai.com/v1/chat/completions';

/** ~3 000 tokens, keeps cost low. */
const PAGE_TEXT_LIMIT = 12_000;

function getEnvValue(name: string): string | undefined {
  return (import.meta.env as Record<string, string | undefined>)[name];
}

export type ChatTurn = { role: 'user' | 'assistant'; content: string };

function buildSystemPrompt(pageText: string): string {
  const truncated =
    pageText.length > PAGE_TEXT_LIMIT ? `${pageText.slice(0, PAGE_TEXT_LIMIT)}…` : pageText;

  return (
    'You are an elite, highly intelligent academic research co-pilot. Your goal is to help the user ' +
    'synthesize, query, and dissect the webpage text provided below.\n\n' +
    '[CRITICAL CAPABILITY: SEMANTIC REASONING]\n' +
    'Do not rely on strict keyword matching. If the user asks about a topic (e.g. "forestry sector"), also ' +
    'look for conceptual synonyms, themes, and indirect references (e.g. "forest management", "timber", ' +
    '"tree canopies", "ecosystems"). Interpret the text with academic depth. If a topic is mentioned ' +
    'generally but lacks fine detail, summarize what IS present and note what is missing. Never give a flat ' +
    '"I cannot find it" refusal when relevant thematic material exists — only say the page lacks the ' +
    'information when it genuinely contains nothing related.\n\n' +
    '[CRITICAL FEATURE: CITATION HOOKS & SOURCE JUMPING]\n' +
    'Whenever you reference a fact, finding, or summary point drawn from the text, append a markdown jump-link ' +
    'to the supporting quote using exactly this syntax:\n' +
    '[your phrasing or the quote](#scroll-quote=EXACT_RAW_QUOTE_FROM_TEXT)\n' +
    'The string after "=" MUST be copied verbatim from the webpage text (a 5–20 word span that actually ' +
    'appears in it) so the browser can locate it. Never use plain quotation marks for page text — always use ' +
    'the jump-link instead.\n' +
    'Example: The text notes that [climate change has altered global timber outputs]' +
    '(#scroll-quote=severe impacts on various sectors, including forestry) across the hemisphere.\n\n' +
    '[WEBPAGE TEXT CONTEXT]:\n' +
    (truncated || '(No page text was captured — the page may be restricted or empty.)')
  );
}

/** Folded into the latest user turn to keep gpt-4o-mini compliant with the link format. */
const CITATION_REMINDER =
  '\n\n(Reminder: cite page text only as [text](#scroll-quote=verbatim text) — never plain quotation marks.)';

export async function streamPageChat(
  pageText: string,
  history: ChatTurn[],
  onChunk: (delta: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  const apiKey = getEnvValue('WXT_OPENAI_API_KEY');
  if (!apiKey) throw new Error('OpenAI API key is not configured.');

  const model = getEnvValue('WXT_OPENAI_MODEL') ?? 'gpt-4o-mini';

  const apiHistory = history.map((turn, i) =>
    i === history.length - 1 && turn.role === 'user'
      ? { ...turn, content: turn.content + CITATION_REMINDER }
      : turn,
  );

  const apiMessages = [
    { role: 'system' as const, content: buildSystemPrompt(pageText) },
    ...apiHistory,
  ];

  const response = await fetch(OPENAI_CHAT_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    signal,
    body: JSON.stringify({
      model,
      stream: true,
      messages: apiMessages,
    }),
  });

  if (!response.ok) {
    let detail = '';
    try {
      detail = await response.text();
    } catch {}
    throw new Error(
      `OpenAI returned ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ''}`,
    );
  }

  if (!response.body) throw new Error('No response body from OpenAI.');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === 'data: [DONE]') continue;
        if (!trimmed.startsWith('data: ')) continue;

        try {
          const json = JSON.parse(trimmed.slice(6)) as {
            choices?: Array<{ delta?: { content?: string } }>;
          };
          const delta = json.choices?.[0]?.delta?.content;
          if (typeof delta === 'string' && delta) onChunk(delta);
        } catch {}
      }
    }
  } finally {
    reader.releaseLock();
  }
}
