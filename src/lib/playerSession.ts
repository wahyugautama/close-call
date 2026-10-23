import { supabase } from "./supabase";

export async function ensurePlayerSession() {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError && userError.name !== "AuthSessionMissingError") {
    throw userError;
  }

  if (user) return user;

  const { data, error } = await supabase.auth.signInAnonymously();

  if (error) throw error;
  if (!data.user) throw new Error("Could not create player session");

  return data.user;
}
