const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';

type PageNotesDependencies = {
  fetch?: typeof fetch;
  openAiApiKey?: string;
  openAiModel?: string;
};

function getEnvValue(name: string) {
  const env = import.meta.env as Record<string, string | undefined>;
  return env[name];
}

// Strips boilerplate that article/journal pages put ahead of the real
// content: DOI fragments, author lists with affiliation superscripts, PMCID/
// PMID lines, and nav labels. Also jumps to the Abstract/Introduction when present.
function cleanForNotes(text: string): string {
  let t = text.replace(/\s+/g, ' ').trim();

  const marker = t.search(/\b(Abstract|Introduction|Summary)\b/);
  if (marker > 0 && marker < 2500) {
    t = t.slice(marker).replace(/^(Abstract|Introduction|Summary)\b[:.\s]*/i, '');
  }

  return t
    .replace(/\bPMCID:\s*\S+/gi, '')
    .replace(/\bPMID:\s*\d+/gi, '')
    .replace(/\bdoi:?\s*\S+/gi, '')
    .replace(/\b(Author information|Article notes|Copyright and License information)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// A "sentence" is boilerplate if a large share of its tokens are bare numbers
// or single letters (affiliation markers, citation ids).
function looksLikeBoilerplate(sentence: string): boolean {
  const tokens = sentence.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;
  const noisy = tokens.filter((tok) => /^[\d.,;:✉()/-]+$/.test(tok) || tok.length === 1).length;
  return noisy / tokens.length > 0.25;
}

function extractiveFallback(text: string): string {
  const cleaned = cleanForNotes(text);
  if (!cleaned) return 'No readable text found on this page.';

  const sentences = cleaned.match(/[^.!?]+[.!?]+/g) ?? [cleaned];
  const bullets = sentences
    .map((s) => s.trim())
    .filter((s) => s.length > 40 && !looksLikeBoilerplate(s))
    .slice(0, 5)
    .map((s) => `• ${s}`);

  return bullets.length > 0 ? bullets.join('\n\n') : cleaned.slice(0, 800);
}

export async function summarizePageNotes(
  text: string,
  title: string,
  dependencies: PageNotesDependencies = {},
): Promise<string> {
  const resolvedDeps = {
    fetch: dependencies.fetch ?? globalThis.fetch.bind(globalThis),
    openAiApiKey: dependencies.openAiApiKey ?? getEnvValue('WXT_OPENAI_API_KEY'),
    openAiModel: dependencies.openAiModel ?? getEnvValue('WXT_OPENAI_MODEL'),
  };

  if (!resolvedDeps.openAiApiKey) {
    return extractiveFallback(text);
  }

  const cleaned = cleanForNotes(text);
  const truncated = cleaned.length > 6000 ? `${cleaned.slice(0, 6000)}…` : cleaned;

  try {
    const response = await resolvedDeps.fetch(OPENAI_RESPONSES_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resolvedDeps.openAiApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: resolvedDeps.openAiModel || 'gpt-4o-mini',
        input: [
          {
            role: 'system',
            content:
              'You are a research assistant. Given the text of a web page, write concise, well-structured notes a researcher would want to keep. ' +
              'Start with a single line "Source: <author(s) or publication>" only if the authors or publication are clearly identifiable; keep author lists to at most the first 3 names followed by "et al." if there are more. ' +
              'Then add one blank line, then 3-6 bullet points. Begin each bullet with "• " and separate every bullet with a blank line. ' +
              'Each bullet is one clear sentence capturing a key fact, argument, or finding. Do not dump raw author lists or citation IDs into the bullets. Do not add markdown headers or bold. Return plain text only.',
          },
          {
            role: 'user',
            content: `Page title: ${title}\n\n${truncated}`,
          },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI returned HTTP ${response.status}`);
    }

    const data = (await response.json()) as { output_text?: string };
    const notes = data.output_text?.trim();
    if (!notes) throw new Error('Empty response from OpenAI');

    return notes;
  } catch (error) {
    console.warn('AI notes failed; falling back to extractive summary.', error);
    return extractiveFallback(text);
  }
}
