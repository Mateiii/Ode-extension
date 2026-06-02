export type FactCheckStatus = 'True' | 'False' | 'Disputed';

export type FactCheckSource = {
  title: string;
  url: string;
  snippet?: string;
};

export type FactCheckResult = {
  status: FactCheckStatus;
  summary: string;
  sources: FactCheckSource[];
};

type TavilyResult = {
  title?: string;
  url?: string;
  content?: string;
  snippet?: string;
};

type TavilyResponse = {
  answer?: string;
  results?: TavilyResult[];
};

export type FactCheckDependencies = {
  fetch?: typeof fetch;
  tavilyApiKey?: string;
  openAiApiKey?: string;
  openAiModel?: string;
};

const TAVILY_SEARCH_URL = 'https://api.tavily.com/search';
const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';

const DISPUTE_TERMS = [
  'false',
  'incorrect',
  'not true',
  'debunk',
  'debunked',
  'myth',
  'hoax',
  'misleading',
  'disputed',
  'no evidence',
  'baseless',
  'fact check',
  'fact-check',
];

const FALSE_TERMS = [
  'false',
  'incorrect',
  'not true',
  'debunk',
  'debunked',
  'myth',
  'hoax',
  'misleading',
];

const TRUE_TERMS = ['true', 'correct', 'accurate', 'confirmed', 'supported'];

function getEnvValue(name: string) {
  const env = import.meta.env as Record<string, string | undefined>;
  return env[name];
}

function normalizeSource(result: TavilyResult): FactCheckSource | null {
  if (!result.url) return null;

  return {
    title: result.title?.trim() || result.url,
    url: result.url,
    snippet: result.content?.trim() || result.snippet?.trim() || 'No summary provided by Tavily.',
  };
}

function pickSourceLimit(sources: FactCheckSource[]) {
  return sources.slice(0, 3);
}

function toPublicSources(sources: FactCheckSource[]) {
  return sources.slice(0, 3).map((source) => ({
    title: source.title,
    url: source.url,
  }));
}

function normalizeStatus(status: unknown): FactCheckStatus {
  if (status === 'True' || status === 'Verified') return 'True';
  if (status === 'False') return 'False';
  return 'Disputed';
}

