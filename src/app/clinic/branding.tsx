import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Alert, Pressable, Text, View } from "react-native";
import { AppButton } from "@/components/AppButton";
import { AppInput } from "@/components/AppInput";
import { Screen } from "@/components/Screen";
import { SectionCard } from "@/components/SectionCard";
import { SecureStorageImage } from "@/components/SecureStorageImage";
import { colors } from "@/constants/colors";
import { ClinicBrand, getClinicBrand, updateClinicBrand } from "@/lib/clinicBranding";
import { useImmediateMutationLock } from "@/lib/useImmediateMutationLock";

export default function ClinicBrandingScreen() {
  const [brand, setBrand] = useState<ClinicBrand | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [logoUri, setLogoUri] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const saveMutation = useImmediateMutationLock();

  async function load() {
    try {
      setLoading(true);
      const data = await getClinicBrand();

      setBrand(data);
      setName(data?.name || "");
      setPhone(data?.phone || "");
      setAddress(data?.address || "");
    } catch (error) {
      Alert.alert(
        "Brand load failed",
        error instanceof Error ? error.message : "Please try again."
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function pickLogo() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 1,
      allowsEditing: true,
      aspect: [1, 1],
    });

    if (result.canceled) return;

    setLogoUri(result.assets[0].uri);
  }

  async function save() {
    if (!saveMutation.tryLock()) return;

    if (!name.trim()) {
      saveMutation.release();
      Alert.alert("Clinic name required", "Enter the hospital/clinic name.");
      return;
    }

    setSaving(true);

    try {
      const updated = await updateClinicBrand({
        name,
        phone,
        address,
        logoUri,
      });

      setBrand(updated);
      setLogoUri(null);

      Alert.alert("Branding saved", "Your clinic name and logo are updated.", [
        {
          text: "Go to Dashboard",
          onPress: () => router.back(),
        },
      ]);
    } catch (error) {
      Alert.alert(
        "Save failed",
        error instanceof Error ? error.message : "Please try again."
      );
    } finally {
      saveMutation.release();
      setSaving(false);
    }
  }

  const logoPreview = logoUri || brand?.logo_url || "";

  return (
    <Screen refreshing={loading} onRefresh={load}>
      <View style={{ gap: 6 }}>
        <Text style={{ color: colors.text, fontSize: 30, fontWeight: "900" }}>
          Clinic Branding
        </Text>
        <Text style={{ color: colors.muted, fontSize: 15, lineHeight: 21 }}>
          Set clinic name, logo, phone, and address so the app feels like the clinic’s own workspace.
        </Text>
      </View>

      <SectionCard title="Preview" subtitle="Check how the clinic identity will appear inside the app.">
        <View
          style={{
            borderRadius: 26,
            padding: 16,
            backgroundColor: colors.background,
            borderWidth: 1,
            borderColor: colors.border,
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
          }}
        >
          <View
            style={{
              width: 68,
              height: 68,
              borderRadius: 22,
              backgroundColor: colors.primarySoft,
              overflow: "hidden",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {logoPreview ? (
              <SecureStorageImage
                uri={logoPreview}
                style={{ width: "100%", height: "100%" }}
                contentFit="cover"
              />
            ) : (
              <Ionicons name="medkit-outline" size={32} color={colors.primary} />
            )}
          </View>

          <View style={{ flex: 1 }}>
            <Text
              numberOfLines={1}
              style={{ color: colors.text, fontSize: 22, fontWeight: "900" }}
            >
              {name || "Your Clinic Name"}
            </Text>
            <Text style={{ color: colors.muted, marginTop: 4 }}>
              CapDent clinic workspace
            </Text>
          </View>
        </View>
      </SectionCard>

      <SectionCard title="Clinic Details" subtitle="Keep clinic name, logo, contact number, and address accurate for staff use.">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={logoPreview ? "Change clinic logo" : "Select clinic logo"}
          onPress={pickLogo}
          style={{
            minHeight: 58,
            borderRadius: 18,
            backgroundColor: colors.primarySoft,
            alignItems: "center",
            justifyContent: "center",
            flexDirection: "row",
            gap: 10,
          }}
        >
          <Ionicons name="image-outline" size={22} color={colors.primary} />
          <Text style={{ color: colors.primary, fontWeight: "900" }}>
            {logoPreview ? "Change Logo" : "Select Logo"}
          </Text>
        </Pressable>

        <AppInput
          label="Clinic / Hospital Name"
          value={name}
          onChangeText={setName}
          placeholder="Example: Raja Dental Care"
        />

        <AppInput
          label="Clinic Phone"
          value={phone}
          onChangeText={setPhone}
          placeholder="Optional"
          keyboardType="phone-pad"
        />

        <AppInput
          label="Clinic Address"
          value={address}
          onChangeText={setAddress}
          placeholder="Optional"
          multiline
        />

        <AppButton
          title={loading ? "Loading..." : "Save Clinic Branding"}
          icon="save-outline"
          onPress={save}
          loading={saving || loading}
        />
      </SectionCard>
    </Screen>
  );
}
