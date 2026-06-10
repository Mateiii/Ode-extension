import type { PageMetadata } from '@/lib/pageMetadata';

export type Project = {
  id: string;
  name: string;
  createdAt: string;
  defaultFolderId: string;
  sourcesFolderId?: string;
};

export type QuickNote = {
  id: string;
  text: string;
  createdAt: string;
  folderId?: string;
  kind?: 'selection' | 'page' | 'manual' | 'citation' | 'ai-chat';
  edited?: boolean;
  pinned?: boolean;
  customTitle?: string;
  metadata?: PageMetadata;
  title?: string;
  url?: string;
  syncedToCloud?: boolean;
};

export type NoteFolder = {
  id: string;
  name: string;
  createdAt: string;
  projectId: string;
};

export type CitationStyle = 'apa' | 'mla' | 'harvard' | 'bibtex';

export const QUICK_NOTES_STORAGE_KEY = 'quickNotes';
export const NOTE_FOLDERS_STORAGE_KEY = 'noteFolders';
export const PROJECTS_STORAGE_KEY = 'projects';
export const ACTIVE_PROJECT_STORAGE_KEY = 'activeProjectId';
export const DEFAULT_FOLDER_ID = 'default';
export const SOURCES_FOLDER_ID = 'sources';
export const DEFAULT_PROJECT_ID = 'default-project';

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

export const getProjects = async (): Promise<Project[]> => {
  const projects = await storageGet<Project[]>(PROJECTS_STORAGE_KEY, []);
  if (projects.length > 0) return projects;

  const defaultProject: Project = {
    id: DEFAULT_PROJECT_ID,
    name: 'General Research',
    createdAt: new Date().toISOString(),
    defaultFolderId: DEFAULT_FOLDER_ID,
    sourcesFolderId: SOURCES_FOLDER_ID,
  };

  await storageSet({ [PROJECTS_STORAGE_KEY]: [defaultProject] });
  return [defaultProject];
};

export const getNoteFolders = async (): Promise<NoteFolder[]> => {
  const raw = await storageGet<Array<Partial<NoteFolder> & { id: string; name: string; createdAt: string }>>(
    NOTE_FOLDERS_STORAGE_KEY,
    [],
  );

  let needsMigration = false;
  const folders: NoteFolder[] = raw.map((f) => {
    if (!f.projectId) {
      needsMigration = true;
      return { ...f, projectId: DEFAULT_PROJECT_ID } as NoteFolder;
    }
    return f as NoteFolder;
  });

  if (folders.length === 0) {
    const defaultFolder: NoteFolder = {
      id: DEFAULT_FOLDER_ID,
      name: 'General',
      createdAt: new Date().toISOString(),
      projectId: DEFAULT_PROJECT_ID,
    };
    const sourcesFolder: NoteFolder = {
      id: SOURCES_FOLDER_ID,
      name: 'Sources',
      createdAt: new Date().toISOString(),
      projectId: DEFAULT_PROJECT_ID,
    };
    await storageSet({ [NOTE_FOLDERS_STORAGE_KEY]: [defaultFolder, sourcesFolder] });
    return [defaultFolder, sourcesFolder];
  }

  if (needsMigration) {
    await storageSet({ [NOTE_FOLDERS_STORAGE_KEY]: folders });
  }

  return folders;
};

export async function createProject(name: string): Promise<Project> {
  const projectId = getRandomId();
  const defaultFolder: NoteFolder = {
    id: getRandomId(),
    name: 'General',
    createdAt: new Date().toISOString(),
    projectId,
  };
  const sourcesFolder: NoteFolder = {
    id: getRandomId(),
    name: 'Sources',
    createdAt: new Date().toISOString(),
    projectId,
  };
  const project: Project = {
    id: projectId,
    name: name.trim() || 'Untitled project',
    createdAt: new Date().toISOString(),
    defaultFolderId: defaultFolder.id,
    sourcesFolderId: sourcesFolder.id,
  };

  const [projects, folders] = await Promise.all([getProjects(), getNoteFolders()]);

  await storageSet({
    [PROJECTS_STORAGE_KEY]: [...projects, project],
    [NOTE_FOLDERS_STORAGE_KEY]: [...folders, defaultFolder, sourcesFolder],
  });

  return project;
}

