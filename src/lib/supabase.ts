import { createClient } from '@supabase/supabase-js';

// Environment variables for Supabase (if provided)
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const hasSupabaseConfig = Boolean(
  supabaseUrl &&
  supabaseAnonKey &&
  supabaseUrl !== 'https://your-project.supabase.co' &&
  !supabaseUrl.includes('placeholder')
);

// Real Supabase client instance (or fallback client)
export const supabase = hasSupabaseConfig
  ? createClient(supabaseUrl, supabaseAnonKey)
  : createClient('https://mock-duo-app.supabase.co', 'mock-anon-key', {
      auth: { persistSession: false },
    });

// High-fidelity BroadcastChannel for cross-tab & local real-time synchronization
export const duoBroadcast = typeof window !== 'undefined'
  ? new BroadcastChannel('duo_couple_realtime_channel')
  : null;

export interface RealtimeEnvelope<T = any> {
  type:
    | 'TASK_MUTATION'
    | 'MESSAGE_SENT'
    | 'NUDGE_TRIGGERED'
    | 'NUDGE_RESOLVED'
    | 'CALL_SIGNAL'
    | 'DOODLE_STROKE'
    | 'DOODLE_CLEAR'
    | 'TYPING_STATUS'
    | 'PRESENCE_UPDATE'
    | 'PRESENCE_SYNC'
    | 'FOCUS_UPDATE'
    | 'WISHLIST_UPDATE'
    | 'CINEMA_REACTION';
  senderId: string;
  coupleId: string;
  payload: T;
  timestamp: number;
}

export function broadcastEvent<T>(type: RealtimeEnvelope<T>['type'], payload: T, senderId: string, coupleId: string) {
  if (duoBroadcast) {
    const envelope: RealtimeEnvelope<T> = {
      type,
      senderId,
      coupleId,
      payload,
      timestamp: Date.now(),
    };
    duoBroadcast.postMessage(envelope);
  }
}
