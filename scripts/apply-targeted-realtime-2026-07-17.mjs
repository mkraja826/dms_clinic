import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

function update(path, fn) {
  if (!existsSync(path)) throw new Error(`Missing file: ${path}`);
  const original = readFileSync(path, 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const next = fn(original);
  if (next === original) return console.log(`${path}: no changes needed`);
  writeFileSync(path, next.endsWith('\n') ? next : `${next}\n`, 'utf8');
  console.log(`${path}: updated`);
}

function once(text, from, to, label) {
  if (text.includes(to)) return text;
  const count = text.split(from).length - 1;
  if (count !== 1) throw new Error(`${label}: expected 1 match, found ${count}`);
  console.log(`${label}: applied`);
  return text.replace(from, to);
}

function after(text, marker, insertion, label) {
  if (text.includes(insertion.trim())) return text;
  const count = text.split(marker).length - 1;
  if (count !== 1) throw new Error(`${label}: expected 1 marker, found ${count}`);
  console.log(`${label}: applied`);
  return text.replace(marker, marker + insertion);
}

function patchRealtime() {
  const content = `import { invalidateAppDataCache, supabase } from "@/lib/supabase";

function realtimeEnabled() {
  return String(process.env.EXPO_PUBLIC_ENABLE_REALTIME ?? "true").trim().toLowerCase() !== "false";
}

export function isClinicRealtimeEnabled() {
  return realtimeEnabled();
}

type Options = {
  clinicId?: string | null;
  onChange: () => void | Promise<void>;
  debounceMs?: number;
  appointments?: boolean;
  payments?: boolean;
  treatments?: boolean;
  channelKey?: string;
};

let channelCounter = 0;

export function subscribeClinicWorkflowRealtime({
  clinicId,
  onChange,
  debounceMs = 350,
  appointments = false,
  payments = false,
  treatments = false,
  channelKey = "workflow",
}: Options) {
  if (!realtimeEnabled() || !clinicId) return () => undefined;

  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;
  const refresh = (scopes: Array<"dashboard" | "appointments" | "payments" | "treatments">) => {
    scopes.forEach((scope) => invalidateAppDataCache(scope));
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      if (!disposed) Promise.resolve(onChange()).catch((error) => console.warn("Realtime refresh failed", error));
    }, Math.max(200, debounceMs));
  };

  channelCounter += 1;
  let channel = supabase.channel("clinic:" + channelKey + ":" + clinicId + ":" + channelCounter);

  if (appointments) {
    channel = channel.on("postgres_changes", {
      event: "*", schema: "public", table: "appointments", filter: "clinic_id=eq." + clinicId,
    }, () => refresh(["dashboard", "appointments"]));
  }

  if (payments) {
    channel = channel
      .on("postgres_changes", {
        event: "INSERT", schema: "public", table: "payments", filter: "clinic_id=eq." + clinicId,
      }, () => refresh(["dashboard", "payments", "treatments"]))
      .on("postgres_changes", {
        event: "*", schema: "public", table: "invoices", filter: "clinic_id=eq." + clinicId,
      }, () => refresh(["dashboard", "payments", "treatments"]));
  }

  if (treatments) {
    channel = channel.on("postgres_changes", {
      event: "*", schema: "public", table: "treatments", filter: "clinic_id=eq." + clinicId,
    }, () => refresh(["dashboard", "treatments"]));
  }

  channel.subscribe((status, error) => {
    if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") console.warn("Realtime " + channelKey + ": " + status, error);
  });

  return () => {
    disposed = true;
    if (timer) clearTimeout(timer);
    void supabase.removeChannel(channel);
  };
}

export function subscribeClinicDashboardRealtime(options: Pick<Options, "clinicId" | "onChange" | "debounceMs" | "channelKey">) {
  return subscribeClinicWorkflowRealtime({ ...options, appointments: true, payments: true });
}

export function subscribeClinicOngoingTreatmentsRealtime(options: Pick<Options, "clinicId" | "onChange" | "debounceMs">) {
  return subscribeClinicWorkflowRealtime({ ...options, treatments: true, payments: true, channelKey: "ongoing-treatments" });
}
`;
  writeFileSync('src/lib/realtime.ts', content, 'utf8');
  console.log('src/lib/realtime.ts: updated');
}

function patchReception() {
  update('src/app/(reception)/dashboard.tsx', (text) => {
    text = once(text, 'import { useEffect, useMemo, useState } from "react";', 'import { useEffect, useMemo, useRef, useState } from "react";', 'reception useRef');
    text = after(text, 'import { useAuth } from "@/lib/auth";\n', 'import { subscribeClinicDashboardRealtime } from "@/lib/realtime";\n', 'reception realtime import');
    text = after(text, '  const [rescheduleItem, setRescheduleItem] = useState<AppointmentRow | null>(null);\n', '  const completionLocksRef = useRef(new Set<string>());\n', 'reception lock');

    const mounted = '  useEffect(() => {\n    void load();\n  }, []);\n';
    const realtime = `\n  async function refreshWorkflow(force = false) {
    const [data, row] = await Promise.all([
      getDashboardStats({ force }),
      getWorkflowDashboardSummary({ force }),
    ]);
    const { data: appointmentRows, error } = await supabase
      .from("appointments")
      .select("id,patient_id,appointment_time,status,patients(id,name,phone,photo_url)")
      .gte("appointment_time", startOfToday())
      .lte("appointment_time", endOfToday())
      .in("status", ["scheduled", "waiting", "checked_in", "booked"])
      .order("appointment_time", { ascending: true });
    setStats(!error && Array.isArray(appointmentRows) ? { ...data, todayAppointmentList: appointmentRows as any } : data);
    if (row) setSummary(row);
  }

  useEffect(() => subscribeClinicDashboardRealtime({
    clinicId: profile?.clinic_id,
    channelKey: "reception-dashboard",
    onChange: () => refreshWorkflow(true),
  }), [profile?.clinic_id]);
`;
    text = after(text, mounted, realtime, 'reception subscription');
    text = once(text, '      await load(true);', '      await refreshWorkflow(true);', 'reception reschedule refresh');

    const oldFn = `  async function performComplete(item: AppointmentRow) {
    try {
      setBusyAppointmentId(item.id);
      await updateAppointmentStatus(item.id, "completed");
      await load(true);
    } catch (error) {
      Alert.alert("Complete failed", error instanceof Error ? error.message : "Please try again.");
    } finally {
      setBusyAppointmentId(null);
    }
  }`;
    const newFn = `  async function performComplete(item: AppointmentRow) {
    if (completionLocksRef.current.has(item.id)) return;
    completionLocksRef.current.add(item.id);
    const previousStats = stats;
    const previousSummary = summary;
    setBusyAppointmentId(item.id);
    setStats((current) => current ? {
      ...current,
      todayAppointmentList: ((current.todayAppointmentList ?? []) as AppointmentRow[]).filter((row) => row.id !== item.id) as any,
    } : current);
    setSummary((current: any) => current ? {
      ...current,
      waiting_count: Math.max(Number(current.waiting_count || 0) - 1, 0),
      completed_count: Number(current.completed_count || 0) + 1,
    } : current);
    try {
      await updateAppointmentStatus(item.id, "completed");
      await refreshWorkflow(true);
    } catch (error) {
      setStats(previousStats);
      setSummary(previousSummary);
      Alert.alert("Complete failed", error instanceof Error ? error.message : "Please try again.");
    } finally {
      completionLocksRef.current.delete(item.id);
      setBusyAppointmentId(null);
    }
  }`;
    return once(text, oldFn, newFn, 'reception optimistic complete');
  });
}

function patchHead() {
  update('src/app/(head)/dashboard.tsx', (text) => {
    text = once(text, '  useMemo,\n  useState,', '  useMemo,\n  useRef,\n  useState,', 'head useRef');
    text = after(text, 'import { useAuth } from "@/lib/auth";\n', 'import { subscribeClinicDashboardRealtime } from "@/lib/realtime";\n', 'head realtime import');
    text = after(text, '  const [rescheduleItem, setRescheduleItem] = useState<AppointmentRow | null>(null);\n', '  const completionLocksRef = useRef(new Set<string>());\n', 'head lock');
    const mounted = '  useEffect(() => {\n    void load();\n  }, []);\n';
    const realtime = `\n  async function refreshWorkflow(force = false) {
    const [data, row] = await Promise.all([
      getDashboardStats({ force }),
      getWorkflowDashboardSummary({ force }),
    ]);
    setStats(data);
    setSummary(row);
  }

  useEffect(() => subscribeClinicDashboardRealtime({
    clinicId: profile?.clinic_id,
    channelKey: "head-dashboard",
    onChange: () => refreshWorkflow(true),
  }), [profile?.clinic_id]);
`;
    text = after(text, mounted, realtime, 'head subscription');
    text = once(text, '      await load(true);', '      await refreshWorkflow(true);', 'head reschedule refresh');

    const oldFn = `  async function performComplete(item: AppointmentRow) {
    try {
      setBusyAppointmentId(item.id);
      await updateAppointmentStatus(item.id, "completed");
      await load(true);
    } catch (error) {
      Alert.alert(
        "Complete failed",
        error instanceof Error ? error.message : "Please try again."
      );
    } finally {
      setBusyAppointmentId(null);
    }
  }`;
    const newFn = `  async function performComplete(item: AppointmentRow) {
    if (completionLocksRef.current.has(item.id)) return;
    completionLocksRef.current.add(item.id);
    const previousStats = stats;
    const previousSummary = summary;
    setBusyAppointmentId(item.id);
    setStats((current) => current ? {
      ...current,
      todayAppointmentList: ((current.todayAppointmentList ?? []) as AppointmentRow[]).filter((row) => row.id !== item.id) as any,
    } : current);
    setSummary((current) => current ? {
      ...current,
      waiting_count: Math.max(Number(current.waiting_count || 0) - 1, 0),
      completed_count: Number(current.completed_count || 0) + 1,
    } : current);
    try {
      await updateAppointmentStatus(item.id, "completed");
      await refreshWorkflow(true);
    } catch (error) {
      setStats(previousStats);
      setSummary(previousSummary);
      Alert.alert("Complete failed", error instanceof Error ? error.message : "Please try again.");
    } finally {
      completionLocksRef.current.delete(item.id);
      setBusyAppointmentId(null);
    }
  }`;
    return once(text, oldFn, newFn, 'head optimistic complete');
  });
}

function patchDoctor() {
  update('src/app/(doctor)/dashboard.tsx', (text) => {
    text = after(text, 'import { useAuth } from "@/lib/auth";\n', 'import { subscribeClinicDashboardRealtime } from "@/lib/realtime";\n', 'doctor realtime import');
    const mounted = '  useEffect(() => {\n    void load();\n  }, []);\n';
    const realtime = `\n  async function refreshWorkflow(force = false) {
    const [data, row] = await Promise.all([
      getDashboardStats({ force }),
      getWorkflowDashboardSummary({ force }),
    ]);
    setStats(data);
    setSummary(row);
  }

  useEffect(() => subscribeClinicDashboardRealtime({
    clinicId: profile?.clinic_id,
    channelKey: "doctor-dashboard",
    onChange: () => refreshWorkflow(true),
  }), [profile?.clinic_id]);
`;
    return after(text, mounted, realtime, 'doctor subscription');
  });
}

function patchOngoing() {
  update('src/components/OngoingTreatmentsSection.tsx', (text) => {
    text = once(text, 'import { useEffect, useMemo, useState } from "react";', 'import { useEffect, useMemo, useRef, useState } from "react";', 'ongoing useRef');
    text = after(text, 'import { colors } from "@/constants/colors";\n', 'import { useAuth } from "@/lib/auth";\nimport { subscribeClinicOngoingTreatmentsRealtime } from "@/lib/realtime";\n', 'ongoing realtime imports');
    text = after(text, '}) {\n  const [items, setItems] = useState<OngoingTreatmentItem[]>([]);\n', '  const { profile } = useAuth();\n', 'ongoing profile');
    text = after(text, '  const [updatingId, setUpdatingId] = useState<string | null>(null);\n', '  const updateLocksRef = useRef(new Set<string>());\n', 'ongoing lock');
    text = once(text, '  async function load() {\n    try {\n      setLoading(true);', '  async function load(showLoading = true) {\n    try {\n      if (showLoading) setLoading(true);', 'ongoing quiet load');
    text = once(text,
`    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [doctorOnly, limit]);`,
`    } finally {
      if (showLoading) setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [doctorOnly, limit]);

  useEffect(() => subscribeClinicOngoingTreatmentsRealtime({
    clinicId: profile?.clinic_id,
    onChange: () => load(false),
  }), [profile?.clinic_id, doctorOnly, limit]);`, 'ongoing subscription');

    const oldFn = `  async function updateStatus(item: OngoingTreatmentItem, status: OngoingTreatmentStatus) {
    try {
      setUpdatingId(item.id);
      await updateOngoingTreatmentStatus(item.id, status);
      await load();
      Alert.alert("Treatment updated", \`\${item.treatmentName} is now \${statusLabel(status).toLowerCase()}.\`);
    } catch (error) {
      Alert.alert("Update failed", error instanceof Error ? error.message : "Please try again.");
    } finally {
      setUpdatingId(null);
    }
  }`;
    const newFn = `  async function updateStatus(item: OngoingTreatmentItem, status: OngoingTreatmentStatus) {
    if (updateLocksRef.current.has(item.id)) return;
    updateLocksRef.current.add(item.id);
    const previousItems = items;
    setUpdatingId(item.id);
    setItems((current) => status === "completed" || status === "cancelled"
      ? current.filter((row) => row.id !== item.id)
      : current.map((row) => row.id === item.id ? { ...row, status } : row));
    try {
      await updateOngoingTreatmentStatus(item.id, status);
      await load(false);
      Alert.alert("Treatment updated", \`\${item.treatmentName} is now \${statusLabel(status).toLowerCase()}.\`);
    } catch (error) {
      setItems(previousItems);
      Alert.alert("Update failed", error instanceof Error ? error.message : "Please try again.");
    } finally {
      updateLocksRef.current.delete(item.id);
      setUpdatingId(null);
    }
  }`;
    return once(text, oldFn, newFn, 'ongoing optimistic complete');
  });
}

function patchLocks() {
  update('src/app/reception/checkin.tsx', (text) => {
    text = after(text, '  const patientSearchMountedRef = useRef(false);\n', '  const checkInLockRef = useRef(false);\n', 'checkin lock ref');
    text = once(text, '  async function checkIn(skipLimitWarning = false) {\n    const fee = toNumber(opAmount);', '  async function checkIn(skipLimitWarning = false) {\n    if (saving || checkInLockRef.current) return;\n\n    const fee = toNumber(opAmount);', 'checkin guard');
    text = once(text, '    try {\n      if (mode === "new" && !skipLimitWarning) {', '    checkInLockRef.current = true;\n    setSaving(true);\n\n    try {\n      if (mode === "new" && !skipLimitWarning) {', 'checkin lock');
    text = once(text, '\n      setSaving(true);\n      const { data, error } = await supabase.rpc("reception_quick_checkin", {', '\n      const { data, error } = await supabase.rpc("reception_quick_checkin", {', 'checkin remove late state');
    return once(text, '    } finally {\n      setSaving(false);\n    }\n  }', '    } finally {\n      checkInLockRef.current = false;\n      setSaving(false);\n    }\n  }', 'checkin unlock');
  });

  update('src/app/payment/fee.tsx', (text) => {
    text = after(text, '  const patientSearchMountedRef = useRef(false);\n', '  const collectFeeLockRef = useRef(false);\n', 'payment lock ref');
    text = once(text, '  async function collectFee() {\n    if (!selectedPatientId) {', '  async function collectFee() {\n    if (saving || collectFeeLockRef.current) return;\n\n    if (!selectedPatientId) {', 'payment guard');
    text = once(text, '    setSaving(true);\n    setSuccessMessage("");', '    collectFeeLockRef.current = true;\n    setSaving(true);\n    setSuccessMessage("");', 'payment lock');
    return once(text, '    } finally {\n      setSaving(false);\n    }\n  }', '    } finally {\n      collectFeeLockRef.current = false;\n      setSaving(false);\n    }\n  }', 'payment unlock');
  });
}

function patchFlags() {
  for (const path of ['.env', '.env.local', '.env.example']) {
    if (!existsSync(path)) continue;
    update(path, (text) => /^EXPO_PUBLIC_ENABLE_REALTIME=/m.test(text)
      ? text.replace(/^EXPO_PUBLIC_ENABLE_REALTIME=.*$/m, 'EXPO_PUBLIC_ENABLE_REALTIME=true')
      : `${text.trimEnd()}\nEXPO_PUBLIC_ENABLE_REALTIME=true\n`);
  }
  update('eas.json', (text) => {
    const json = JSON.parse(text);
    for (const profile of Object.values(json.build ?? {})) {
      if (profile && typeof profile === 'object') profile.env = { ...(profile.env ?? {}), EXPO_PUBLIC_ENABLE_REALTIME: 'true' };
    }
    return JSON.stringify(json, null, 2) + '\n';
  });
}

function verify() {
  const checks = [
    ['src/lib/realtime.ts', 'table: "treatments"'],
    ['src/app/(reception)/dashboard.tsx', 'completionLocksRef'],
    ['src/app/(head)/dashboard.tsx', 'completionLocksRef'],
    ['src/app/(doctor)/dashboard.tsx', 'subscribeClinicDashboardRealtime'],
    ['src/components/OngoingTreatmentsSection.tsx', 'subscribeClinicOngoingTreatmentsRealtime'],
    ['src/app/reception/checkin.tsx', 'checkInLockRef'],
    ['src/app/payment/fee.tsx', 'collectFeeLockRef'],
    ['.env.example', 'EXPO_PUBLIC_ENABLE_REALTIME=true'],
  ];
  for (const [path, marker] of checks) if (!readFileSync(path, 'utf8').includes(marker)) throw new Error(`${path}: missing ${marker}`);
  console.log('Targeted Realtime source verification passed.');
}

function typecheck() {
  console.log('Running TypeScript validation...');
  if (process.platform === 'win32') execFileSync('cmd.exe', ['/d', '/s', '/c', 'npm run typecheck'], { stdio: 'inherit' });
  else execFileSync('npm', ['run', 'typecheck'], { stdio: 'inherit' });
}

patchRealtime();
patchReception();
patchHead();
patchDoctor();
patchOngoing();
patchLocks();
patchFlags();
verify();
typecheck();
console.log('\nCapDent targeted Realtime update applied successfully.');
