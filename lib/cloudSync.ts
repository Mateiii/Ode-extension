import { supabase } from './supabase';
import {
  DEFAULT_FOLDER_ID,
  getNoteFolders,
  getProjects,
  getQuickNotes,
  markNotesAsSynced,
  mergeCloudFolders,
  mergeCloudNotes,
  mergeCloudProjects,
  type NoteFolder,
  type Project,
  type QuickNote,
} from './researchStorage';

// System IDs ('default-project', 'default', 'sources') are identical for every
// user, so the cloud projects/folders tables key on (id, user_id).
const WORKSPACE_ON_CONFLICT = { onConflict: 'id,user_id' };

export async function syncNoteToCloud(note: QuickNote, userId: string): Promise<boolean> {
  const noteTitle = note.customTitle ?? note.metadata?.title ?? note.title ?? 'Untitled';

  const { error: notesError } = await supabase.from('notes').upsert({
    id: note.id,
    user_id: userId,
    folder_id: note.folderId ?? null,
    note_title: noteTitle,
    content: note.text,
    created_at: note.createdAt,
    updated_at: new Date().toISOString(),
  });

  if (notesError) {
    console.error('[Ode] Cloud sync failed (notes):', notesError.message);
    return false;
  }

  if (note.kind === 'citation') {
    const rawYear = note.metadata?.publishedDate
      ? new Date(note.metadata.publishedDate).getFullYear()
      : null;
    const year = rawYear && !isNaN(rawYear) ? String(rawYear) : null;

    const authorLast = note.metadata?.author?.trim().split(/\s+/).pop() ?? '';
    const titleFirst = noteTitle.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
    const citekey = authorLast && year && titleFirst
      ? `${authorLast}${year}_${titleFirst}`
      : note.id.slice(0, 8);

    const { error: citError } = await supabase.from('citations').upsert({
      id: note.id,
      user_id: userId,
      folder_id: note.folderId ?? null,
      citekey,
      author: note.metadata?.author || null,
      title: note.metadata?.title ?? note.title ?? null,
      journal: note.metadata?.siteName ?? null,
      year,
      url: note.url ?? note.metadata?.canonicalUrl ?? null,
      created_at: note.createdAt,
    });

    if (citError) {
      console.error('[Ode] Cloud sync failed (citations):', citError.message);
      return false;
    }
  }

  return true;
}

// The `kind` field is not stored in the schema, so fetched notes default to 'manual'.
export async function fetchNotesFromCloud(userId: string): Promise<QuickNote[]> {
  const { data, error } = await supabase
    .from('notes')
    .select('id, folder_id, note_title, content, created_at')
    .eq('user_id', userId);

  if (error) {
    console.error('[Ode] Cloud fetch failed:', error.message);
    return [];
  }

  return (data ?? []).map((row) => ({
    id: row.id as string,
    text: (row.content as string | null) ?? '',
    createdAt: row.created_at as string,
    folderId: (row.folder_id as string | null) ?? DEFAULT_FOLDER_ID,
    customTitle: (row.note_title as string | null) ?? undefined,
    kind: 'manual' as const,
    syncedToCloud: true,
  }));
}

export async function syncProjectToCloud(project: Project, userId: string): Promise<boolean> {
  const { error } = await supabase.from('projects').upsert({
    id: project.id,
    user_id: userId,
    name: project.name,
    default_folder_id: project.defaultFolderId,
    sources_folder_id: project.sourcesFolderId ?? null,
    created_at: project.createdAt,
  }, WORKSPACE_ON_CONFLICT);
  if (error) console.error('[Ode] Cloud sync failed (projects):', error.message);
  return !error;
}

export async function syncFolderToCloud(folder: NoteFolder, userId: string): Promise<boolean> {
  const { error } = await supabase.from('folders').upsert({
    id: folder.id,
    user_id: userId,
    project_id: folder.projectId,
    name: folder.name,
    created_at: folder.createdAt,
  }, WORKSPACE_ON_CONFLICT);
  if (error) console.error('[Ode] Cloud sync failed (folders):', error.message);
  return !error;
}

