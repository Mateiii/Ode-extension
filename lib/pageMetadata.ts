export type PageMetadata = {
  title: string;
  author: string;
  canonicalUrl: string;
};

const getMetaContent = (selectors: string[]) => {
  for (const selector of selectors) {
    const value = document.querySelector<HTMLMetaElement>(selector)?.content?.trim();
    if (value) return value;
  }

  return '';
};

export function scrapePageMetadata(): PageMetadata {
  const title =
    document.title.trim() ||
    getMetaContent([
      'meta[property="og:title"]',
      'meta[name="twitter:title"]',
      'meta[name="citation_title"]',
    ]) ||
    'Untitled page';

  const author =
    getMetaContent([
      'meta[name="author"]',
      'meta[property="article:author"]',
      'meta[name="citation_author"]',
      'meta[name="byl"]',
    ]) || 'Unknown author';

  const canonicalUrl =
    document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href ||
    getMetaContent(['meta[property="og:url"]']) ||
    window.location.href;

  return {
    title,
    author,
    canonicalUrl,
  };
}
