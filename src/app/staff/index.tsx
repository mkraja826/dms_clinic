import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Alert, Pressable, Text, View } from "react-native";
import { ActionCard } from "@/components/ActionCard";
import { AppButton } from "@/components/AppButton";
import { EmptyState } from "@/components/EmptyState";
import { Screen } from "@/components/Screen";
import { SectionCard } from "@/components/SectionCard";
import { StatusBadge } from "@/components/StatusBadge";
import { colors } from "@/constants/colors";
import {
  getRoleLabel,
  getStaff,
  getStaffInvites,
  Profile,
  StaffInvite,
} from "@/lib/supabase";
import {
  isOwnerRole,
  normalizeEditableRole,
  setStaffActive,
  StaffEditableRole,
  updateStaffRole,
} from "@/lib/staffControl";
import { useImmediateMutationLock } from "@/lib/useImmediateMutationLock";

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;

  if (typeof error === "object" && error) {
    const err = error as { message?: string; details?: string; hint?: string; code?: string };
    return [
      err.message,
      err.details ? `Details: ${err.details}` : "",
      err.hint ? `Hint: ${err.hint}` : "",
      err.code ? `Code: ${err.code}` : "",
    ]
      .filter(Boolean)
      .join("\n") || "Unknown error";
  }

  return "Unknown error";
}

function roleHelp(role: StaffEditableRole) {
  if (role === "working_doctor") return "Can manage treatment workflow and clinical uploads.";
  return "Can register patients, check-in, appointments, and collect payments.";
}

function MiniRoleButton({
  title,
  accessibilityLabel,
  selected,
  disabled,
  onPress,
}: {
  title: string;
  accessibilityLabel: string;
  selected: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: Boolean(disabled || selected), selected }}
      disabled={disabled || selected}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 40,
        borderRadius: 999,
        paddingHorizontal: 12,
        alignItems: "center",
        justifyContent: "center",
        borderWidth: 1,
        borderColor: selected ? colors.primary : colors.border,
        backgroundColor: selected ? colors.primary : pressed ? colors.surfaceSoft : colors.background,
        opacity: disabled ? 0.5 : 1,
      })}
    >
      <Text style={{ color: selected ? colors.white : colors.text, fontWeight: "900", fontSize: 12 }}>
        {title}
      </Text>
    </Pressable>
  );
}

