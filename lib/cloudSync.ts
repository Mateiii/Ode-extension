import { supabase } from './supabase';
import { DEFAULT_FOLDER_ID, type QuickNote } from './researchStorage';

/**
 * Upserts a note into the Supabase `notes` table and, for citation-kind notes,
 * also into the `citations` table. Returns true on full success, false on any error.
 *
 * Column mapping (Supabase schema → QuickNote fields):
 *   notes:     id, user_id, folder_id, note_title, content, created_at, updated_at
 *   citations: id, user_id, folder_id, citekey, author, title, journal, year, url, created_at
 */
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

/**
 * Fetches all notes for a user from Supabase and maps them back to QuickNote shape.
 * The `kind` field is not stored in the schema, so fetched notes default to 'manual'.
 */
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
