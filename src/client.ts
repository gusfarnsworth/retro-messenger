import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
export const configured = Boolean(url && key && url.startsWith('https://') && !url.includes('YOUR_PROJECT'));
// Never put a Supabase secret/service-role key in VITE_* variables.
export const supabase = configured ? createClient(url!, key!, {
  auth: { autoRefreshToken:true, persistSession:true, detectSessionInUrl:true }
}) : null;

export type Profile = {
  id:string; username:string; display_name:string; personal_message:string;
  avatar_url:string | null; now_playing_title?:string; now_playing_artist?:string; now_playing_enabled?:boolean; status_preference:'online'|'away'|'busy'|'invisible'|'brb'|'phone'|'lunch'; last_seen_at:string | null; created_at?:string;
};
export type Contact = { user_id:string; contact_id:string; created_at:string };
export type Request = { id:string; sender_id:string; receiver_id:string; status:string; created_at:string };
export type Message = { id:string; conversation_id:string; sender_id:string; body:string; created_at:string; kind?:'text'|'file'; attachment_path?:string|null; edited_at?:string|null; deleted_at?:string|null; reply_to_id?:string|null; format?:{color?:string,bold?:boolean,italic?:boolean,underline?:boolean} };
export type Membership = { conversation_id:string; user_id:string };

export function readableError(err:unknown):string {return err instanceof Error ? err.message : String(err);}
