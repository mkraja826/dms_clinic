import { Profile, Role, supabase } from "@/lib/supabase";

export type StaffEditableRole = "working_doctor" | "receptionist";

export function isOwnerRole(role?: Role | null) {
  return role === "owner" || role === "head_doctor";
}

export function isEditableStaffRole(role?: Role | null): role is StaffEditableRole {
  return role === "working_doctor" || role === "receptionist" || role === "doctor";
}

export function normalizeEditableRole(role?: Role | null): StaffEditableRole {
  if (role === "receptionist") return "receptionist";
  return "working_doctor";
}

function isProfile(value: unknown): value is Profile {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const profile = value as Record<string, unknown>;
  const validRole =
    profile.role === "working_doctor" ||
    profile.role === "doctor" ||
    profile.role === "receptionist";

  return (
    typeof profile.id === "string" &&
    profile.id.length > 0 &&
    typeof profile.clinic_id === "string" &&
    profile.clinic_id.length > 0 &&
    typeof profile.name === "string" &&
    (profile.email === null || typeof profile.email === "string") &&
    validRole &&
    typeof profile.active === "boolean" &&
    typeof profile.created_at === "string"
  );
}

export async function updateStaffAccess(input: {
  staffId: string;
  role?: StaffEditableRole | null;
  active?: boolean | null;
}) {
  const { data, error } = await supabase.rpc("owner_update_staff_access", {
    p_staff_id: input.staffId,
    p_staff_role: input.role ?? null,
    p_staff_active: typeof input.active === "boolean" ? input.active : null,
  });

  if (error) throw error;
  if (
    !isProfile(data) ||
    data.id !== input.staffId ||
    (input.role != null && data.role !== input.role) ||
    (typeof input.active === "boolean" && data.active !== input.active)
  ) {
    throw new Error("Staff access update returned an invalid profile.");
  }

  return data;
}

export async function updateStaffRole(staffId: string, role: StaffEditableRole) {
  return updateStaffAccess({ staffId, role, active: null });
}

export async function setStaffActive(staffId: string, active: boolean) {
  return updateStaffAccess({ staffId, role: null, active });
}
