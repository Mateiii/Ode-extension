import type { PageMetadata } from '@/lib/pageMetadata';

export type QuickNote = {
  id: string;
  text: string;
  createdAt: string;
  folderId?: string;
  kind?: 'selection' | 'page' | 'manual';
  metadata?: PageMetadata;
  title?: string;
  url?: string;
};

export type NoteFolder = {
  id: string;
  name: string;
  createdAt: string;
};

export type CitationStyle = 'apa' | 'mla';

export const QUICK_NOTES_STORAGE_KEY = 'quickNotes';
export const NOTE_FOLDERS_STORAGE_KEY = 'noteFolders';
export const DEFAULT_FOLDER_ID = 'default';

const getRandomId = () => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

const storageGet = <T>(key: string, fallback: T): Promise<T> =>
  new Promise((resolve) => {
    chrome.storage.local.get([key], (result) => {
      resolve((result[key] as T | undefined) ?? fallback);
    });
  });

const storageSet = (items: Record<string, unknown>): Promise<void> =>
  new Promise((resolve) => {
    chrome.storage.local.set(items, resolve);
  });

export const getQuickNotes = () => storageGet<QuickNote[]>(QUICK_NOTES_STORAGE_KEY, []);
export const getNoteFolders = async () => {
  const folders = await storageGet<NoteFolder[]>(NOTE_FOLDERS_STORAGE_KEY, []);
  if (folders.length > 0) return folders;

  const defaultFolder: NoteFolder = {
    id: DEFAULT_FOLDER_ID,
    name: 'General',
    createdAt: new Date().toISOString(),
  };

  await storageSet({ [NOTE_FOLDERS_STORAGE_KEY]: [defaultFolder] });
  return [defaultFolder];
};

export async function saveQuickNote(input: Omit<QuickNote, 'id' | 'createdAt'>) {
  const note: QuickNote = {
    kind: 'selection',
    ...input,
    folderId: input.folderId ?? DEFAULT_FOLDER_ID,
    id: getRandomId(),
    createdAt: new Date().toISOString(),
  };
  const notes = await getQuickNotes();

  await storageSet({
    [QUICK_NOTES_STORAGE_KEY]: [note, ...notes],
  });

  return note;
}

export async function createNoteFolder(name: string) {
  const folder: NoteFolder = {
    id: getRandomId(),
    name: name.trim() || 'Untitled folder',
    createdAt: new Date().toISOString(),
  };
  const folders = await getNoteFolders();

  await storageSet({
    [NOTE_FOLDERS_STORAGE_KEY]: [...folders, folder],
  });

  return folder;
}

export async function deleteQuickNote(id: string) {
  const notes = await getQuickNotes();
  await storageSet({
    [QUICK_NOTES_STORAGE_KEY]: notes.filter((note) => note.id !== id),
  });
}

export async function moveQuickNote(id: string, folderId: string) {
  const notes = await getQuickNotes();
  await storageSet({
    [QUICK_NOTES_STORAGE_KEY]: notes.map((note) =>
      note.id === id ? { ...note, folderId } : note,
    ),
  });
}

// Deletes a folder and reassigns its notes to the default folder so notes are
// never lost. The default folder itself cannot be deleted.
export async function deleteNoteFolder(id: string) {
  if (id === DEFAULT_FOLDER_ID) return;

  const [folders, notes] = await Promise.all([getNoteFolders(), getQuickNotes()]);

  await storageSet({
    [NOTE_FOLDERS_STORAGE_KEY]: folders.filter((folder) => folder.id !== id),
    [QUICK_NOTES_STORAGE_KEY]: notes.map((note) =>
      (note.folderId || DEFAULT_FOLDER_ID) === id ? { ...note, folderId: DEFAULT_FOLDER_ID } : note,
    ),
  });
}

export async function savePageNote(input: Omit<QuickNote, 'id' | 'createdAt' | 'kind'>) {
  return saveQuickNote({
    ...input,
    kind: 'page',
  });
}

const clean = (value?: string) => value?.trim() || '';

const getDisplayUrl = (metadata?: PageMetadata, url?: string) =>
  clean(metadata?.canonicalUrl) || clean(url);

const getTitle = (metadata?: PageMetadata, title?: string) =>
  clean(metadata?.title) || clean(title) || 'Untitled page';

const getAuthor = (metadata?: PageMetadata) => {
  const author = clean(metadata?.author);
  return author && author.toLowerCase() !== 'unknown author' ? author : '';
};

const getYear = (publishedDate?: string) => {
  const date = clean(publishedDate);
  const yearMatch = date.match(/\b\d{4}\b/);
  return yearMatch?.[0] || 'n.d.';
};

const formatAccessDate = () =>
  new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date());

export function formatCitation(
  style: CitationStyle,
  metadata?: PageMetadata,
  fallback?: { title?: string; url?: string },
) {
  const author = getAuthor(metadata);
  const title = getTitle(metadata, fallback?.title);
  const siteName = clean(metadata?.siteName);
  const url = getDisplayUrl(metadata, fallback?.url);
  const year = getYear(metadata?.publishedDate);

  if (style === 'apa') {
    const authorPart = author || siteName || title;
    const sitePart = siteName && siteName !== authorPart ? `${siteName}. ` : '';

    return `${authorPart}. (${year}). ${title}. ${sitePart}${url}`.trim();
  }

  const authorPart = author ? `${author}. ` : '';
  const sitePart = siteName ? `${siteName}, ` : '';
  const accessPart = `Accessed ${formatAccessDate()}.`;

  return `${authorPart}"${title}." ${sitePart}${url}. ${accessPart}`.trim();
}
