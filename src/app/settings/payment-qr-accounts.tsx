import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { useEffect, useMemo, useState } from "react";
import { Alert, Image, Pressable, Text, TextInput, View } from "react-native";
import { AppButton } from "@/components/AppButton";
import { Screen } from "@/components/Screen";
import { SectionCard } from "@/components/SectionCard";
import { StatusBadge } from "@/components/StatusBadge";
import { colors } from "@/constants/colors";
import { useAuth } from "@/lib/auth";
import {
  createManualPaymentQrAccount,
  deleteManualPaymentQrAccount,
  listManualPaymentQrAccounts,
  setDefaultManualPaymentQrAccount,
  updateManualPaymentQrAccount,
  uploadManualPaymentQrImage,
  type ManualPaymentQrAccount,
} from "@/lib/manualPaymentQr";

export default function PaymentQrAccountsScreen() {
  const { profile } = useAuth();
  const canManage = profile?.role === "owner" || profile?.role === "head_doctor";
  const [accounts, setAccounts] = useState<ManualPaymentQrAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [label, setLabel] = useState("Primary QR");
  const [accountName, setAccountName] = useState("");
  const [upiId, setUpiId] = useState("");
  const [picked, setPicked] = useState<ImagePicker.ImagePickerAsset | null>(null);

  async function load() {
    try {
      setLoading(true);
      setAccounts(await listManualPaymentQrAccounts());
    } catch (error) {
      Alert.alert("Could not load payment QRs", error instanceof Error ? error.message : "Please try again.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (canManage) void load();
  }, [canManage, profile?.clinic_id]);

  const defaultAccount = useMemo(
    () => accounts.find((account) => account.isDefault && account.isActive) || null,
    [accounts]
  );

  async function pickQr() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("Photos permission required", "Allow photo access to choose the clinic payment QR image.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.9,
    });
    if (!result.canceled && result.assets[0]) setPicked(result.assets[0]);
  }

  async function addQr() {
    if (!canManage || busy) return;
    if (!label.trim()) {
      Alert.alert("Label required", "Give this QR a name such as Front Desk or Main Account.");
      return;
    }
    if (!picked) {
      Alert.alert("QR image required", "Choose the clinic's payment QR image first.");
      return;
    }

    let uploadedPath: string | null = null;
    try {
      setBusy(true);
      uploadedPath = await uploadManualPaymentQrImage({
        uri: picked.uri,
        mimeType: picked.mimeType,
        fileName: picked.fileName,
      });
      await createManualPaymentQrAccount({
        label,
        accountName,
        upiId,
        qrStoragePath: uploadedPath,
      });
      setLabel("Primary QR");
      setAccountName("");
      setUpiId("");
      setPicked(null);
      await load();
      Alert.alert("Payment QR added", "Reception can now show this QR to patients. Payment confirmation remains manual in V28.");
    } catch (error) {
      Alert.alert("Could not add payment QR", error instanceof Error ? error.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function makeDefault(account: ManualPaymentQrAccount) {
    if (busy || account.isDefault) return;
    try {
      setBusy(true);
      await setDefaultManualPaymentQrAccount(account.id);
      await load();
    } catch (error) {
      Alert.alert("Could not set default QR", error instanceof Error ? error.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(account: ManualPaymentQrAccount) {
    try {
      setBusy(true);
      await updateManualPaymentQrAccount(account.id, { isActive: !account.isActive });
      await load();
    } catch (error) {
      Alert.alert("Could not update QR", error instanceof Error ? error.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }

  function confirmDelete(account: ManualPaymentQrAccount) {
    Alert.alert(
      "Delete payment QR?",
      `${account.label} will be removed from this clinic. Existing recorded payments are not affected.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => void removeAccount(account),
        },
      ]
    );
  }

  async function removeAccount(account: ManualPaymentQrAccount) {
    try {
      setBusy(true);
      await deleteManualPaymentQrAccount(account);
      await load();
    } catch (error) {
      Alert.alert("Could not delete QR", error instanceof Error ? error.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!canManage) {
    return (
      <Screen>
        <Header />
        <SectionCard title="Owner access required">
          <Text style={{ color: colors.muted, lineHeight: 20 }}>
            Only the clinic owner or head doctor can add, change, disable, or remove clinic payment QR codes.
          </Text>
        </SectionCard>
      </Screen>
    );
  }

  return (
    <Screen refreshing={loading} onRefresh={() => void load()}>
      <Header />

      <View style={{ padding: 14, borderRadius: 20, backgroundColor: defaultAccount ? colors.successSoft : colors.warningSoft, borderWidth: 1, borderColor: defaultAccount ? colors.success : colors.warning, flexDirection: "row", gap: 12, alignItems: "center" }}>
        <Ionicons name={defaultAccount ? "qr-code-outline" : "alert-circle-outline"} size={28} color={defaultAccount ? colors.success : colors.warning} />
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.text, fontWeight: "900", fontSize: 16 }}>
            {defaultAccount ? `${defaultAccount.label} is the default` : "Add the clinic's first payment QR"}
          </Text>
          <Text style={{ color: colors.muted, marginTop: 3, lineHeight: 19 }}>
            {defaultAccount
              ? "Reception can select this or another active QR when collecting a patient payment."
              : "The first active QR becomes the default automatically."}
          </Text>
        </View>
      </View>

      <SectionCard title="Add payment QR" subtitle="Use an existing PhonePe, Google Pay, Paytm, bank UPI, or other clinic-owned receiving QR.">
        <View style={{ gap: 8 }}>
          <Text style={{ color: colors.text, fontWeight: "800" }}>QR label</Text>
          <TextInput value={label} onChangeText={setLabel} maxLength={80} placeholder="Front Desk / Main Account / Branch 2" placeholderTextColor={colors.muted} style={inputStyle} />
        </View>
        <View style={{ gap: 8 }}>
          <Text style={{ color: colors.text, fontWeight: "800" }}>Account name (optional)</Text>
          <TextInput value={accountName} onChangeText={setAccountName} maxLength={120} placeholder="Clinic or account holder name" placeholderTextColor={colors.muted} style={inputStyle} />
        </View>
        <View style={{ gap: 8 }}>
          <Text style={{ color: colors.text, fontWeight: "800" }}>UPI ID (optional)</Text>
          <TextInput value={upiId} onChangeText={setUpiId} autoCapitalize="none" autoCorrect={false} maxLength={160} placeholder="clinic@bank" placeholderTextColor={colors.muted} style={inputStyle} />
        </View>

        <Pressable onPress={() => void pickQr()} style={({ pressed }) => ({ minHeight: 170, borderRadius: 20, borderWidth: 1, borderStyle: "dashed", borderColor: picked ? colors.success : colors.border, backgroundColor: pressed ? colors.surfaceSoft : colors.background, alignItems: "center", justifyContent: "center", overflow: "hidden", gap: 8 })}>
          {picked ? (
            <Image source={{ uri: picked.uri }} style={{ width: "100%", height: 220, resizeMode: "contain" }} />
          ) : (
            <>
              <Ionicons name="image-outline" size={34} color={colors.primary} />
              <Text style={{ color: colors.text, fontWeight: "900" }}>Choose QR image</Text>
              <Text style={{ color: colors.muted, textAlign: "center", fontSize: 12 }}>PNG, JPEG or WebP • stored privately per clinic</Text>
            </>
          )}
        </Pressable>

        <AppButton title="Add Clinic QR" icon="add-circle-outline" onPress={() => void addQr()} loading={busy} loadingTitle="Adding QR…" disabled={!label.trim() || !picked || busy} />
      </SectionCard>

      <View style={{ gap: 8 }}>
        <Text style={{ color: colors.text, fontSize: 18, fontWeight: "900" }}>Clinic QRs</Text>
        <Text style={{ color: colors.muted, lineHeight: 19 }}>
          {accounts.length ? `${accounts.length} configured QR${accounts.length === 1 ? "" : "s"}` : "No payment QRs configured yet."}
        </Text>
      </View>

      <View style={{ gap: 12 }}>
        {accounts.map((account) => (
          <View key={account.id} style={{ borderWidth: account.isDefault && account.isActive ? 2 : 1, borderColor: account.isDefault && account.isActive ? colors.success : colors.border, borderRadius: 20, padding: 14, backgroundColor: account.isActive ? colors.surface : colors.surfaceSoft, gap: 12 }}>
            <View style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
              {account.signedUrl ? <Image source={{ uri: account.signedUrl }} style={{ width: 78, height: 78, borderRadius: 12, resizeMode: "contain", backgroundColor: "#fff" }} /> : <View style={{ width: 78, height: 78, borderRadius: 12, backgroundColor: colors.surfaceSoft, alignItems: "center", justifyContent: "center" }}><Ionicons name="qr-code-outline" size={32} color={colors.muted} /></View>}
              <View style={{ flex: 1, gap: 3 }}>
                <Text style={{ color: colors.text, fontSize: 16, fontWeight: "900" }}>{account.label}</Text>
                {account.accountName ? <Text style={{ color: colors.muted }}>{account.accountName}</Text> : null}
                {account.upiId ? <Text style={{ color: colors.muted, fontSize: 12 }}>{account.upiId}</Text> : null}
              </View>
              <StatusBadge label={!account.isActive ? "Disabled" : account.isDefault ? "Default" : "Active"} tone={!account.isActive ? "primary" : account.isDefault ? "success" : "primary"} />
            </View>

            {account.isActive && !account.isDefault ? (
              <AppButton title="Set as Default" icon="checkmark-circle-outline" onPress={() => void makeDefault(account)} disabled={busy} />
            ) : null}
            <AppButton title={account.isActive ? "Disable QR" : "Enable QR"} icon={account.isActive ? "pause-circle-outline" : "play-circle-outline"} variant="secondary" onPress={() => void toggleActive(account)} disabled={busy} />
            <AppButton title="Delete QR" icon="trash-outline" variant="danger" onPress={() => confirmDelete(account)} disabled={busy} />
          </View>
        ))}
      </View>

      <View style={{ padding: 12, borderRadius: 16, backgroundColor: colors.warningSoft }}>
        <Text style={{ color: colors.text, fontSize: 12, lineHeight: 18, textAlign: "center", fontWeight: "700" }}>
          V28 does not verify QR payments automatically. Reception must check the clinic's payment app or bank receipt before recording payment in CapDent.
        </Text>
      </View>
    </Screen>
  );
}

const inputStyle = {
  minHeight: 52,
  borderWidth: 1,
  borderColor: colors.border,
  borderRadius: 16,
  paddingHorizontal: 14,
  color: colors.text,
  backgroundColor: colors.background,
} as const;

function Header() {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
      <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} hitSlop={8} style={{ width: 42, height: 42, borderRadius: 16, backgroundColor: colors.surfaceSoft, alignItems: "center", justifyContent: "center" }}>
        <Ionicons name="arrow-back-outline" size={22} color={colors.primary} />
      </Pressable>
      <View style={{ flex: 1 }}>
        <Text style={{ color: colors.text, fontSize: 27, fontWeight: "900" }}>Payment QR Accounts</Text>
        <Text style={{ color: colors.muted, marginTop: 2, lineHeight: 20 }}>Manage the clinic's manual UPI QR receiving options.</Text>
      </View>
    </View>
  );
}
