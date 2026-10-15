// Edge Function: nudge-tick (called every minute by pg_cron or backup timer)
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

serve(async (_req) => {
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // SQL query using FOR UPDATE SKIP LOCKED to prevent double processing
    const { data: updatedNudges, error } = await supabase.rpc("process_nudge_tick");

    if (error) {
      // Fallback query if RPC isn't deployed
      const now = new Date().toISOString();
      const { data: dueNudges } = await supabase
        .from("nudges")
        .select("id, level, level4_count, task_id, receiver_id, sender_id")
        .is("resolved_at", null)
        .lte("next_fire_at", now)
        .limit(50);

      if (dueNudges && dueNudges.length > 0) {
        for (const n of dueNudges) {
          const nextLvl = Math.min(n.level + 1, 4);
          const intervalMs = nextLvl === 2 ? 3 * 60000 : nextLvl === 3 ? 2 * 60000 : 1 * 60000;
          const nextFire = new Date(Date.now() + intervalMs).toISOString();

          await supabase
            .from("nudges")
            .update({
              level: nextLvl,
              last_sent_at: now,
              level4_count: n.level === 4 ? n.level4_count + 1 : n.level4_count,
              next_fire_at: nextFire,
            })
            .eq("id", n.id);
        }
      }
    }

    return new Response(JSON.stringify({ success: true, processed: updatedNudges?.length ?? 0 }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
});
