import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function requiredEnv(name: string) {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

function normalizedRole(value: unknown) {
  return String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const supabaseUrl = requiredEnv("SUPABASE_URL");
    const anonKey = requiredEnv("SUPABASE_ANON_KEY");
    const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing Authorization header" }, 401);

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData.user) return json({ error: "Invalid user session" }, 401);

    const { data: profile, error: profileError } = await userClient
      .from("profiles")
      .select("id,clinic_id,role,active")
      .eq("id", userData.user.id)
      .single();
    if (profileError || !profile) return json({ error: "CapDent profile not found" }, 404);

    const role = normalizedRole(profile.role);
    const clinicAuthority = role === "owner" || role === "head_doctor";
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const confirmation = String(body.confirmation || "").trim().toUpperCase();
    const expected = clinicAuthority ? "DELETE CLINIC" : "DELETE ACCOUNT";
    if (confirmation !== expected) return json({ error: `Type ${expected} to confirm deletion` }, 400);

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    if (clinicAuthority) {
      if (!profile.clinic_id) return json({ error: "Clinic not found" }, 409);

      // Storage objects are not database-FK cascaded. Remove every object whose
      // first path segment is this clinic id before the clinic row is deleted.
      const clinicPrefix = `${profile.clinic_id}/`;
      const buckets = ["avatars", "prescriptions", "xrays", "patient-files", "clinic-logos"];
      for (const bucket of buckets) {
        let offset = 0;
        while (true) {
          const { data: objects, error: listError } = await admin.storage.from(bucket).list(profile.clinic_id, {
            limit: 100,
            offset,
            sortBy: { column: "name", order: "asc" },
          });
          if (listError) {
            // A bucket may not exist in older deployments; do not weaken DB deletion
            // for a missing optional bucket, but fail for other storage errors.
            if (!String(listError.message || "").toLowerCase().includes("bucket")) throw listError;
            break;
          }
          if (!objects?.length) break;
          const paths = objects.filter((item) => item.name && item.id).map((item) => `${clinicPrefix}${item.name}`);
          if (paths.length) {
            const { error: removeError } = await admin.storage.from(bucket).remove(paths);
            if (removeError) throw removeError;
          }
          if (objects.length < 100) break;
          // Removed rows collapse the listing, so continue at offset zero.
          offset = 0;
        }
      }

      const { error: deleteError } = await admin.rpc("delete_capdent_clinic_for_account_deletion", {
        p_clinic_id: profile.clinic_id,
        p_requesting_user_id: userData.user.id,
      });
      if (deleteError) throw deleteError;

      // Delete all Auth users that belonged to the clinic. The RPC returns after
      // deleting public clinic/profile rows, so it records the IDs in a temporary
      // deletion queue that this function consumes.
      const { data: queuedUsers, error: queueError } = await admin
        .from("capdent_account_deletion_queue")
        .select("user_id")
        .eq("clinic_id", profile.clinic_id);
      if (queueError) throw queueError;

      for (const row of queuedUsers || []) {
        const userId = String(row.user_id || "");
        if (!userId) continue;
        const { error: authDeleteError } = await admin.auth.admin.deleteUser(userId);
        if (authDeleteError) throw authDeleteError;
      }
      await admin.from("capdent_account_deletion_queue").delete().eq("clinic_id", profile.clinic_id);

      return json({ ok: true, mode: "clinic_and_account", message: "Clinic and associated CapDent accounts deleted." });
    }

    const { error: detachError } = await admin.rpc("detach_capdent_staff_profile_for_account_deletion", {
      p_user_id: userData.user.id,
    });
    if (detachError) throw detachError;

    const { error: authDeleteError } = await admin.auth.admin.deleteUser(userData.user.id);
    if (authDeleteError) throw authDeleteError;

    return json({ ok: true, mode: "profile_only", message: "CapDent account deleted. Clinic-owned data was preserved." });
  } catch (error) {
    console.error("CapDent account deletion error", error instanceof Error ? error.message : error);
    return json({ error: error instanceof Error ? error.message : "Account deletion failed" }, 500);
  }
});
