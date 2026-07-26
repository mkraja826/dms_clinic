import {
  GOOGLE_PLAY_INTELLIGENCE_PRODUCT_ID,
  GOOGLE_PLAY_PROFESSIONAL_PRODUCT_ID,
} from "@/lib/googlePlayBilling";
import { getCurrentProfile, supabase } from "@/lib/supabase";

export type ClinicSubscriptionStatus = "free" | "trial" | "active" | "expired" | "cancelled" | "grace_period";
export type ClinicPlanName = "free" | "professional" | "clinic_intelligence";
export type SubscriptionBillingCycle = "monthly" | "yearly";
export type SubscriptionPaymentStatus = "pending_review" | "approved" | "rejected" | "cancelled";
export type SubscriptionBillingProvider = "google_play" | "manual";
export type GooglePlaySubscriptionStatus =
  | "not_started"
  | "trial_started"
  | "active"
  | "grace_period"
  | "account_hold"
  | "expired"
  | "cancelled"
  | "pending_verification";

export const FREE_PLAN_AMOUNT = 0;
export const SUBSCRIPTION_PROFESSIONAL_AMOUNT = 799;
export const SUBSCRIPTION_INTELLIGENCE_AMOUNT = 1499;
export const SUBSCRIPTION_MONTHLY_AMOUNT = SUBSCRIPTION_PROFESSIONAL_AMOUNT;
export const SUBSCRIPTION_YEARLY_AMOUNT = SUBSCRIPTION_PROFESSIONAL_AMOUNT * 12;

export type ClinicSubscription = {
  id: string;
  clinic_id: string;
  plan_name: string;
  status: ClinicSubscriptionStatus;
  trial_started_at: string | null;
  trial_ends_at: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  monthly_price: number | null;
  visit_limit: number | null;
  billing_provider?: SubscriptionBillingProvider | null;
  google_play_product_id?: string | null;
  google_play_purchase_token?: string | null;
  google_play_order_id?: string | null;
  google_play_auto_renewing?: boolean | null;
  google_play_status?: GooglePlaySubscriptionStatus | null;
  google_play_linked_at?: string | null;
  google_play_last_event_at?: string | null;
  google_play_last_verified_at?: string | null;
  created_at: string;
  updated_at: string;
};

export type SubscriptionPaymentRequest = {
  id: string;
  clinic_id: string;
  subscription_id: string | null;
  requested_by: string | null;
  billing_cycle: SubscriptionBillingCycle;
  amount: number;
  payment_method: string;
  payment_reference: string | null;
  owner_note: string | null;
  admin_note: string | null;
  status: SubscriptionPaymentStatus;
  requested_at: string;
  reviewed_at: string | null;
  reviewed_by: string | null;
  created_at: string;
  updated_at: string;
};

export type SubscriptionAccess = {
  allowed: boolean;
  blocked: boolean;
  reason: string;
  statusLabel: string;
};

export function subscriptionBillingAmount(cycle: SubscriptionBillingCycle) {
  return cycle === "yearly" ? SUBSCRIPTION_YEARLY_AMOUNT : SUBSCRIPTION_MONTHLY_AMOUNT;
}

export function subscriptionBillingLabel(cycle: SubscriptionBillingCycle) {
  return cycle === "yearly" ? "Yearly" : "Monthly";
}

export function subscriptionPaymentStatusLabel(status?: SubscriptionPaymentStatus | null) {
  if (status === "approved") return "Approved";
  if (status === "rejected") return "Rejected";
  if (status === "cancelled") return "Cancelled";
  return "Pending review";
}

export function subscriptionPaymentStatusTone(status?: SubscriptionPaymentStatus | null) {
  if (status === "approved") return "success" as const;
  if (status === "rejected" || status === "cancelled") return "danger" as const;
  return "warning" as const;
}

export function getClinicPlanName(subscription: ClinicSubscription | null): ClinicPlanName {
  const planName = String(subscription?.plan_name || "").toLowerCase();
  const productId = String(subscription?.google_play_product_id || "").toLowerCase();

  if (planName === "clinic_intelligence" || productId === GOOGLE_PLAY_INTELLIGENCE_PRODUCT_ID) {
    return "clinic_intelligence";
  }

  if (
    planName === "professional" ||
    planName === "google_play_monthly" ||
    productId === GOOGLE_PLAY_PROFESSIONAL_PRODUCT_ID
  ) {
    return "professional";
  }

  return "free";
}

