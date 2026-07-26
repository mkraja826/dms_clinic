import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Pressable, Text, TextInput, View } from "react-native";
import { AppButton } from "@/components/AppButton";
import { AppInput } from "@/components/AppInput";
import { EmptyState } from "@/components/EmptyState";
import { Screen } from "@/components/Screen";
import { SectionCard } from "@/components/SectionCard";
import { StatusBadge } from "@/components/StatusBadge";
import { SuccessNotice } from "@/components/SuccessNotice";
import { colors } from "@/constants/colors";
import {
  DEFAULT_OP_FEE_AMOUNT,
  getClinicFeatureSettings,
} from "@/lib/clinicOptions";
import {
  formatClinicMoney,
  getDefaultClinicPreferences,
} from "@/lib/clinicLocale";
import { getClinicPreferences } from "@/lib/clinicPreferences";
import { searchPatientsPage } from "@/lib/patientDirectory";
import { Patient, PaymentCategory, supabase } from "@/lib/supabase";

type FeeType = Exclude<PaymentCategory, "pending_collection"> | "other";

const PAYMENT_METHODS = ["Cash", "UPI", "Card"];
const FEE_TYPES: {
  key: FeeType;
  title: string;
  subtitle: string;
  icon: keyof typeof Ionicons.glyphMap;
}[] = [
  {
    key: "op_fee",
    title: "OP Fee",
    subtitle: "Clinic default OP amount",
    icon: "receipt-outline",
  },
  {
    key: "xray_fee",
    title: "X-ray Fee",
    subtitle: "Separate X-ray amount",
    icon: "scan-outline",
  },
  {
    key: "medication_fee",
    title: "Medication Fee",
    subtitle: "Medicine amount",
    icon: "medical-outline",
  },
  {
    key: "treatment_fee",
    title: "Treatment Fee",
    subtitle: "Procedure payment",
    icon: "hammer-outline",
  },
  {
    key: "other",
    title: "Other Fee",
    subtitle: "Clinic-defined charge",
    icon: "wallet-outline",
  },
];

function toNumber(value: string) {
  const cleaned = value.replace(/[^0-9.]/g, "");
  const number = Number(cleaned);
  return Number.isFinite(number) ? number : 0;
}

function getFeeConfig(type: FeeType) {
  return FEE_TYPES.find((item) => item.key === type) || FEE_TYPES[0];
}

function getDefaultAmount(type: FeeType, opFeeAmount: number) {
  return type === "op_fee"
    ? String(opFeeAmount || DEFAULT_OP_FEE_AMOUNT)
    : "";
}

function getDefaultNotes(type: FeeType) {
  return getFeeConfig(type).title;
}

