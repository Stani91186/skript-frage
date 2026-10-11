import { createClient } from "@supabase/supabase-js";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./config";

export const configured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
export const supabase = createClient(SUPABASE_URL || "http://localhost", SUPABASE_ANON_KEY || "missing", {
  auth: { persistSession: true, autoRefreshToken: true },
});