export function getClinicPlanLabel(plan: ClinicPlanName) {
  if (plan === "clinic_intelligence") return "Intelligence";
  if (plan === "professional") return "Cloud";
  return "Free";
}

export function getClinicPlanPrice(plan: ClinicPlanName) {
  if (plan === "clinic_intelligence") return SUBSCRIPTION_INTELLIGENCE_AMOUNT;
  if (plan === "professional") return SUBSCRIPTION_PROFESSIONAL_AMOUNT;
  return FREE_PLAN_AMOUNT;
}

export function hasClinicIntelligenceAccess(subscription: ClinicSubscription | null) {
  return getClinicPlanName(subscription) === "clinic_intelligence" && subscription?.status === "active";
}

export function hasGooglePlayAutopay(subscription: ClinicSubscription | null) {
  return Boolean(subscription?.google_play_purchase_token && subscription?.billing_provider === "google_play");
}

export function googlePlayBillingStatusLabel(status?: GooglePlaySubscriptionStatus | null) {
  if (status === "trial_started") return "Google Play linked";
  if (status === "active") return "Google Play active";
  if (status === "grace_period") return "Google Play grace period";
  if (status === "account_hold") return "Google Play account hold";
  if (status === "pending_verification") return "Google Play verification pending";
  if (status === "expired") return "Google Play expired";
  if (status === "cancelled") return "Google Play cancelled";
  return "Google Play not started";
}

export async function getClinicSubscription() {
  const profile = await getCurrentProfile();

  if (!profile?.clinic_id) return null;

  const { data, error } = await supabase
    .from("clinic_subscriptions")
    .select(
      "id,clinic_id,plan_name,status,trial_started_at,trial_ends_at,current_period_start,current_period_end,monthly_price,visit_limit,billing_provider,google_play_product_id,google_play_purchase_token,google_play_order_id,google_play_auto_renewing,google_play_status,google_play_linked_at,google_play_last_event_at,google_play_last_verified_at,created_at,updated_at"
    )
    .eq("clinic_id", profile.clinic_id)
    .maybeSingle<ClinicSubscription>();

  if (error) {
    console.warn("Subscription load failed:", error.message);
    return null;
  }

  return data;
}

export async function getSubscriptionPaymentRequests(limit = 5) {
  const profile = await getCurrentProfile();

  if (!profile?.clinic_id) return [] as SubscriptionPaymentRequest[];

  const { data, error } = await supabase
    .from("clinic_subscription_payments")
    .select(
      "id,clinic_id,subscription_id,requested_by,billing_cycle,amount,payment_method,payment_reference,owner_note,admin_note,status,requested_at,reviewed_at,reviewed_by,created_at,updated_at"
    )
    .eq("clinic_id", profile.clinic_id)
    .order("requested_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.warn("Subscription payment requests load failed:", error.message);
    return [] as SubscriptionPaymentRequest[];
  }

  return (data || []) as SubscriptionPaymentRequest[];
}

export async function requestSubscriptionPayment(input: {
  billingCycle: SubscriptionBillingCycle;
  paymentReference?: string;
  ownerNote?: string;
}) {
  const { data, error } = await supabase.rpc("request_clinic_subscription_payment", {
    p_billing_cycle: input.billingCycle,
    p_payment_reference: input.paymentReference?.trim() || null,
    p_owner_note: input.ownerNote?.trim() || null,
  });

  if (error) throw error;
  return data as SubscriptionPaymentRequest;
}

