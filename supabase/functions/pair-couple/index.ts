// Edge Function: pair-couple
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

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing authorization header");

    const { data: { user }, error: authError } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
    if (authError || !user) throw new Error("Unauthorized");

    const { action, code, displayName } = await req.json();

    if (action === "create") {
      // 1. Generate 6-char pairing code (alphanumeric, no confusing chars like 0/O, 1/I)
      const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
      let inviteCode = "";
      for (let i = 0; i < 6; i++) {
        inviteCode += alphabet[Math.floor(Math.random() * alphabet.length)];
      }

      // 2. Create couple row
      const { data: couple, error: coupleError } = await supabase
        .from("couples")
        .insert({
          invite_code: inviteCode,
          code_expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          locked: false,
        })
        .select()
        .single();

      if (coupleError) throw coupleError;

      // 3. Upsert user profile
      const { error: profileError } = await supabase.from("profiles").upsert({
        id: user.id,
        couple_id: couple.id,
        display_name: displayName || "Partner A",
      });
      if (profileError) throw profileError;

      // 4. Initialize streak
      await supabase.from("streaks").insert({ couple_id: couple.id, current_streak: 0, best_streak: 0, freeze_tokens: 1 });

      return new Response(JSON.stringify({ success: true, couple, inviteCode }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "join") {
      if (!code) throw new Error("Missing pairing code");

      // Find couple with this code
      const { data: couple, error: findError } = await supabase
        .from("couples")
        .select("id, locked, code_expires_at")
        .eq("invite_code", code.toUpperCase().trim())
        .single();

      if (findError || !couple) throw new Error("Invalid or expired pairing code");
      if (couple.locked) throw new Error("This couple is already full");

      // Verify count < 2
      const { count } = await supabase
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .eq("couple_id", couple.id);

      if ((count || 0) >= 2) throw new Error("Couple already has 2 members");

      // Link user, null code, set locked to true
      await supabase.from("profiles").upsert({
        id: user.id,
        couple_id: couple.id,
        display_name: displayName || "Partner B",
      });

      await supabase
        .from("couples")
        .update({ invite_code: null, locked: true })
        .eq("id", couple.id);

      return new Response(JSON.stringify({ success: true, coupleId: couple.id }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    throw new Error("Invalid action");
  } catch (err: any) {
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