function getErrorMessage(error: unknown) {
  if (!error) return "Unknown error";
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;

  if (typeof error === "object") {
    const err = error as {
      message?: string;
      details?: string;
      hint?: string;
      code?: string;
    };
    return [
      err.message,
      err.details,
      err.hint,
      err.code ? `Code: ${err.code}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  }

  return "Unknown error";
}

export default function ReceptionFeeScreen() {
  const params = useLocalSearchParams<{ fee_type?: string }>();
  const incomingType = (FEE_TYPES.some(
    (item) => item.key === params.fee_type
  )
    ? params.fee_type
    : "op_fee") as FeeType;

  const [clinicOpFee, setClinicOpFee] = useState(DEFAULT_OP_FEE_AMOUNT);
  const [currencyCode, setCurrencyCode] = useState(
    getDefaultClinicPreferences().currencyCode
  );
  const [feeType, setFeeType] = useState<FeeType>(incomingType);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [patientSearch, setPatientSearch] = useState("");
  const [selectedPatientId, setSelectedPatientId] = useState("");
  const [amount, setAmount] = useState(
    getDefaultAmount(incomingType, DEFAULT_OP_FEE_AMOUNT)
  );
  const [paymentMethod, setPaymentMethod] = useState("Cash");
  const [notes, setNotes] = useState(getDefaultNotes(incomingType));
  const [successMessage, setSuccessMessage] = useState("");
  const [loadingPatients, setLoadingPatients] = useState(true);
  const [saving, setSaving] = useState(false);
  const patientRequestRef = useRef(0);
  const patientSearchMountedRef = useRef(false);
  const collectFeeLockRef = useRef(false);

  const config = getFeeConfig(feeType);
  const money = (value: string | number) =>
    formatClinicMoney(value, currencyCode);

  function changeFeeType(next: FeeType) {
    setFeeType(next);
    setAmount(getDefaultAmount(next, clinicOpFee));
    setNotes(getDefaultNotes(next));
    setSuccessMessage("");
  }

  async function loadPatients(
    searchText = patientSearch,
    refreshSettings = false
  ) {
    const requestId = patientRequestRef.current + 1;
    patientRequestRef.current = requestId;

    try {
      setLoadingPatients(true);
      const [patientResult, clinicSettings, clinicPreferences] =
        await Promise.all([
          searchPatientsPage({
            query: searchText,
            page: 1,
            pageSize: 12,
          }),
          refreshSettings
            ? getClinicFeatureSettings().catch(() => ({
                op_fee_amount: DEFAULT_OP_FEE_AMOUNT,
              }))
            : Promise.resolve(null),
          refreshSettings
            ? getClinicPreferences().catch(() =>
                getDefaultClinicPreferences()
              )
            : Promise.resolve(null),
        ]);

      if (requestId !== patientRequestRef.current) return;

      if (clinicSettings) {
        const nextOpFee = Number(
          clinicSettings.op_fee_amount || DEFAULT_OP_FEE_AMOUNT
        );
        setClinicOpFee(nextOpFee);

        if (feeType === "op_fee") {
          setAmount(String(nextOpFee));
        }
      }

      if (clinicPreferences) {
        setCurrencyCode(clinicPreferences.currencyCode);
      }

      setPatients(patientResult.patients);
    } catch (error) {
      Alert.alert("Patients load failed", getErrorMessage(error));
    } finally {
      if (requestId === patientRequestRef.current) setLoadingPatients(false);
    }
  }

  useEffect(() => {
    void loadPatients("", true);
  }, []);

  useEffect(() => {
    if (!patientSearchMountedRef.current) {
      patientSearchMountedRef.current = true;
      return;
    }

    const timeout = setTimeout(() => {
      void loadPatients(patientSearch);
    }, 260);

    return () => clearTimeout(timeout);
  }, [patientSearch]);

  const selectedPatient = useMemo(
    () => patients.find((patient) => patient.id === selectedPatientId) || null,
    [patients, selectedPatientId]
  );

  const filteredPatients = patients;

  function resetForAnother() {
    setSelectedPatientId("");
    setPatientSearch("");
    setAmount(getDefaultAmount(feeType, clinicOpFee));
    setPaymentMethod("Cash");
    setNotes(getDefaultNotes(feeType));
  }

  async function collectFee() {
    if (saving || collectFeeLockRef.current) return;

    if (!selectedPatientId) {
      Alert.alert("Patient missing", "Select patient first.");
      return;
    }

    const fee = toNumber(amount);
    if (fee <= 0) {
      Alert.alert("Invalid amount", "Amount must be greater than zero.");
      return;
    }

    collectFeeLockRef.current = true;
    setSaving(true);
    setSuccessMessage("");

    try {
      const { error } = await supabase.rpc("collect_reception_fee", {
        p_patient_id: selectedPatientId,
        p_fee_type: feeType,
        p_amount: fee,
        p_payment_method: paymentMethod,
        p_notes: notes.trim() || getDefaultNotes(feeType),
      });

      if (error) throw error;

      setSuccessMessage(
        `${config.title} collected: ${money(fee)} from ${
          selectedPatient?.name || "patient"
        }`
      );

      Alert.alert(
        `${config.title} collected`,
        `${money(fee)} collected from ${
          selectedPatient?.name || "patient"
        } and added to today's revenue.`,
        [
          {
            text: "Open Patient",
            onPress: () =>
              router.replace(`/patient/${selectedPatientId}` as never),
          },
          { text: "Collect Another", onPress: resetForAnother },
        ]
      );
    } catch (error) {
      Alert.alert("Collection failed", getErrorMessage(error));
    } finally {
      collectFeeLockRef.current = false;
      setSaving(false);
    }
  }

  return (
    <Screen
      refreshing={loadingPatients}
      onRefresh={() => loadPatients(patientSearch, true)}
    >
      <View style={{ gap: 6 }}>
        <Text style={{ color: colors.text, fontSize: 30, fontWeight: "900" }}>
          Reception Fees
        </Text>
        <Text style={{ color: colors.muted, fontSize: 15, lineHeight: 21 }}>
          Collect OP, X-ray, medication, treatment, or other clinic fees with
          correct patient and payment method.
        </Text>
      </View>

      {successMessage ? (
        <SuccessNotice title="Payment saved" message={successMessage} />
      ) : null}

      <SectionCard
        title="Fee Type"
        subtitle="Choose the correct fee category so clinic reports stay clear."
      >
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
          {FEE_TYPES.map((item) => (
            <FeeTypeCard
              key={item.key}
              title={item.title}
              subtitle={item.subtitle}
              icon={item.icon}
              selected={feeType === item.key}
              onPress={() => changeFeeType(item.key)}
            />
          ))}
        </View>
      </SectionCard>

      <SectionCard
        title="Select Patient"
        subtitle="Confirm the patient before collecting any clinic fee."
      >
        {selectedPatient ? (
          <View
            style={{
              padding: 14,
              borderRadius: 18,
              borderWidth: 1,
              borderColor: colors.primary,
              backgroundColor: colors.primarySoft,
              gap: 8,
            }}
          >
            <View
              style={{ flexDirection: "row", alignItems: "center", gap: 10 }}
            >
              <Ionicons
                name="person-circle-outline"
                size={28}
                color={colors.primary}
              />
              <View style={{ flex: 1 }}>
                <Text
                  style={{
                    color: colors.text,
                    fontSize: 17,
                    fontWeight: "900",
                  }}
                >
                  {selectedPatient.name}
                </Text>
                <Text style={{ color: colors.muted, marginTop: 2 }}>
                  {selectedPatient.phone || "No phone"}
                </Text>
              </View>
              <StatusBadge label="Selected" tone="success" />
            </View>
            <AppButton
              title="Change Patient"
              icon="swap-horizontal-outline"
              variant="secondary"
              onPress={() => setSelectedPatientId("")}
            />
          </View>
        ) : (
          <View style={{ gap: 12 }}>
            <View
              style={{
                minHeight: 54,
                borderRadius: 18,
                borderWidth: 1,
                borderColor: colors.border,
                backgroundColor: colors.background,
                flexDirection: "row",
                alignItems: "center",
                paddingHorizontal: 14,
                gap: 10,
              }}
            >
              <Ionicons name="search-outline" size={21} color={colors.muted} />
              <TextInput
                value={patientSearch}
                onChangeText={setPatientSearch}
                placeholder="Search patient name, phone, or ID"
                placeholderTextColor={colors.muted}
                style={{
                  flex: 1,
                  minHeight: 54,
                  color: colors.text,
                  fontSize: 16,
                }}
              />
            </View>

            {loadingPatients ? (
              <Text style={{ color: colors.muted }}>Loading patients...</Text>
            ) : filteredPatients.length ? (
              <View style={{ gap: 10 }}>
                {filteredPatients.map((patient) => (
                  <Pressable
                    key={patient.id}
                    onPress={() => setSelectedPatientId(patient.id)}
                    style={({ pressed }) => ({
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 12,
                      padding: 12,
                      borderRadius: 18,
                      backgroundColor: pressed
                        ? colors.surfaceSoft
                        : colors.background,
                      borderWidth: 1,
                      borderColor: colors.border,
                    })}
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
                      <Ionicons
                        name="person-outline"
                        size={21}
                        color={colors.primary}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: colors.text, fontWeight: "900" }}>
                        {patient.name}
                      </Text>
                      <Text style={{ color: colors.muted, marginTop: 2 }}>
                        {patient.phone || "No phone"}
                      </Text>
                    </View>
                    <Ionicons
                      name="chevron-forward"
                      size={18}
                      color={colors.muted}
                    />
                  </Pressable>
                ))}
              </View>
            ) : (
              <EmptyState
                title="No patients found"
                message="Register the patient first, then collect fee."
                icon="search-outline"
              />
            )}
          </View>
        )}
      </SectionCard>

      <SectionCard
        title="Payment"
        subtitle="Check amount, payment method, and notes before saving collection."
      >
        <View
          style={{
            padding: 16,
            borderRadius: 24,
            backgroundColor:
              feeType === "op_fee" ? colors.successSoft : colors.primarySoft,
            borderWidth: 1,
            borderColor: colors.border,
            alignItems: "center",
            gap: 6,
          }}
        >
          <Ionicons
            name={config.icon}
            size={34}
            color={feeType === "op_fee" ? colors.success : colors.primary}
          />
          <Text style={{ color: colors.muted, fontWeight: "800" }}>
            {config.title}
          </Text>
          <Text style={{ color: colors.text, fontSize: 42, fontWeight: "900" }}>
            {amount ? money(amount) : money(0)}
          </Text>
          <Text
            style={{
              color:
                feeType === "op_fee" ? colors.success : colors.primary,
              fontWeight: "900",
            }}
          >
            {feeType === "op_fee"
              ? `Clinic OP fee default: ${money(clinicOpFee)}`
              : "Counts in today's revenue"}
          </Text>
        </View>

        <AppInput
          label="Amount"
          value={amount}
          onChangeText={setAmount}
          keyboardType="numeric"
          placeholder={
            feeType === "op_fee" ? String(clinicOpFee) : "Enter amount"
          }
          helper={
            feeType === "op_fee"
              ? "Default comes from clinic settings. Reception can edit for this patient."
              : "Amount may change per patient."
          }
        />

        <View style={{ flexDirection: "row", gap: 10 }}>
          {PAYMENT_METHODS.map((method) => {
            const selected = paymentMethod === method;
            return (
              <Pressable
                key={method}
                onPress={() => setPaymentMethod(method)}
                style={{
                  flex: 1,
                  minHeight: 48,
                  borderRadius: 999,
                  borderWidth: 1,
                  borderColor: selected ? colors.primary : colors.border,
                  backgroundColor: selected
                    ? colors.primary
                    : colors.background,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Text
                  style={{
                    color: selected ? colors.white : colors.text,
                    fontWeight: "900",
                  }}
                >
                  {method}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <AppInput
          label="Notes"
          value={notes}
          onChangeText={setNotes}
          placeholder={getDefaultNotes(feeType)}
        />
        <AppButton
          title={`Collect ${amount ? money(amount) : config.title}`}
          icon="cash-outline"
          onPress={collectFee}
          loading={saving}
          loadingTitle="Saving payment..."
        />
      </SectionCard>

      <AppButton
        title="Back"
        icon="arrow-back-outline"
        variant="ghost"
        onPress={() => router.back()}
      />
    </Screen>
  );
}

function FeeTypeCard({
  title,
  subtitle,
  icon,
  selected,
  onPress,
}: {
  title: string;
  subtitle: string;
  icon: keyof typeof Ionicons.glyphMap;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        width: "47%",
        minHeight: 112,
        borderRadius: 22,
        borderWidth: 1,
        borderColor: selected ? colors.primary : colors.border,
        backgroundColor: selected ? colors.primary : colors.background,
        padding: 13,
        justifyContent: "space-between",
      }}
    >
      <Ionicons
        name={icon}
        size={25}
        color={selected ? colors.white : colors.primary}
      />
      <View style={{ gap: 3 }}>
        <Text
          style={{
            color: selected ? colors.white : colors.text,
            fontWeight: "900",
            fontSize: 15,
          }}
        >
          {title}
        </Text>
        <Text
          style={{
            color: selected ? "rgba(255,255,255,0.78)" : colors.muted,
            fontSize: 12,
          }}
        >
          {subtitle}
        </Text>
      </View>
    </Pressable>
  );
}
