import { extractText, getDocumentProxy } from 'unpdf';
import mammoth from 'mammoth';
import JSZip from 'jszip';

export async function extractPdfText(buffer: ArrayBuffer): Promise<string> {
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { text } = await extractText(pdf, { mergePages: true });
  return text;
}

export async function extractDocxText(buffer: ArrayBuffer): Promise<string> {
  const result = await mammoth.extractRawText({ arrayBuffer: buffer });
  return result.value;
}

export async function extractPptxText(buffer: ArrayBuffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  const slideFiles = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => {
      const numA = parseInt(a.match(/\d+/)?.[0] ?? '0', 10);
      const numB = parseInt(b.match(/\d+/)?.[0] ?? '0', 10);
      return numA - numB;
    });

  const slideTexts = await Promise.all(
    slideFiles.map(async (name) => {
      const xml = await zip.files[name].async('string');
      const matches = xml.match(/<a:t[^>]*>([^<]*)<\/a:t>/g) ?? [];
      return matches.map((m) => m.replace(/<[^>]+>/g, '')).join(' ');
    }),
  );

  return slideTexts.filter(Boolean).join('\n\n');
}

export async function extractTextFromPdfUrl(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error('Failed to fetch target PDF stream.');
  const buffer = await response.arrayBuffer();
  return extractPdfText(buffer);
}

export async function extractFileText(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const ext = file.name.split('.').pop()?.toLowerCase();

  if (ext === 'pdf') return extractPdfText(buffer);
  if (ext === 'docx') return extractDocxText(buffer);
  if (ext === 'pptx') return extractPptxText(buffer);

  throw new Error(`Unsupported file type: .${ext ?? 'unknown'}`);
}
