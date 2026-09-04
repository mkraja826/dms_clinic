import { invalidateAppDataCache, supabase } from "@/lib/supabase";

function readRealtimeEnabled() {
  return String(process.env.EXPO_PUBLIC_ENABLE_REALTIME ?? "")
    .trim()
    .toLowerCase() === "true";
}

export function isClinicRealtimeEnabled() {
  return readRealtimeEnabled();
}

type DashboardRealtimeOptions = {
  clinicId?: string | null;
  onChange: () => void | Promise<void>;
  debounceMs?: number;
};

/**
 * Creates one clinic-filtered channel for dashboard-changing records.
 */
export function subscribeClinicDashboardRealtime({
  clinicId,
  onChange,
  debounceMs = 450,
}: DashboardRealtimeOptions) {
  const realtimeEnabled = readRealtimeEnabled();

  if (!realtimeEnabled) {
    console.info(
      "Clinic Realtime disabled. Set EXPO_PUBLIC_ENABLE_REALTIME=true and restart Expo."
    );
    return () => undefined;
  }

  if (!clinicId) {
    console.warn("Clinic Realtime not started: clinic_id is missing from the profile.");
    return () => undefined;
  }

  let refreshTimer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  const scheduleRefresh = (
    scopes: Array<"dashboard" | "appointments" | "payments">
  ) => {
    scopes.forEach((scope) => invalidateAppDataCache(scope));

    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      if (disposed) return;

      Promise.resolve(onChange()).catch((error) => {
        console.warn("Realtime dashboard refresh failed:", error);
      });
    }, Math.max(200, debounceMs));
  };

  const channel = supabase
    .channel(`clinic-dashboard:${clinicId}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "appointments",
        filter: `clinic_id=eq.${clinicId}`,
      },
      () => scheduleRefresh(["dashboard", "appointments"])
    )
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "payments",
        filter: `clinic_id=eq.${clinicId}`,
      },
      () => scheduleRefresh(["dashboard", "payments"])
    )
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "invoices",
        filter: `clinic_id=eq.${clinicId}`,
      },
      () => scheduleRefresh(["dashboard", "payments"])
    )
    .subscribe((status, error) => {
      if (status === "SUBSCRIBED") {
        console.info(`Clinic Realtime subscribed for ${clinicId}`);
        return;
      }

      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        console.warn(`Clinic Realtime channel status: ${status}`, error);
      }
    });

  return () => {
    disposed = true;
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = null;
    void supabase.removeChannel(channel);
  };
}
