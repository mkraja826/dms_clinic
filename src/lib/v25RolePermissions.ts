import type { Role } from "@/lib/supabase";

export type CapDentV25FutureRole = "dental_assistant";
export type CapDentV25Role = Role | CapDentV25FutureRole;
export type CapDentPermissionClass = "owner" | "doctor" | "reception";

/**
 * V25 application permission mapping.
 *
 * This helper is intentionally independent from the production database role
 * constraint. `dental_assistant` is modeled here only so the Android UI and
 * permission checks have one future-compatible source of truth once the
 * additive backend migration is approved.
 */
export function getCapDentPermissionClass(
  role?: CapDentV25Role | null
): CapDentPermissionClass | null {
  if (role === "owner" || role === "head_doctor") return "owner";
  if (role === "doctor" || role === "working_doctor") return "doctor";
  if (role === "receptionist" || role === "dental_assistant") return "reception";
  return null;
}

export function hasReceptionPermissions(role?: CapDentV25Role | null) {
  return getCapDentPermissionClass(role) === "reception";
}

export function hasDoctorPermissions(role?: CapDentV25Role | null) {
  return getCapDentPermissionClass(role) === "doctor";
}

export function hasOwnerPermissions(role?: CapDentV25Role | null) {
  return getCapDentPermissionClass(role) === "owner";
}