export function daysUntil(value?: string | null) {
  if (!value) return null;

  const end = new Date(value).getTime();
  if (!Number.isFinite(end)) return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const diff = end - today.getTime();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

function isExpiredDate(value?: string | null) {
  if (!value) return false;
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return false;
  return time < Date.now();
}

export function formatPlanDate(value?: string | null) {
  if (!value) return "Not set";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not set";

  return date.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function formatSubscriptionDateTime(value?: string | null) {
  if (!value) return "Not set";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not set";

  return date.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function getSubscriptionAccess(subscription: ClinicSubscription | null): SubscriptionAccess {
  if (!subscription) {
    return {
      allowed: true,
      blocked: false,
      reason: "Free plan access is available. Upgrade is optional for paid owner tools.",
      statusLabel: "Free",
    };
  }

  const plan = getClinicPlanName(subscription);
  const planLabel = getClinicPlanLabel(plan);

  if (subscription.status === "cancelled" || subscription.google_play_status === "cancelled") {
    return {
      allowed: true,
      blocked: false,
      reason: "Paid access is cancelled. Core clinic work continues on the Free plan.",
      statusLabel: "Free",
    };
  }

  if (subscription.google_play_status === "account_hold") {
    return {
      allowed: true,
      blocked: false,
      reason: "Google Play payment needs attention. Core clinic work continues on the Free plan.",
      statusLabel: "Payment issue",
    };
  }

  if (subscription.status === "expired" || subscription.google_play_status === "expired") {
    return {
      allowed: true,
      blocked: false,
      reason: "Paid access is expired. Core clinic work continues on the Free plan.",
      statusLabel: "Free",
    };
  }

  if (subscription.status === "active" && isExpiredDate(subscription.current_period_end)) {
    return {
      allowed: true,
      blocked: false,
      reason: "The stored paid period has ended. Core clinic work continues on the Free plan until Google Play status is refreshed.",
      statusLabel: "Free",
    };
  }

  if (subscription.status === "grace_period" && isExpiredDate(subscription.current_period_end)) {
    return {
      allowed: true,
      blocked: false,
      reason: "The grace period ended. Core clinic work continues on the Free plan.",
      statusLabel: "Free",
    };
  }

  return {
    allowed: true,
    blocked: false,
    reason: plan === "free" ? "Free plan access is active." : `${planLabel} access is active.`,
    statusLabel:
      plan === "free"
        ? "Free"
        : subscription.status === "active"
        ? planLabel
        : subscription.status === "grace_period"
        ? "Grace period"
        : planLabel,
  };
}

export function getSubscriptionDisplay(subscription: ClinicSubscription | null) {
  if (!subscription) {
    return {
      title: "Free plan active",
      subtitle: "Start clean with core clinic management. Upgrade when the clinic grows beyond the starting setup.",
      tone: "warning" as const,
      daysLeft: null as number | null,
      renewalDate: "Not set",
      priceText: "Free",
    };
  }

  const status = subscription.status;
  const access = getSubscriptionAccess(subscription);
  const plan = getClinicPlanName(subscription);
  const planLabel = getClinicPlanLabel(plan);
  const googlePlayReady = hasGooglePlayAutopay(subscription);
  const daysLeft = daysUntil(subscription.current_period_end);
  const renewalDate = formatPlanDate(subscription.current_period_end);
  const price =
    Number(subscription.monthly_price || 0) > 0 ? Number(subscription.monthly_price) : getClinicPlanPrice(plan);
  const priceText = plan === "free" ? "Free" : `\u20B9${Math.round(price).toLocaleString("en-IN")}/month`;

  if (status === "cancelled" || subscription.google_play_status === "cancelled") {
    return {
      title: "Free plan active",
      subtitle: "Paid access is cancelled. Core clinic management remains available on the Free plan.",
      tone: "warning" as const,
      daysLeft,
      renewalDate,
      priceText: "Free",
    };
  }

  if (status === "expired" || subscription.google_play_status === "expired") {
    return {
      title: "Free plan active",
      subtitle: "Paid access is expired. Core clinic management remains available on the Free plan.",
      tone: "warning" as const,
      daysLeft,
      renewalDate,
      priceText: "Free",
    };
  }

  if (subscription.google_play_status === "account_hold") {
    return {
      title: "Free plan active",
      subtitle: "Google Play payment needs attention. Core clinic work continues while paid features wait for renewal.",
      tone: "warning" as const,
      daysLeft,
      renewalDate,
      priceText: "Free",
    };
  }

  if (plan === "free" || status === "free") {
    return {
      title: "Free plan active",
      subtitle: "Built for new single-owner clinics to start professionally without costly software.",
      tone: "success" as const,
      daysLeft: null,
      renewalDate: "No renewal needed",
      priceText: "Free",
    };
  }

  if (status === "active") {
    return {
      title: googlePlayReady ? `${planLabel} active` : `${planLabel} enabled`,
      subtitle: googlePlayReady
        ? `Auto-renewal is active through Google Play. Current period ends on ${renewalDate}. ${priceText}.`
        : `Paid plan is active. Current period ends on ${renewalDate}. ${priceText}.`,
      tone: "success" as const,
      daysLeft,
      renewalDate,
      priceText,
    };
  }

  return {
    title: access.statusLabel,
    subtitle: access.reason,
    tone: status === "grace_period" ? ("warning" as const) : ("success" as const),
    daysLeft,
    renewalDate,
    priceText,
  };
}