export default function StaffManagementScreen() {
  const [staff, setStaff] = useState<Profile[]>([]);
  const [invites, setInvites] = useState<StaffInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [staffError, setStaffError] = useState("");
  const [inviteError, setInviteError] = useState("");
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const staffMutation = useImmediateMutationLock();

  async function load() {
    setLoading(true);
    setStaffError("");
    setInviteError("");

    try {
      const staffRows = await getStaff();
      setStaff(staffRows);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to load staff.";
      setStaffError(message);
      console.warn("getStaff failed:", error);
    }

    try {
      const inviteRows = await getStaffInvites();
      setInvites(inviteRows);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to load invites.";
      setInviteError(message);
      console.warn("getStaffInvites failed:", error);
    }

    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  const pendingInvites = invites.filter((invite) => !invite.accepted_at);
  const owners = useMemo(() => staff.filter((member) => isOwnerRole(member.role)), [staff]);
  const managedStaff = useMemo(() => staff.filter((member) => !isOwnerRole(member.role)), [staff]);
  const activeCount = managedStaff.filter((member) => member.active).length;
  const inactiveCount = managedStaff.filter((member) => !member.active).length;

  async function changeRole(member: Profile, role: StaffEditableRole) {
    if (isOwnerRole(member.role)) {
      Alert.alert("Owner protected", "Owner/head doctor access cannot be changed from staff controls.");
      return;
    }

    const currentRole = normalizeEditableRole(member.role);
    if (currentRole === role || !staffMutation.tryLock()) return;

    try {
      setUpdatingId(`${member.id}:role`);
      await updateStaffRole(member.id, role);
      await load();
    } catch (error) {
      Alert.alert("Role update failed", getErrorMessage(error));
    } finally {
      staffMutation.release();
      setUpdatingId(null);
    }
  }

  async function changeActive(member: Profile, active: boolean) {
    if (isOwnerRole(member.role)) {
      Alert.alert("Owner protected", "Owner/head doctor access cannot be removed from staff controls.");
      return;
    }

    if (!staffMutation.tryLock()) return;

    try {
      setUpdatingId(`${member.id}:active`);
      await setStaffActive(member.id, active);
      await load();
    } catch (error) {
      Alert.alert("Access update failed", getErrorMessage(error));
    } finally {
      staffMutation.release();
      setUpdatingId(null);
    }
  }

  function confirmAccessChange(member: Profile, active: boolean) {
    const title = active ? "Restore staff access?" : "Remove staff access?";
    const message = active
      ? `${member.name} will be able to use this clinic account again.`
      : `${member.name} will lose access to this clinic workspace. Patient and visit history stays safe.`;

    Alert.alert(title, message, [
      { text: "Cancel", style: "cancel" },
      {
        text: active ? "Restore" : "Remove Access",
        style: active ? "default" : "destructive",
        onPress: () => {
          void changeActive(member, active);
        },
      },
    ]);
  }

  return (
    <Screen refreshing={loading} onRefresh={load}>
      <View style={{ gap: 6 }}>
        <Text style={{ color: colors.text, fontSize: 30, fontWeight: "900" }}>
          Staff
        </Text>
        <Text style={{ color: colors.muted, fontSize: 15, lineHeight: 21 }}>
          Owner controls for staff invites, role clarity, and active/inactive clinic access.
        </Text>
      </View>

      <View style={{ flexDirection: "row", gap: 10 }}>
        <View style={{ flex: 1, borderRadius: 20, padding: 14, backgroundColor: colors.successSoft, gap: 5 }}>
          <Text style={{ color: colors.success, fontSize: 24, fontWeight: "900" }}>{activeCount}</Text>
          <Text style={{ color: colors.muted, fontWeight: "900", fontSize: 12 }}>Active Staff</Text>
        </View>
        <View style={{ flex: 1, borderRadius: 20, padding: 14, backgroundColor: colors.dangerSoft, gap: 5 }}>
          <Text style={{ color: colors.danger, fontSize: 24, fontWeight: "900" }}>{inactiveCount}</Text>
          <Text style={{ color: colors.muted, fontWeight: "900", fontSize: 12 }}>Inactive Staff</Text>
        </View>
      </View>

      <SectionCard title="Quick Action" subtitle="Invite working doctors or receptionists with the correct role.">
        <ActionCard
          title="Invite Staff"
          subtitle="Create invite code for doctor or reception"
          icon="person-add-outline"
          onPress={() => router.push("/staff/add" as never)}
        />
      </SectionCard>

      {staffError || inviteError ? (
        <SectionCard title="Setup Warning" subtitle="Staff access needs attention before owner can fully manage team.">
          <Text style={{ color: colors.warning, fontWeight: "900" }}>
            Staff page opened, but one database query failed.
          </Text>

          {staffError ? (
            <Text selectable style={{ color: colors.muted, lineHeight: 20 }}>
              Staff query: {staffError}
            </Text>
          ) : null}

          {inviteError ? (
            <Text selectable style={{ color: colors.muted, lineHeight: 20 }}>
              Invite query: {inviteError}
            </Text>
          ) : null}

          <Text style={{ color: colors.muted, lineHeight: 20 }}>
            Run the staff access SQL migration, then press Refresh.
          </Text>
        </SectionCard>
      ) : null}

      <SectionCard title="Clinic Owner" subtitle="Owner access is protected and cannot be removed from this screen.">
        {owners.length ? (
          <View style={{ gap: 10 }}>
            {owners.map((member) => (
              <View
                key={member.id}
                style={{
                  padding: 12,
                  borderRadius: 20,
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
                    width: 44,
                    height: 44,
                    borderRadius: 16,
                    backgroundColor: colors.primarySoft,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Ionicons name="shield-checkmark-outline" size={22} color={colors.primary} />
                </View>

                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.text, fontWeight: "900" }}>{member.name}</Text>
                  <Text style={{ color: colors.muted, marginTop: 2 }}>{member.email || "No email"}</Text>
                </View>

                <StatusBadge label={getRoleLabel(member.role)} tone="primary" />
              </View>
            ))}
          </View>
        ) : (
          <EmptyState title="Owner not shown" message="Refresh after login profile loads." icon="shield-outline" />
        )}
      </SectionCard>

      <SectionCard title="Staff Access" subtitle="Change role or remove access without deleting clinic records.">
        {loading ? (
          <Text style={{ color: colors.muted }}>Loading staff...</Text>
        ) : managedStaff.length ? (
          <View style={{ gap: 12 }}>
            {managedStaff.map((member) => {
              const editableRole = normalizeEditableRole(member.role);
              const updatingRole = updatingId === `${member.id}:role`;
              const updatingActive = updatingId === `${member.id}:active`;

              return (
                <View
                  key={member.id}
                  style={{
                    padding: 14,
                    borderRadius: 22,
                    backgroundColor: member.active ? colors.background : colors.dangerSoft,
                    borderWidth: 1,
                    borderColor: member.active ? colors.border : "#FECACA",
                    gap: 12,
                  }}
                >
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                    <View
                      style={{
                        width: 48,
                        height: 48,
                        borderRadius: 18,
                        backgroundColor: member.active ? colors.primarySoft : colors.dangerSoft,
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Ionicons
                        name={member.active ? "person-outline" : "person-remove-outline"}
                        size={22}
                        color={member.active ? colors.primary : colors.danger}
                      />
                    </View>

                    <View style={{ flex: 1 }}>
                      <Text style={{ color: colors.text, fontWeight: "900", fontSize: 16 }}>
                        {member.name}
                      </Text>
                      <Text style={{ color: colors.muted, marginTop: 2 }}>{member.email || "No email"}</Text>
                    </View>

                    <View style={{ alignItems: "flex-end", gap: 6 }}>
                      <StatusBadge label={getRoleLabel(member.role)} tone={member.active ? "success" : "danger"} />
                      <StatusBadge label={member.active ? "active" : "inactive"} tone={member.active ? "success" : "danger"} />
                    </View>
                  </View>

                  <Text style={{ color: colors.muted, lineHeight: 19 }}>
                    {roleHelp(editableRole)}
                  </Text>

                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                    <MiniRoleButton
                      title={updatingRole ? "Updating..." : "Doctor"}
                      accessibilityLabel={`Set ${member.name}'s role to doctor`}
                      selected={editableRole === "working_doctor"}
                      disabled={!!updatingId || !member.active}
                      onPress={() => {
                        void changeRole(member, "working_doctor");
                      }}
                    />
                    <MiniRoleButton
                      title={updatingRole ? "Updating..." : "Reception"}
                      accessibilityLabel={`Set ${member.name}'s role to reception`}
                      selected={editableRole === "receptionist"}
                      disabled={!!updatingId || !member.active}
                      onPress={() => {
                        void changeRole(member, "receptionist");
                      }}
                    />
                  </View>

                  <AppButton
                    title={member.active ? "Remove Access" : "Restore Access"}
                    icon={member.active ? "person-remove-outline" : "person-add-outline"}
                    variant={member.active ? "danger" : "secondary"}
                    loading={updatingActive}
                    disabled={!!updatingId && !updatingActive}
                    onPress={() => confirmAccessChange(member, !member.active)}
                  />
                </View>
              );
            })}
          </View>
        ) : (
          <EmptyState
            title="No staff yet"
            message="Invite working doctors and reception staff to this clinic workspace."
            icon="people-outline"
          />
        )}
      </SectionCard>

      <SectionCard title="Pending Invites" subtitle="Share invite code only with trusted clinic staff.">
        {loading ? (
          <Text style={{ color: colors.muted }}>Loading invites...</Text>
        ) : pendingInvites.length ? (
          <View style={{ gap: 10 }}>
            {pendingInvites.map((invite) => (
              <View
                key={invite.id}
                style={{
                  padding: 14,
                  borderRadius: 18,
                  backgroundColor: colors.background,
                  borderWidth: 1,
                  borderColor: colors.border,
                  gap: 6,
                }}
              >
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                  <Text style={{ color: colors.text, fontWeight: "900", flex: 1 }}>{invite.name}</Text>
                  <StatusBadge label={getRoleLabel(invite.role)} tone="warning" />
                </View>
                <Text style={{ color: colors.muted }}>{invite.email || "No email"}</Text>
                <Text selectable style={{ color: colors.primary, fontWeight: "900" }}>
                  Invite Code: {invite.invite_code}
                </Text>
              </View>
            ))}
          </View>
        ) : (
          <EmptyState
            title="No pending invites"
            message="New staff invite codes will appear here."
            icon="mail-open-outline"
          />
        )}
      </SectionCard>

      <AppButton title="Refresh" icon="refresh-outline" variant="secondary" onPress={load} loading={loading} />
    </Screen>
  );
}
