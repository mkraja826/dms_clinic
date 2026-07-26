import { invalidateAppDataCache, supabase } from "@/lib/supabase";

function realtimeEnabled() {
  return String(process.env.EXPO_PUBLIC_ENABLE_REALTIME ?? "true").trim().toLowerCase() !== "false";
}

export function isClinicRealtimeEnabled() {
  return realtimeEnabled();
}

type Options = {
  clinicId?: string | null;
  onChange: () => void | Promise<void>;
  debounceMs?: number;
  appointments?: boolean;
  payments?: boolean;
  treatments?: boolean;
  channelKey?: string;
};

let channelCounter = 0;

export function subscribeClinicWorkflowRealtime({
  clinicId,
  onChange,
  debounceMs = 350,
  appointments = false,
  payments = false,
  treatments = false,
  channelKey = "workflow",
}: Options) {
  if (!realtimeEnabled() || !clinicId) return () => undefined;

  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;
  const refresh = (scopes: Array<"dashboard" | "appointments" | "payments" | "treatments">) => {
    scopes.forEach((scope) => invalidateAppDataCache(scope));
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      if (!disposed) Promise.resolve(onChange()).catch((error) => console.warn("Realtime refresh failed", error));
    }, Math.max(200, debounceMs));
  };

  channelCounter += 1;
  let channel = supabase.channel("clinic:" + channelKey + ":" + clinicId + ":" + channelCounter);

  if (appointments) {
    channel = channel.on("postgres_changes", {
      event: "*", schema: "public", table: "appointments", filter: "clinic_id=eq." + clinicId,
    }, () => refresh(["dashboard", "appointments"]));
  }

  if (payments) {
    channel = channel
      .on("postgres_changes", {
        event: "INSERT", schema: "public", table: "payments", filter: "clinic_id=eq." + clinicId,
      }, () => refresh(["dashboard", "payments", "treatments"]))
      .on("postgres_changes", {
        event: "*", schema: "public", table: "invoices", filter: "clinic_id=eq." + clinicId,
      }, () => refresh(["dashboard", "payments", "treatments"]));
  }

  if (treatments) {
    channel = channel.on("postgres_changes", {
      event: "*", schema: "public", table: "treatments", filter: "clinic_id=eq." + clinicId,
    }, () => refresh(["dashboard", "treatments"]));
  }

  channel.subscribe((status, error) => {
    if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") console.warn("Realtime " + channelKey + ": " + status, error);
  });

  return () => {
    disposed = true;
    if (timer) clearTimeout(timer);
    void supabase.removeChannel(channel);
  };
}

export function subscribeClinicDashboardRealtime(options: Pick<Options, "clinicId" | "onChange" | "debounceMs" | "channelKey">) {
  return subscribeClinicWorkflowRealtime({ ...options, appointments: true, payments: true });
}

export function subscribeClinicOngoingTreatmentsRealtime(options: Pick<Options, "clinicId" | "onChange" | "debounceMs">) {
  return subscribeClinicWorkflowRealtime({ ...options, treatments: true, payments: true, channelKey: "ongoing-treatments" });
}