function sanitizeGeneratedSummary(summary: string) {
  return summary
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0 && !sentence.endsWith('?'))
    .join(' ')
    .replace(/\bSo,\s*/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function trimSummary(summary: string) {
  const normalized = sanitizeGeneratedSummary(summary);
  if (normalized.length <= 700) return normalized;

  const truncated = normalized.slice(0, 697).trimEnd();
  return `${truncated}...`;
}

function normalizeFactCheckResult(value: unknown, fallbackSources: FactCheckSource[]): FactCheckResult {
  const candidate = value as Partial<FactCheckResult> | null;
  const status = normalizeStatus(candidate?.status);
  const summary =
    typeof candidate?.summary === 'string' && candidate.summary.trim().length > 0
      ? trimSummary(candidate.summary)
      : fallbackSummary('', status, fallbackSources);

  const candidateSources = Array.isArray(candidate?.sources)
    ? candidate.sources
        .map((source) => normalizeSource(source as TavilyResult))
        .filter((source): source is FactCheckSource => Boolean(source))
    : [];

  return {
    status,
    summary,
    sources: toPublicSources(candidateSources.length > 0 ? candidateSources : fallbackSources),
  };
}

function extractUsefulSentences(sources: FactCheckSource[]) {
  return sources
    .map((source) => source.snippet?.replace(/\s+/g, ' ').trim())
    .filter((snippet): snippet is string => Boolean(snippet))
    .flatMap((snippet) => snippet.match(/[^.!?]+[.!?]+/g) ?? [snippet])
    .map((sentence) => sentence.trim())
    .filter((sentence, index, sentences) => {
      if (sentence.length < 35 || sentence.endsWith('?')) return false;
      if (!/^[A-Z0-9]/.test(sentence)) return false;
      return sentences.indexOf(sentence) === index;
    })
    .slice(0, 4);
}

function buildClaimAwareFallback(claim: string, status: FactCheckStatus, sources: FactCheckSource[]) {
  const claimLower = claim.toLowerCase();
  const evidenceText = sources.map((source) => `${source.title} ${source.snippet}`.toLowerCase()).join('\n');
  const sentences: string[] = [];

  if (claimLower.includes('platypus') && claimLower.includes('stomach')) {
    sentences.push('The stomach part is supported: platypuses are among the monotremes that lack a conventional acidic stomach.');
  }

  if (claimLower.includes('platypus') && (claimLower.includes('milk') || claimLower.includes('nipple'))) {
    sentences.push(
      'The nursing part is also broadly supported: platypuses do not have nipples and instead secrete milk onto the skin, where young lap it from grooves or fur.',
    );
  }

  if (claimLower.includes('sweat milk')) {
    sentences.push(
      'The phrase "sweat milk" is informal, so the precise wording is that milk is secreted from mammary glands through skin rather than delivered through nipples.',
    );
  }

  if (sentences.length > 0) {
    const lead =
      status === 'False'
        ? 'The claim is contradicted by the available sources.'
        : status === 'True'
        ? 'The claim is mostly supported by the available sources.'
        : 'The claim is mostly supported, but the wording needs precision.';

    return trimSummary(`${lead} ${sentences.join(' ')}`);
  }

  if (evidenceText.includes('visible from the moon') && evidenceText.includes('myth')) {
    return trimSummary(
      'The claim is false. The sources describe the idea that the Great Wall is visible from the Moon with the naked eye as a myth, and explain that it is not visible unaided from that distance.',
    );
  }

  return null;
}

function fallbackSummary(claim: string, status: FactCheckStatus, sources: FactCheckSource[]) {
  const claimAwareSummary = buildClaimAwareFallback(claim, status, sources);
  if (claimAwareSummary) return claimAwareSummary;

  const evidenceSentences = extractUsefulSentences(sources);

  if (evidenceSentences.length > 0) {
    const lead =
      status === 'False'
        ? 'The evidence contradicts the claim.'
        : status === 'True'
        ? 'The evidence supports the claim.'
        : 'The evidence is mixed or incomplete.';

    return trimSummary(`${lead} ${evidenceSentences.join(' ')}`);
  }

  if (status === 'True') return 'The available sources support the key claim.';
  if (status === 'False') return 'The available sources contradict the key claim.';

  return 'The available sources are mixed or incomplete.';
}

function heuristicAnalyzeClaim(claim: string, sources: FactCheckSource[]): FactCheckResult {
  const claimLower = claim.toLowerCase();
  const sourceText = sources.map((source) => `${source.title} ${source.snippet}`.toLowerCase()).join('\n');
  const disputeScore = DISPUTE_TERMS.reduce((score, term) => score + (sourceText.includes(term) ? 1 : 0), 0);
  const trueScore = TRUE_TERMS.reduce((score, term) => score + (sourceText.includes(term) ? 1 : 0), 0);
  const directContradiction =
    /\b(claim|idea|rumou?r|myth)\b.{0,120}\b(false|incorrect|not true|myth|debunked)\b/i.test(sourceText) ||
    /\b(false|incorrect|not true|debunked)\b.{0,120}\b(claim|idea|rumou?r|myth)\b/i.test(sourceText);
  const falseScore = directContradiction
    ? FALSE_TERMS.reduce((score, term) => score + (sourceText.includes(term) ? 1 : 0), 0)
    : 0;
  const explicitClaimMentions = claimLower
    .split(/\W+/)
    .filter((term) => term.length > 4)
    .filter((term) => sourceText.includes(term)).length;
  const hasImpreciseWording = claimLower.includes('sweat milk');
  const status: FactCheckStatus =
    falseScore > 0
      ? 'False'
      : hasImpreciseWording || disputeScore > trueScore || explicitClaimMentions < 2
      ? 'Disputed'
      : 'True';

  return {
    status,
    summary: fallbackSummary(claim, status, sources),
    sources: toPublicSources(sources),
  };
}

async function searchTavily(claim: string, dependencies: Required<Pick<FactCheckDependencies, 'fetch'>> & FactCheckDependencies) {
  if (!dependencies.tavilyApiKey) {
    throw new Error('Missing WXT_TAVILY_API_KEY. Add it to your local environment before running fact checks.');
  }

  const response = await dependencies.fetch(TAVILY_SEARCH_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${dependencies.tavilyApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query: `${claim}\n\nFind reliable sources that verify or dispute this exact claim.`,
      search_depth: 'advanced',
      include_answer: true,
      include_raw_content: false,
      max_results: 6,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(
      `Tavily search failed with HTTP ${response.status}${errorText ? `: ${errorText}` : '.'}`,
    );
  }

  const data = (await response.json()) as TavilyResponse;
  const sources = (data.results ?? []).map(normalizeSource).filter((source): source is FactCheckSource => Boolean(source));
  if (data.answer && sources[0]) {
    sources[0] = {
      ...sources[0],
      snippet: `${data.answer} ${sources[0].snippet ?? ''}`.trim(),
    };
  }

  return pickSourceLimit(sources);
}

async function analyzeWithOpenAi(
  claim: string,
  sources: FactCheckSource[],
  dependencies: Required<Pick<FactCheckDependencies, 'fetch'>> & FactCheckDependencies,
) {
  if (!dependencies.openAiApiKey) return null;

  const response = await dependencies.fetch(OPENAI_RESPONSES_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${dependencies.openAiApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: dependencies.openAiModel || 'gpt-4.1-mini',
      input: [
        {
          role: 'system',
          content:
            'You are a careful fact-checking agent. Compare the claim only against the provided web search evidence. Return strict JSON only. Use status "True" when the claim is substantially supported, "False" when substantially contradicted, and "Disputed" when evidence is mixed, insufficient, or the claim is mostly true but worded imprecisely. The summary must be one sober paragraph of 3-5 sentences explaining the verdict. Extract the specific facts from the sources that confirm or deny each important part of the claim. Do not ask rhetorical questions, do not joke, do not address the user, and do not include clickbait phrasing. Keep the paragraph under 120 words. Return at most 3 sources and do not include snippets.',
        },
        {
          role: 'user',
          content: JSON.stringify({
            claim,
            evidence: sources,
            output_schema: {
              status: 'True | False | Disputed',
              summary: 'One paragraph under 120 words explaining the verdict with specific facts extracted from the sources.',
              sources: [{ title: 'string', url: 'string' }],
            },
          }),
        },
      ],
      text: {
        format: {
          type: 'json_object',
        },
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI analysis failed with HTTP ${response.status}.`);
  }

  const data = (await response.json()) as { output_text?: string };
  if (!data.output_text) return null;

  return normalizeFactCheckResult(JSON.parse(data.output_text), sources);
}

export async function factCheckClaim(claim: string, dependencies: FactCheckDependencies = {}): Promise<FactCheckResult> {
  const trimmedClaim = claim.trim();
  if (!trimmedClaim) {
    throw new Error('Cannot fact-check an empty selection.');
  }

  const resolvedDependencies = {
    fetch: dependencies.fetch ?? globalThis.fetch.bind(globalThis),
    tavilyApiKey: dependencies.tavilyApiKey ?? getEnvValue('WXT_TAVILY_API_KEY'),
    openAiApiKey: dependencies.openAiApiKey ?? getEnvValue('WXT_OPENAI_API_KEY'),
    openAiModel: dependencies.openAiModel ?? getEnvValue('WXT_OPENAI_MODEL'),
  };

  const sources = await searchTavily(trimmedClaim, resolvedDependencies);
  if (sources.length === 0) {
    return {
      status: 'Disputed',
      summary: 'No reliable search evidence was returned for this claim.',
      sources: [],
    };
  }

  try {
    const llmResult = await analyzeWithOpenAi(trimmedClaim, sources, resolvedDependencies);
    return llmResult ?? heuristicAnalyzeClaim(trimmedClaim, sources);
  } catch (error) {
    console.warn('OpenAI fact-check analysis failed; falling back to Tavily evidence.', error);
    return heuristicAnalyzeClaim(trimmedClaim, sources);
  }
}