export async function deleteProject(id: string): Promise<void> {
  if (id === DEFAULT_PROJECT_ID) return;

  const [projects, folders, notes] = await Promise.all([
    getProjects(),
    getNoteFolders(),
    getQuickNotes(),
  ]);

  const projectFolderIds = new Set(folders.filter((f) => f.projectId === id).map((f) => f.id));

  await storageSet({
    [PROJECTS_STORAGE_KEY]: projects.filter((p) => p.id !== id),
    [NOTE_FOLDERS_STORAGE_KEY]: folders.filter((f) => f.projectId !== id),
    [QUICK_NOTES_STORAGE_KEY]: notes.filter(
      (n) => !projectFolderIds.has(n.folderId || DEFAULT_FOLDER_ID),
    ),
  });
}

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

export async function createNoteFolder(name: string, projectId: string = DEFAULT_PROJECT_ID) {
  const folder: NoteFolder = {
    id: getRandomId(),
    name: name.trim() || 'Untitled folder',
    createdAt: new Date().toISOString(),
    projectId,
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

export async function updateQuickNote(id: string, updates: { text: string; customTitle?: string }) {
  const notes = await getQuickNotes();
  await storageSet({
    [QUICK_NOTES_STORAGE_KEY]: notes.map((note) =>
      note.id === id ? { ...note, ...updates, edited: true } : note,
    ),
  });
}

export async function markNoteAsSynced(id: string): Promise<void> {
  const notes = await getQuickNotes();
  await storageSet({
    [QUICK_NOTES_STORAGE_KEY]: notes.map((n) =>
      n.id === id ? { ...n, syncedToCloud: true } : n,
    ),
  });
}

/**
 * Merges notes fetched from Supabase into local storage.
 * Notes that already exist locally (by ID) are left untouched — local edits take priority.
 * New notes from the cloud are prepended.
 * Writing to storage triggers the chrome.storage.onChanged listener in App.tsx,
 * which updates the React notes state automatically.
 */
export async function mergeCloudNotes(cloudNotes: QuickNote[]): Promise<void> {
  if (cloudNotes.length === 0) return;
  const local = await getQuickNotes();
  const localIds = new Set(local.map((n) => n.id));
  const incoming = cloudNotes.filter((n) => !localIds.has(n.id));
  if (incoming.length === 0) return;
  await storageSet({ [QUICK_NOTES_STORAGE_KEY]: [...incoming, ...local] });
}

export async function pinQuickNote(id: string, pinned: boolean) {
  const notes = await getQuickNotes();
  await storageSet({
    [QUICK_NOTES_STORAGE_KEY]: notes.map((note) =>
      note.id === id ? { ...note, pinned } : note,
    ),
  });
}

export async function swapQuickNotes(idA: string, idB: string) {
  const notes = await getQuickNotes();
  const iA = notes.findIndex((n) => n.id === idA);
  const iB = notes.findIndex((n) => n.id === idB);
  if (iA === -1 || iB === -1) return;
  const next = [...notes];
  [next[iA], next[iB]] = [next[iB], next[iA]];
  await storageSet({ [QUICK_NOTES_STORAGE_KEY]: next });
}

// Deletes a folder and reassigns its notes to the project's default folder.
// A project's default folder cannot be deleted via this path.
export async function deleteNoteFolder(id: string) {
  if (id === DEFAULT_FOLDER_ID) return;

  const [projects, folders, notes] = await Promise.all([
    getProjects(),
    getNoteFolders(),
    getQuickNotes(),
  ]);

  const folder = folders.find((f) => f.id === id);
  if (!folder) return;

  const project = projects.find((p) => p.id === folder.projectId);
  const fallbackFolderId = project?.defaultFolderId ?? DEFAULT_FOLDER_ID;

  if (id === fallbackFolderId) return;

  await storageSet({
    [NOTE_FOLDERS_STORAGE_KEY]: folders.filter((f) => f.id !== id),
    [QUICK_NOTES_STORAGE_KEY]: notes.map((note) =>
      (note.folderId || DEFAULT_FOLDER_ID) === id ? { ...note, folderId: fallbackFolderId } : note,
    ),
  });
}

// Migration: creates a Sources folder for any project that doesn't have one yet.
// Returns up-to-date projects + folders so callers avoid a second fetch.
export async function ensureProjectSourcesFolders(): Promise<{ projects: Project[]; folders: NoteFolder[] }> {
  let [projects, folders] = await Promise.all([getProjects(), getNoteFolders()]);

  let projectsChanged = false;
  const newFolders: NoteFolder[] = [];

  const updatedProjects = projects.map((project) => {
    if (project.sourcesFolderId && folders.some((f) => f.id === project.sourcesFolderId)) {
      return project;
    }
    const sourcesId = project.id === DEFAULT_PROJECT_ID ? SOURCES_FOLDER_ID : getRandomId();
    if (!folders.some((f) => f.id === sourcesId)) {
      newFolders.push({
        id: sourcesId,
        name: 'Sources',
        createdAt: new Date().toISOString(),
        projectId: project.id,
      });
    }
    projectsChanged = true;
    return { ...project, sourcesFolderId: sourcesId };
  });

  const foldersChanged = newFolders.length > 0;
  const updatedFolders = foldersChanged ? [...folders, ...newFolders] : folders;

  if (projectsChanged || foldersChanged) {
    await storageSet({
      ...(projectsChanged ? { [PROJECTS_STORAGE_KEY]: updatedProjects } : {}),
      ...(foldersChanged ? { [NOTE_FOLDERS_STORAGE_KEY]: updatedFolders } : {}),
    });
  }

  return { projects: updatedProjects, folders: updatedFolders };
}

export async function savePageNote(input: Omit<QuickNote, 'id' | 'createdAt' | 'kind'>) {
  return saveQuickNote({
    ...input,
    kind: 'page',
  });
}

export const getNoteTitle = (note: QuickNote): string =>
  note.customTitle || note.metadata?.title || note.title || 'Untitled page';

export async function resolveNoteTitle(
  desired: string,
  targetFolderId: string,
  excludeNoteId?: string,
): Promise<string> {
  const [allNotes, allFolders] = await Promise.all([getQuickNotes(), getNoteFolders()]);

  const targetFolder = allFolders.find((f) => f.id === targetFolderId);
  const projectId = targetFolder?.projectId ?? DEFAULT_PROJECT_ID;

  const projectFolderIds = new Set(
    allFolders.filter((f) => f.projectId === projectId).map((f) => f.id),
  );

  const projectNotes = allNotes.filter((n) =>
    projectFolderIds.has(n.folderId || DEFAULT_FOLDER_ID),
  );

  const taken = (t: string) =>
    projectNotes.some(
      (n) => n.id !== excludeNoteId && getNoteTitle(n).toLowerCase() === t.toLowerCase(),
    );

  if (!taken(desired)) return desired;

  const conflictInSameFolder = projectNotes.some(
    (n) =>
      n.id !== excludeNoteId &&
      getNoteTitle(n).toLowerCase() === desired.toLowerCase() &&
      (n.folderId || DEFAULT_FOLDER_ID) === targetFolderId,
  );

  if (conflictInSameFolder) {
    for (let i = 2; ; i++) {
      const candidate = `${desired} (${i})`;
      if (!taken(candidate)) return candidate;
    }
  }

  const folderName = allFolders.find((f) => f.id === targetFolderId)?.name ?? 'General';
  const withFolder = `${desired} (${folderName})`;
  if (!taken(withFolder)) return withFolder;
  for (let i = 2; ; i++) {
    const candidate = `${withFolder} (${i})`;
    if (!taken(candidate)) return candidate;
  }
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

  if (style === 'harvard') {
    const authorPart = author ? `${author} ` : (siteName ? `${siteName} ` : '');
    const sitePart = siteName ? ` ${siteName}.` : '';
    return `${authorPart}(${year}) ${title}.${sitePart} Available at: ${url} [Accessed: ${formatAccessDate()}].`.trim();
  }

  if (style === 'bibtex') {
    const keyBase = (author || siteName || title)
      .split(/\s+/)[0]
      .replace(/[^a-z0-9]/gi, '')
      .toLowerCase() || 'source';
    const key = `${keyBase}${year === 'n.d.' ? '' : year}`;
    const authorField = author || siteName || 'Unknown';
    return [
      `@misc{${key},`,
      `  author  = {${authorField}},`,
      `  title   = {{${title}}},`,
      `  year    = {${year}},`,
      `  url     = {${url}},`,
      `  note    = {Accessed: ${formatAccessDate()}}`,
      `}`,
    ].join('\n');
  }

  // MLA
  const authorPart = author ? `${author}. ` : '';
  const sitePart = siteName ? `${siteName}, ` : '';
  const accessPart = `Accessed ${formatAccessDate()}.`;
  return `${authorPart}"${title}." ${sitePart}${url}. ${accessPart}`.trim();
}
