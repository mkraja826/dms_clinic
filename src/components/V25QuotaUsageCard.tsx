import { useCallback, useEffect, useState } from "react";
import { Text, View } from "react-native";
import { AppButton } from "@/components/AppButton";
import { SectionCard } from "@/components/SectionCard";
import { StatusBadge } from "@/components/StatusBadge";
import { colors } from "@/constants/colors";
import {
  CapDentEntitlementsV25,
  getCapDentEntitlementsV25,
} from "@/lib/pricingV25";
import { formatStorageBytes } from "@/lib/v25Limits";

type UsageMetricProps = {
  label: string;
  used: number;
  limit: number | null;
  unit?: string;
  format?: (value: number) => string;
  enforced: boolean;
};

function usageRatio(used: number, limit: number | null) {
  if (!limit || limit <= 0) return 0;
  return Math.max(0, Math.min(1, used / limit));
}

function UsageMetric({
  label,
  used,
  limit,
  unit = "",
  format = (value) => `${Math.round(value)}${unit}`,
  enforced,
}: UsageMetricProps) {
  const ratio = usageRatio(used, limit);
  const percent = Math.round(ratio * 100);
  const remaining = limit === null ? null : Math.max(0, limit - used);

  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.text, fontWeight: "900", fontSize: 15 }}>
            {label}
          </Text>
          <Text style={{ color: colors.muted, marginTop: 2 }}>
            {limit === null
              ? `${format(used)} used • unlimited`
              : `${format(used)} of ${format(limit)} used`}
          </Text>
        </View>
        <StatusBadge
          label={enforced ? "Enforced" : "Not enforced"}
          tone={enforced ? "warning" : "success"}
        />
      </View>

      {limit !== null ? (
        <>
          <View
            style={{
              height: 10,
              borderRadius: 999,
              backgroundColor: colors.surfaceSoft,
              overflow: "hidden",
              borderWidth: 1,
              borderColor: colors.border,
            }}
          >
            <View
              style={{
                width: `${Math.max(2, percent)}%`,
                maxWidth: "100%",
                height: "100%",
                borderRadius: 999,
                backgroundColor:
                  percent >= 100
                    ? colors.warning
                    : percent >= 80
                      ? colors.primary
                      : colors.success,
              }}
            />
          </View>
          <Text style={{ color: colors.muted, fontSize: 12, fontWeight: "700" }}>
            {remaining === 0 ? "Limit reached" : `${format(remaining)} remaining`} • {percent}% used
          </Text>
        </>
      ) : null}
    </View>
  );
}

export function V25QuotaUsageCard({
  onViewPlans,
}: {
  onViewPlans: () => void;
}) {
  const [entitlements, setEntitlements] = useState<CapDentEntitlementsV25 | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setEntitlements(await getCapDentEntitlementsV25());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const planLabel = entitlements?.planLabel || "Free";
  const grandfathered = entitlements?.grandfathered !== false;

  return (
    <SectionCard
      title="V25 Plan Usage"
      subtitle="Server-reported clinic usage. Quota enforcement remains controlled centrally and may be disabled during rollout."
    >
      {loading && !entitlements ? (
        <Text style={{ color: colors.muted }}>Loading clinic usage…</Text>
      ) : entitlements ? (
        <View style={{ gap: 18 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.text, fontSize: 19, fontWeight: "900" }}>
                {planLabel} plan
              </Text>
              <Text style={{ color: colors.muted, marginTop: 3, lineHeight: 19 }}>
                {grandfathered
                  ? "Existing clinic protection is active. Limits are visible but not enforced until rollout eligibility changes."
                  : "This clinic follows the current V25 quota policy."}
              </Text>
            </View>
            <StatusBadge
              label={grandfathered ? "Grandfathered" : "V25 policy"}
              tone={grandfathered ? "success" : "primary"}
            />
          </View>

          <UsageMetric
            label="Patients"
            used={entitlements.patientCount}
            limit={entitlements.patientLimit}
            enforced={entitlements.patientLimitEnforced}
          />

          <UsageMetric
            label="Clinical uploads"
            used={entitlements.uploadCount}
            limit={entitlements.uploadLimit}
            enforced={entitlements.uploadLimitEnforced}
          />

          <UsageMetric
            label="Storage"
            used={entitlements.storageUsedBytes}
            limit={entitlements.storageLimitBytes}
            format={formatStorageBytes}
            enforced={entitlements.storageLimitEnforced}
          />

          <AppButton
            title="View Plans"
            icon="card-outline"
            variant="secondary"
            onPress={onViewPlans}
          />
        </View>
      ) : (
        <View style={{ gap: 10 }}>
          <Text style={{ color: colors.muted, lineHeight: 20 }}>
            Usage could not be loaded. Clinic workflows remain available and the server remains the final quota authority.
          </Text>
          <AppButton title="Retry Usage" icon="refresh-outline" variant="secondary" onPress={load} />
        </View>
      )}
    </SectionCard>
  );
}
