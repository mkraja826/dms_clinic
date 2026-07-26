function isEnabled(value: string | undefined) {
  return String(value ?? "false").trim().toLowerCase() === "true";
}

/**
 * Build-time kill switches for staged CapDent v21 modules.
 *
 * Clinic-level flags are an additional requirement. Neither module may be
 * activated for a clinic while its global switch is disabled.
 */
export const PAYMENT_PUSH_GLOBALLY_ENABLED = isEnabled(
  process.env.EXPO_PUBLIC_ENABLE_PAYMENT_PUSH
);

export const TOOTH_CHART_GLOBALLY_ENABLED = isEnabled(
  process.env.EXPO_PUBLIC_ENABLE_TOOTH_CHART
);

export function isPaymentPushEnabledForClinic(clinicEnabled: boolean) {
  return PAYMENT_PUSH_GLOBALLY_ENABLED && clinicEnabled;
}

export function isToothChartEnabledForClinic(clinicEnabled: boolean) {
  return TOOTH_CHART_GLOBALLY_ENABLED && clinicEnabled;
}
