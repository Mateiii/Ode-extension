import { supabase } from './supabase';
import type { QuickNote } from './researchStorage';

export async function syncNoteToCloud(note: QuickNote, userId: string): Promise<void> {
  const payload = { ...note, user_id: userId };
  await supabase.from('notes').upsert(payload);
  if (note.kind === 'citation') {
    await supabase.from('citations').upsert(payload);
  }
}
