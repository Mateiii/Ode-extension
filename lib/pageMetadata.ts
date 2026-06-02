export type PageMetadata = {
  title: string;
  author: string;
  canonicalUrl: string;
  publishedDate: string;
  siteName: string;
};

const getMetaContent = (selectors: string[]) => {
  for (const selector of selectors) {
    const value = document.querySelector<HTMLMetaElement>(selector)?.content?.trim();
    if (value) return value;
  }

  return '';
};

const BY_PREFIX = /^(by|author|authored by|written by|posted by|from)\s*:?\s*/i;

function cleanAuthorText(raw: string): string {
  return raw.replace(BY_PREFIX, '').replace(/\s+/g, ' ').trim();
}

function isPlausibleAuthor(text: string): boolean {
  return text.length > 1 && text.length < 100 && !/[{}[\]<>]/.test(text);
}

function scrapeAuthor(): string {
  // 1. Meta tags — fastest and most reliable
  const fromMeta = getMetaContent([
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
  ]);
  if (fromMeta) return fromMeta;

  // 2. JSON-LD structured data
  for (const script of Array.from(document.querySelectorAll('script[type="application/ld+json"]'))) {
    try {
      const data: unknown = JSON.parse(script.textContent ?? '');
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        if (typeof item !== 'object' || item === null) continue;
        const raw = (item as Record<string, unknown>).author;
        if (!raw) continue;
        let name = '';
        if (typeof raw === 'string') {
          name = raw.trim();
        } else if (typeof raw === 'object' && !Array.isArray(raw)) {
          name = String((raw as Record<string, unknown>).name ?? '').trim();
        } else if (Array.isArray(raw) && raw.length > 0) {
          const first = raw[0];
          name = typeof first === 'string' ? first.trim() : String((first as Record<string, unknown>).name ?? '').trim();
        }
        if (name && isPlausibleAuthor(name)) return name;
      }
    } catch {
      // malformed JSON-LD — skip
    }
  }

  // 3. rel="author" anchor
  const relAuthor = document.querySelector<HTMLAnchorElement>('a[rel="author"]');
  if (relAuthor) {
    const text = cleanAuthorText(relAuthor.textContent?.trim() ?? '');
    if (isPlausibleAuthor(text)) return text;
  }

  // 4. Microdata itemprop="author"
  const itemAuthor = document.querySelector<HTMLElement>('[itemprop="author"]');
  if (itemAuthor) {
    const nameEl = itemAuthor.querySelector<HTMLElement>('[itemprop="name"]');
    const text = cleanAuthorText((nameEl ?? itemAuthor).textContent?.trim() ?? '');
    if (isPlausibleAuthor(text)) return text;
  }

  // 5. Common byline / author DOM patterns
  const bylineSelectors = [
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
  ];
  for (const sel of bylineSelectors) {
    try {
      const el = document.querySelector<HTMLElement>(sel);
      if (!el) continue;
      const text = cleanAuthorText(el.textContent?.replace(/\s+/g, ' ').trim() ?? '');
      if (isPlausibleAuthor(text)) return text;
    } catch {
      // ignore invalid selectors
    }
  }

  return '';
}

export function scrapePageMetadata(): PageMetadata {
  const title =
    document.title.trim() ||
    getMetaContent([
      'meta[property="og:title"]',
      'meta[name="twitter:title"]',
      'meta[name="citation_title"]',
    ]) ||
    'Untitled page';

  const author = scrapeAuthor() || 'Unknown author';

  const canonicalUrl =
    document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href ||
    getMetaContent(['meta[property="og:url"]']) ||
    window.location.href;

  const publishedDate = getMetaContent([
    'meta[property="article:published_time"]',
    'meta[name="citation_publication_date"]',
    'meta[name="date"]',
    'meta[name="dc.date"]',
    'meta[name="DC.date.issued"]',
  ]);

  const siteName =
    getMetaContent([
      'meta[property="og:site_name"]',
      'meta[name="application-name"]',
      'meta[name="twitter:site"]',
    ]) || window.location.hostname;

  return {
    title,
    author,
    canonicalUrl,
    publishedDate,
    siteName,
  };
}