export async function fetchWorkspaceFromCloud(
  userId: string,
): Promise<{ projects: Project[]; folders: NoteFolder[] }> {
  const [projectsRes, foldersRes] = await Promise.all([
    supabase.from('projects')
      .select('id, name, default_folder_id, sources_folder_id, created_at')
      .eq('user_id', userId),
    supabase.from('folders')
      .select('id, project_id, name, created_at')
      .eq('user_id', userId),
  ]);

  if (projectsRes.error) console.error('[Ode] Cloud fetch failed (projects):', projectsRes.error.message);
  if (foldersRes.error) console.error('[Ode] Cloud fetch failed (folders):', foldersRes.error.message);

  return {
    projects: (projectsRes.data ?? []).map((row) => ({
      id: row.id as string,
      name: (row.name as string | null) ?? 'Untitled project',
      createdAt: row.created_at as string,
      defaultFolderId: (row.default_folder_id as string | null) ?? DEFAULT_FOLDER_ID,
      sourcesFolderId: (row.sources_folder_id as string | null) ?? undefined,
    })),
    folders: (foldersRes.data ?? []).map((row) => ({
      id: row.id as string,
      name: (row.name as string | null) ?? 'Untitled folder',
      createdAt: row.created_at as string,
      projectId: row.project_id as string,
    })),
  };
}

// Two-way sync: pull cloud projects/folders first so notes land in their real
// folders, then cloud notes; then push the local workspace and any notes the
// cloud has never accepted (created before sign-in/premium, or a failed save-time sync).
export async function syncNotesWithCloud(
  userId: string,
): Promise<{ pulled: number; pushed: number; pushFailed: number }> {
  const workspace = await fetchWorkspaceFromCloud(userId);
  await mergeCloudProjects(workspace.projects);
  await mergeCloudFolders(workspace.folders);

  const cloudNotes = await fetchNotesFromCloud(userId);
  const pulled = await mergeCloudNotes(cloudNotes);

  const [projects, folders, localNotes] = await Promise.all([
    getProjects(),
    getNoteFolders(),
    getQuickNotes(),
  ]);

  for (const project of projects) await syncProjectToCloud(project, userId);
  for (const folder of folders) await syncFolderToCloud(folder, userId);

  const unsynced = localNotes.filter((n) => !n.syncedToCloud);
  const pushedIds: string[] = [];
  for (const note of unsynced) {
    if (await syncNoteToCloud(note, userId)) pushedIds.push(note.id);
  }
  await markNotesAsSynced(pushedIds);

  return { pulled, pushed: pushedIds.length, pushFailed: unsynced.length - pushedIds.length };
}

// Deletes the citation row too, so a local delete isn't resurrected by the next sign-in merge.
export async function deleteNoteFromCloud(noteId: string, userId: string): Promise<void> {
  await supabase.from('citations').delete().eq('id', noteId).eq('user_id', userId);
  const { error } = await supabase.from('notes').delete().eq('id', noteId).eq('user_id', userId);
  if (error) console.error('[Ode] Cloud delete failed:', error.message);
}

// Its notes were reassigned locally with syncedToCloud cleared, so the next sync re-pushes their new folder_id.
export async function deleteFolderFromCloud(folderId: string, userId: string): Promise<void> {
  const { error } = await supabase.from('folders').delete().eq('id', folderId).eq('user_id', userId);
  if (error) console.error('[Ode] Cloud delete failed (folders):', error.message);
}

// Mirrors the local cascade delete: notes + citations in its folders, its folders, the project.
export async function deleteProjectFromCloud(
  projectId: string,
  folderIds: string[],
  userId: string,
): Promise<void> {
  if (folderIds.length > 0) {
    await supabase.from('citations').delete().in('folder_id', folderIds).eq('user_id', userId);
    await supabase.from('notes').delete().in('folder_id', folderIds).eq('user_id', userId);
  }
  await supabase.from('folders').delete().eq('project_id', projectId).eq('user_id', userId);
  const { error } = await supabase.from('projects').delete().eq('id', projectId).eq('user_id', userId);
  if (error) console.error('[Ode] Cloud delete failed (projects):', error.message);
}
