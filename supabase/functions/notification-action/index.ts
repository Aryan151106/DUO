// Edge Function: notification-action
// Handles background action button clicks from Web Push notifications (Done, Mercy, Doing)
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const { action, taskId, coupleId } = await req.json();

    if (!taskId) throw new Error("Missing taskId");

    if (action === "done") {
      // Mark task done (triggers on_status_change to resolve nudge and award points)
      const { error } = await supabase
        .from("tasks")
        .update({ status: "done", completed_at: new Date().toISOString() })
        .eq("id", taskId);
      if (error) throw error;
    } else if (action === "mercy") {
      // Pause or resolve active nudge with mercy status
      const { error } = await supabase
        .from("nudges")
        .update({
          resolved_at: new Date().toISOString(),
          paused_until: new Date(Date.now() + 60 * 60 * 1000).toISOString() // 1 hour pause
        })
        .eq("task_id", taskId)
        .is("resolved_at", null);
      if (error) throw error;
    }

    return new Response(JSON.stringify({ success: true, action }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
