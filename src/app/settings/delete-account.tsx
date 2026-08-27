import { router } from "expo-router";
import { useMemo, useState } from "react";
import { Alert, ScrollView, Text, TextInput, View } from "react-native";
import { AppButton } from "@/components/AppButton";
import { SectionCard } from "@/components/SectionCard";
import { colors } from "@/constants/colors";
import { deleteCurrentCapDentAccount } from "@/lib/accountDeletion";
import { useAuth } from "@/lib/auth";
import { useImmediateMutationLock } from "@/lib/useImmediateMutationLock";

function normalizedRole(value?: string | null) {
  return String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
}

export default function DeleteAccountScreen() {
  const { profile, signOut } = useAuth();
  const [confirmation, setConfirmation] = useState("");
  const [deleting, setDeleting] = useState(false);
  const deletionLock = useImmediateMutationLock();
  const isClinicAuthority = useMemo(() => {
    const role = normalizedRole(profile?.role);
    return role === "owner" || role === "head_doctor";
  }, [profile?.role]);
  const requiredConfirmation = isClinicAuthority ? "DELETE CLINIC" : "DELETE ACCOUNT";
  const confirmed = confirmation.trim().toUpperCase() === requiredConfirmation;

  async function deleteAccount() {
    if (!confirmed || deleting || !deletionLock.tryLock()) return;

    const title = isClinicAuthority ? "Permanently delete clinic?" : "Permanently delete account?";
    const message = isClinicAuthority
      ? "This permanently deletes your CapDent login and the clinic workspace, including patients, appointments, treatments, prescriptions, clinical files, billing, payments, reports, staff access, and clinic settings. This cannot be undone."
      : "This permanently deletes your CapDent login/profile and removes your clinic access. The clinic's patients, clinical records, billing, payments, reports, and other clinic-owned data remain intact.";

    Alert.alert(title, message, [
      { text: "Cancel", style: "cancel", onPress: () => deletionLock.release() },
      {
        text: isClinicAuthority ? "Delete Clinic & Account" : "Delete My Account",
        style: "destructive",
        onPress: async () => {
          try {
            setDeleting(true);
            await deleteCurrentCapDentAccount(requiredConfirmation);
            await signOut();
          } catch (error) {
            Alert.alert(
              "Deletion failed",
              error instanceof Error ? error.message : "Your account was not deleted. Please try again."
            );
          } finally {
            setDeleting(false);
            deletionLock.release();
          }
        },
      },
    ]);
  }

  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 16, gap: 16 }}>
      <SectionCard
        title={isClinicAuthority ? "Delete Clinic & Account" : "Delete Account"}
        subtitle={isClinicAuthority ? "Owner and head-doctor deletion removes the clinic workspace." : "Staff deletion removes only your own CapDent account and clinic access."}
      >
        <View style={{ gap: 12 }}>
          <Text style={{ color: colors.text, fontWeight: "900", fontSize: 16 }}>
            {isClinicAuthority ? "Permanent clinic deletion" : "Your clinic data stays safe"}
          </Text>
          <Text style={{ color: colors.muted, lineHeight: 21 }}>
            {isClinicAuthority
              ? "CapDent treats Owner and Head Doctor as the clinic authority. Deleting this account also deletes the clinic workspace and its associated patients, appointments, treatments, dental charts, prescriptions, X-rays/photos, invoices, payments, reports, merchant-account configuration, staff access, and other clinic-owned data."
              : "Deleting a Doctor, Receptionist, or other staff account removes that user's login/profile and clinic access only. Patient records, appointments, treatments, clinical files, invoices, payments, reports, and other clinic-owned data are not deleted."}
          </Text>

          {isClinicAuthority ? (
            <Text style={{ color: colors.danger, fontWeight: "800", lineHeight: 21 }}>
              This cannot be undone. Export or retain any records your clinic is required to keep before continuing.
            </Text>
          ) : null}

          <Text style={{ color: colors.text, fontWeight: "900" }}>
            Type {requiredConfirmation} to continue
          </Text>
          <TextInput
            value={confirmation}
            onChangeText={setConfirmation}
            autoCapitalize="characters"
            autoCorrect={false}
            editable={!deleting}
            placeholder={requiredConfirmation}
            accessibilityLabel={`Type ${requiredConfirmation} to confirm deletion`}
            style={{
              minHeight: 50,
              borderWidth: 1,
              borderColor: colors.border,
              borderRadius: 14,
              paddingHorizontal: 14,
              color: colors.text,
              backgroundColor: colors.surface,
              fontWeight: "800",
            }}
          />
        </View>
      </SectionCard>

      <AppButton
        title={isClinicAuthority ? "Delete Clinic & Account" : "Delete My Account"}
        variant="danger"
        icon="trash-outline"
        onPress={deleteAccount}
        disabled={!confirmed || deleting}
        loading={deleting}
        loadingTitle="Deleting..."
      />
      <AppButton title="Cancel" variant="secondary" icon="arrow-back-outline" onPress={() => router.back()} disabled={deleting} />
    </ScrollView>
  );
}
