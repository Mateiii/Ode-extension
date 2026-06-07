import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.WXT_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.WXT_SUPABASE_ANON_KEY as string;

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
});

export type SupabaseUser = {
  id: string;
  email?: string;
  user_metadata: { is_premium?: boolean };
};

export async function getIsPremiumUser(): Promise<boolean> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return false;
  return session.user.user_metadata?.is_premium === true;
}

export async function signInWithEmail(
  email: string,
  password: string,
): Promise<{ error: string | null }> {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  return { error: error?.message ?? null };
}

export async function signUpWithEmail(
  email: string,
  password: string,
): Promise<{ error: string | null }> {
  const { error } = await supabase.auth.signUp({ email, password });
  return { error: error?.message ?? null };
}

export async function signOut(): Promise<void> {
  await supabase.auth.signOut();
}
