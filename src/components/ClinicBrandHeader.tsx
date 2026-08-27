import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { SecureStorageImage } from "@/components/SecureStorageImage";
import { colors, radius } from "@/constants/colors";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

type ClinicBrand = {
  id: string;
  name: string;
  logo_url?: string | null;
};

type QuickControl = {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  route: string;
};

const OWNER_QUICK_CONTROLS: QuickControl[] = [
  {
    label: "Payments",
    icon: "wallet-outline",
    route: "/reports/payments",
  },
  {
    label: "Reconcile",
    icon: "shield-checkmark-outline",
    route: "/reports/reconciliation-required",
  },
  {
    label: "Reports",
    icon: "analytics-outline",
    route: "/reports/clinic",
  },
];

export function ClinicBrandHeader({
  subtitle,
  showManage = false,
}: {
  subtitle?: string;
  showManage?: boolean;
}) {
  const { profile } = useAuth();
  const [brand, setBrand] = useState<ClinicBrand | null>(null);

  async function load() {
    try {
      if (!profile?.clinic_id) return;

      const { data, error } = await supabase
        .from("clinics")
        .select("id,name,logo_url")
        .eq("id", profile.clinic_id)
        .maybeSingle();

      if (error) throw error;

      setBrand(data as ClinicBrand | null);
    } catch (error) {
      console.warn("Clinic brand load failed:", error);
    }
  }

  useEffect(() => {
    load();
  }, [profile?.clinic_id]);

  const canManage = profile?.role === "head_doctor" || profile?.role === "owner";

  return (
    <View
      style={{
        borderRadius: radius.lg,
        padding: 16,
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.border,
        gap: 12,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <View
          accessible={false}
          importantForAccessibility="no-hide-descendants"
          style={{
            width: 56,
            height: 56,
            borderRadius: radius.lg,
            backgroundColor: colors.primarySoft,
            overflow: "hidden",
            alignItems: "center",
            justifyContent: "center",
            borderWidth: 1,
            borderColor: colors.border,
          }}
        >
          {brand?.logo_url ? (
            <SecureStorageImage
              uri={brand.logo_url}
              style={{ width: "100%", height: "100%" }}
              contentFit="cover"
            />
          ) : (
            <Ionicons name="medkit-outline" size={28} color={colors.primary} />
          )}
        </View>

        <View style={{ flex: 1 }}>
          <Text
            numberOfLines={1}
            style={{ color: colors.text, fontSize: 22, fontWeight: "800" }}
          >
            {brand?.name || "Dental Clinic"}
          </Text>

          <Text
            numberOfLines={2}
            style={{ color: colors.muted, fontSize: 14, marginTop: 3, lineHeight: 19 }}
          >
            {subtitle || "Clinic workspace"}
          </Text>
        </View>

        {showManage && canManage ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Manage clinic branding"
            onPress={() => router.push("/clinic/branding" as never)}
            style={({ pressed }) => ({
              width: 42,
              height: 42,
              borderRadius: 999,
              backgroundColor: pressed ? colors.surfaceSoft : colors.primarySoft,
              alignItems: "center",
              justifyContent: "center",
            })}
          >
            <Ionicons
              accessible={false}
              importantForAccessibility="no"
              name="brush-outline"
              size={20}
              color={colors.primary}
            />
          </Pressable>
        ) : null}
      </View>

      {showManage && canManage ? (
        <View
          accessibilityRole="toolbar"
          accessibilityLabel="Owner quick controls"
          style={{ flexDirection: "row", gap: 8 }}
        >
          {OWNER_QUICK_CONTROLS.map((item) => (
            <Pressable
              key={item.label}
              accessibilityRole="button"
              accessibilityLabel={`Open ${item.label}`}
              onPress={() => router.push(item.route as never)}
              style={({ pressed }) => ({
                flex: 1,
                minHeight: 48,
                borderRadius: 16,
                borderWidth: 1,
                borderColor: colors.border,
                backgroundColor: pressed ? colors.primarySoft : colors.background,
                alignItems: "center",
                justifyContent: "center",
                gap: 4,
                paddingHorizontal: 6,
              })}
            >
              <Ionicons name={item.icon} size={18} color={colors.primary} />
              <Text
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.8}
                style={{ color: colors.text, fontSize: 11, fontWeight: "900" }}
              >
                {item.label}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}
