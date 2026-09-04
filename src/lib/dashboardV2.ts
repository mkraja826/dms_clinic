import {
  DashboardStats,
  WorkflowDashboardSummary,
  supabase,
} from "@/lib/supabase";

export type ClinicDashboardV2 = {
  stats: DashboardStats;
  summary: WorkflowDashboardSummary;
};

/**
 * Loads the additive dashboard v2 RPC.
 * Existing dashboards do not call this function yet.
 */
export async function getClinicDashboardV2(): Promise<ClinicDashboardV2> {
  const { data, error } = await supabase.rpc("get_clinic_dashboard_v2");

  if (error) throw error;

  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Dashboard v2 returned an invalid response.");
  }

  const response = data as Partial<ClinicDashboardV2>;

  if (!response.stats || !response.summary) {
    throw new Error("Dashboard v2 response is incomplete.");
  }

  return {
    stats: response.stats,
    summary: response.summary,
  };
}
