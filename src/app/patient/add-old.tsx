import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Alert, Switch, Text, View } from "react-native";
import { AppButton } from "@/components/AppButton";
import { AppInput } from "@/components/AppInput";
import { Screen } from "@/components/Screen";
import { SectionCard } from "@/components/SectionCard";
import { colors } from "@/constants/colors";
import {
  getCapDentEntitlementsV25,
  patientQuotaMessage,
} from "@/lib/pricingV25";
import { ClinicPatientLimitStatus, createOldPatient, getClinicPatientLimitStatus, searchPatients } from "@/lib/supabase";

const datePattern = /^\d{4}-\d{2}-\d{2}$/;

function optionalNumber(value: string) {
  const clean = value.replace(/[^0-9.]/g, "");
  const parsed = Number(clean);
  return clean && Number.isFinite(parsed) ? parsed : undefined;
}

function isValidOptionalDate(value: string) {
  return !value.trim() || datePattern.test(value.trim());
}

export default function AddOldPatientScreen() {
  const [form, setForm] = useState({
    name: "",
    old_patient_code: "",
    registered_date: "",
    last_visit_date: "",
    gender: "",
    age: "",
    phone: "",
    email: "",
    address: "",
    emergency_contact: "",
    old_record_notes: "",
    opening_balance: "",
    opening_balance_note: "",
    allergies: "",
    current_medicines: "",
    other_notes: "",
  });
  const [historyFlags, setHistoryFlags] = useState({
    heart_issue: false,
    kidney_issue: false,
    brain_issue: false,
    diabetes: false,
    blood_pressure: false,
  });
  const [limitStatus, setLimitStatus] = useState<ClinicPatientLimitStatus | null>(null);
  const [saving, setSaving] = useState(false);
  const saveOldPatientLockRef = useRef(false);

  function setField(key: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function loadLimitStatus() {
    try {
      const usage = await getClinicPatientLimitStatus();
      setLimitStatus(usage);
    } catch (error) {
      console.warn("Patient limit load failed:", error);
    }
  }

  useEffect(() => {
    loadLimitStatus();
  }, []);

  async function save(skipDuplicateCheck = false, skipLimitWarning = false) {
    if (saving || saveOldPatientLockRef.current) return;

    if (!form.name.trim()) {
      Alert.alert("Name required", "Enter the old patient name.");
      return;
    }

    if (!isValidOptionalDate(form.registered_date) || !isValidOptionalDate(form.last_visit_date)) {
      Alert.alert("Date format", "Use YYYY-MM-DD for old registration date and last visit date.");
      return;
    }

    saveOldPatientLockRef.current = true;
    setSaving(true);

    try {
      const serverEntitlements = await getCapDentEntitlementsV25();
      const serverQuotaMessage = patientQuotaMessage(serverEntitlements);

      if (serverQuotaMessage) {
        Alert.alert("Patient limit reached", serverQuotaMessage, [
          { text: "Cancel", style: "cancel" },
          { text: "View Plans", onPress: () => router.push("/settings/subscription" as never) },
        ]);
        return;
      }

      if (!skipLimitWarning) {
        try {
          const usage = await getClinicPatientLimitStatus();
          setLimitStatus(usage);

          if (usage.level === "blocked") {
            Alert.alert("Free patient limit reached", usage.message, [
              { text: "Cancel", style: "cancel" },
              { text: "View Plans", onPress: () => router.push("/settings/subscription" as never) },
            ]);
            return;
          }

          if (usage.level === "warning") {
            Alert.alert("Free patient slots low", usage.message, [
              { text: "Cancel", style: "cancel" },
              { text: "Continue", onPress: () => void save(skipDuplicateCheck, true) },
            ]);
            return;
          }

          if (usage.level === "notice") {
            Alert.alert("Free patient slots", usage.message);
          }
        } catch (error) {
          Alert.alert("Patient limit check failed", error instanceof Error ? error.message : "Please try again.");
          return;
        }
      }

      const phone = form.phone.trim();

      if (phone && !skipDuplicateCheck) {
        try {
          const matches = await searchPatients(phone);
          const duplicate = matches.find((patient) => patient.phone?.trim() === phone);

          if (duplicate) {
            Alert.alert(
              "Phone already exists",
              `This phone number already belongs to ${duplicate.name}. Continue adding this old record?`,
              [
                { text: "Cancel", style: "cancel" },
                { text: "Continue", onPress: () => void save(true, skipLimitWarning) },
              ]
            );
            return;
          }
        } catch (error) {
          Alert.alert("Duplicate check failed", error instanceof Error ? error.message : "Please try again.");
          return;
        }
      }

      const oldNotes = [
        form.old_record_notes.trim(),
        form.opening_balance.trim()
          ? `Opening pending balance: ${form.opening_balance.trim()}${form.opening_balance_note.trim() ? ` (${form.opening_balance_note.trim()})` : ""}`
          : "",
      ]
        .filter(Boolean)
        .join("\n");

      const patient = await createOldPatient({
        name: form.name.trim(),
        old_patient_code: form.old_patient_code.trim() || undefined,
        registered_date: form.registered_date.trim() || undefined,
        last_visit_date: form.last_visit_date.trim() || undefined,
        gender: form.gender.trim() || undefined,
        age: optionalNumber(form.age),
        phone: phone || undefined,
        email: form.email.trim() || undefined,
        address: form.address.trim() || undefined,
        emergency_contact: form.emergency_contact.trim() || undefined,
        old_record_notes: oldNotes || undefined,
        opening_balance: optionalNumber(form.opening_balance),
        opening_balance_note: form.opening_balance_note.trim() || undefined,
        medical_history: {
          ...historyFlags,
          allergies: form.allergies.trim(),
          current_medicines: form.current_medicines.trim(),
          other_notes: form.other_notes.trim(),
        },
      });

      let nextUsage: ClinicPatientLimitStatus | null = null;
      try {
        nextUsage = await getClinicPatientLimitStatus();
        setLimitStatus(nextUsage);
      } catch (usageError) {
        console.warn("Old patient saved, but updated limit status could not load:", usageError);
      }

      if (nextUsage && !nextUsage.unlimited && (nextUsage.level === "notice" || nextUsage.level === "warning")) {
        Alert.alert("Old patient saved", nextUsage.message, [
          { text: "Open Patient", onPress: () => router.replace({ pathname: "/patient/[id]", params: { id: patient.id } }) },
        ]);
        return;
      }

      router.replace({ pathname: "/patient/[id]", params: { id: patient.id } });
    } catch (error) {
      Alert.alert("Old patient save failed", error instanceof Error ? error.message : "Unable to add old patient.");
    } finally {
      saveOldPatientLockRef.current = false;
      setSaving(false);
    }
  }

  return (
    <Screen>
      <View style={{ gap: 6 }}>
        <Text style={{ color: colors.text, fontSize: 30, fontWeight: "900" }}>
          Add Old Patient
        </Text>
        <Text style={{ color: colors.muted, fontSize: 15, lineHeight: 21 }}>
          Use this for clinic records that existed before CapDent. Add old ID, last visit, history, and opening due if needed.
        </Text>
      </View>

      {limitStatus && !limitStatus.unlimited && limitStatus.level !== "none" ? (
        <SectionCard
          title={limitStatus.level === "blocked" ? "Free Patient Limit Reached" : "Free Patient Slots"}
          subtitle={limitStatus.message}
        >
          {limitStatus.level === "blocked" ? (
            <AppButton
              title="View Plans"
              icon="card-outline"
              variant="secondary"
              onPress={() => router.push("/settings/subscription" as never)}
            />
          ) : null}
        </SectionCard>
      ) : null}

      <SectionCard title="Old Record">
        <AppInput
          label="Old patient ID optional"
          value={form.old_patient_code}
          onChangeText={(value) => setField("old_patient_code", value)}
          placeholder="Example: OLD-124 / clinic file no."
        />
        <AppInput
          label="Old registration date"
          value={form.registered_date}
          onChangeText={(value) => setField("registered_date", value)}
          placeholder="YYYY-MM-DD"
          helper="If entered, this becomes the patient registration date in CapDent."
        />
        <AppInput
          label="Last visit date"
          value={form.last_visit_date}
          onChangeText={(value) => setField("last_visit_date", value)}
          placeholder="YYYY-MM-DD"
        />
        <AppInput
          label="Old treatment / diagnosis notes"
          value={form.old_record_notes}
          onChangeText={(value) => setField("old_record_notes", value)}
          multiline
          placeholder="Previous RCT, extraction, crown, old diagnosis..."
        />
      </SectionCard>

      <SectionCard title="Patient Details">
        <AppInput label="Full name" value={form.name} onChangeText={(value) => setField("name", value)} />
        <AppInput label="Phone optional" value={form.phone} onChangeText={(value) => setField("phone", value)} keyboardType="phone-pad" />
        <AppInput label="Gender" value={form.gender} onChangeText={(value) => setField("gender", value)} />
        <AppInput label="Age" value={form.age} onChangeText={(value) => setField("age", value)} keyboardType="numeric" placeholder="Years" />
        <AppInput label="Email optional" value={form.email} onChangeText={(value) => setField("email", value)} keyboardType="email-address" autoCapitalize="none" />
        <AppInput label="Address" value={form.address} onChangeText={(value) => setField("address", value)} multiline />
        <AppInput label="Emergency contact" value={form.emergency_contact} onChangeText={(value) => setField("emergency_contact", value)} />
      </SectionCard>

      <SectionCard title="Opening Pending Balance">
        <AppInput
          label="Pending amount optional"
          value={form.opening_balance}
          onChangeText={(value) => setField("opening_balance", value)}
          keyboardType="numeric"
          placeholder="Example: 2500"
          helper="If entered, CapDent creates an unpaid opening balance invoice for this old patient."
        />
        <AppInput
          label="Balance note"
          value={form.opening_balance_note}
          onChangeText={(value) => setField("opening_balance_note", value)}
          placeholder="Example: Old crown balance"
        />
      </SectionCard>

      <SectionCard title="Medical History">
        {[
          ["heart_issue", "Heart issue"],
          ["kidney_issue", "Kidney issue"],
          ["brain_issue", "Brain issue"],
          ["diabetes", "Diabetes / sugar"],
          ["blood_pressure", "Blood pressure / BP"],
        ].map(([key, label]) => (
          <View key={key} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <Text style={{ color: colors.text, fontWeight: "700" }}>{label}</Text>
            <Switch
              accessibilityRole="switch"
              accessibilityLabel={label}
              accessibilityState={{ checked: historyFlags[key as keyof typeof historyFlags] }}
              value={historyFlags[key as keyof typeof historyFlags]}
              onValueChange={(value) => setHistoryFlags((current) => ({ ...current, [key]: value }))}
              trackColor={{ true: colors.primarySoft, false: colors.border }}
              thumbColor={historyFlags[key as keyof typeof historyFlags] ? colors.primary : colors.white}
            />
          </View>
        ))}
        <AppInput label="Allergies" value={form.allergies} onChangeText={(value) => setField("allergies", value)} />
        <AppInput label="Current medicines" value={form.current_medicines} onChangeText={(value) => setField("current_medicines", value)} />
        <AppInput label="Other medical notes" value={form.other_notes} onChangeText={(value) => setField("other_notes", value)} multiline />
      </SectionCard>

      <AppButton title="Save Old Patient" icon="archive-outline" onPress={() => save()} loading={saving} />
    </Screen>
  );
}
