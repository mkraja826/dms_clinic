import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Linking,
  Platform,
  Pressable,
  Text,
  View,
} from "react-native";
import { ActionCard } from "@/components/ActionCard";
import { AppButton } from "@/components/AppButton";
import { EmptyState } from "@/components/EmptyState";
import { Screen } from "@/components/Screen";
import { SectionCard } from "@/components/SectionCard";
import { SecureStorageImage } from "@/components/SecureStorageImage";
import { StatusBadge } from "@/components/StatusBadge";
import { colors } from "@/constants/colors";
import {
  deletePatientFileRecord,
  FileType,
  getPatientAuditLogs,
  getPatientById,
  MedicalHistory,
  Patient,
  PatientAuditLog,
  PatientFile,
  supabase,
  Treatment,
  Visit,
  Invoice,
} from "@/lib/supabase";
import { resolveStorageUrls } from "@/lib/storageUrls";

type PatientDetails = {
  patient: Patient;
  history: MedicalHistory | null;
  visits: Visit[];
  treatments: Treatment[];
  invoices: Invoice[];
  files: PatientFile[];
};

const imageTypes: FileType[] = ["before_photo", "after_photo", "xray", "prescription", "report", "other"];


function cleanIndianPhone(phone?: string | null) {
  const digits = String(phone || "").replace(/[^0-9]/g, "");

  if (!digits) return "";

  if (digits.length === 10) return `91${digits}`;

  return digits;
}

async function openWhatsAppMessage(phone: string | null | undefined, message: string) {
  const cleaned = cleanIndianPhone(phone);

  if (!cleaned) {
    Alert.alert("No phone number", "This patient does not have a phone number.");
    return;
  }

  const url = `https://wa.me/${cleaned}?text=${encodeURIComponent(message)}`;
  const canOpen = await Linking.canOpenURL(url);

  if (!canOpen) {
    Alert.alert("WhatsApp not available", "Install WhatsApp or check phone number.");
    return;
  }

  await Linking.openURL(url);
}

function buildFollowupMessage(patientName: string) {
  return `Hello ${patientName}, this is a follow-up reminder from our dental clinic. Please reply on WhatsApp or call us to confirm your review appointment. Thank you.`;
}

function buildDueReminderMessage(patientName: string, amount?: number | null) {
  const amountText = amount && amount > 0 ? ` of ₹${Math.round(amount).toLocaleString("en-IN")}` : "";
  return `Hello ${patientName}, this is a payment due reminder from our dental clinic. Your pending amount${amountText} is due. Please reply on WhatsApp or contact reception for payment details. Thank you.`;
}

export default function PatientProfileScreen() {
  const [pendingDueAmount, setPendingDueAmount] = useState(0);
  const params = useLocalSearchParams<{ id?: string }>();
  const patientId = typeof params.id === "string" ? params.id : "";

  const [details, setDetails] = useState<PatientDetails | null>(null);
  const [auditLogs, setAuditLogs] = useState<PatientAuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [deletingFileId, setDeletingFileId] = useState<string | null>(null);

  async function load(showLoading = true) {
    if (!patientId) return;

    try {
      if (showLoading) setLoading(true);
      const data = (await getPatientById(patientId)) as PatientDetails;
      const signedUrls = await resolveStorageUrls(data.files.map((file) => file.file_url));
      setDetails({
        ...data,
        files: data.files.map((file) => ({
          ...file,
          file_url: signedUrls.get(file.file_url) ?? file.file_url,
        })),
      });
      const logs = await getPatientAuditLogs(patientId);
      setAuditLogs(logs);
    } catch (error) {
      Alert.alert(
        "Patient load failed",
        error instanceof Error ? error.message : "Please try again."
      );
    } finally {
      if (showLoading) setLoading(false);
    }
  }

  async function refreshProfile() {
    try {
      setRefreshing(true);
      await load(false);
    } finally {
      setRefreshing(false);
    }
  }


  async function loadPendingDueAmount(patientId: string) {
    try {
      const { data, error } = await supabase.rpc("get_patient_pending_invoices", {
        p_patient_id: patientId,
      });

      if (error) {
        console.warn("Pending due load failed:", error);
        setPendingDueAmount(0);
        return;
      }

      const total = ((data || []) as { due_amount?: number | string | null }[]).reduce(
        (sum, invoice) => sum + Number(invoice.due_amount || 0),
        0
      );

      setPendingDueAmount(total);
    } catch (error) {
      console.warn("Pending due load failed:", error);
      setPendingDueAmount(0);
    }
  }

  useEffect(() => {
    load();
  }, [patientId]);

  const groupedFiles = useMemo(() => {
    const files = details?.files ?? [];

    return {
      before_photo: files.filter((file) => file.file_type === "before_photo"),
      after_photo: files.filter((file) => file.file_type === "after_photo"),
      prescription: files.filter((file) => file.file_type === "prescription"),
      xray: files.filter((file) => file.file_type === "xray"),
      report: files.filter((file) => file.file_type === "report"),
      other: files.filter((file) => file.file_type === "other"),
    };
  }, [details?.files]);

  async function deleteFile(file: PatientFile) {
    const performDelete = async () => {
      try {
        setDeletingFileId(file.id);

        await deletePatientFileRecord(file.id);

        await load();
      } catch (error) {
        Alert.alert(
          "Delete failed",
          error instanceof Error ? error.message : "Please try again."
        );
      } finally {
        setDeletingFileId(null);
      }
    };

    if (Platform.OS === "web") {
      const confirmed = globalThis.confirm?.(
        "Delete file?\n\nThis removes the file from this patient profile."
      );
      if (confirmed) await performDelete();
      return;
    }

    Alert.alert(
      "Delete file?",
      "This removes the file from this patient profile. Use this only if the doctor decides this photo/file should not stay.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: performDelete },
      ]
    );
  }

  function openFile(file: PatientFile) {
    router.push({
      pathname: "/image-viewer",
      params: {
        url: file.file_url,
        name: file.file_name,
        type: file.file_type,
      },
    } as never);
  }


  useEffect(() => {
    if (details?.patient?.id) {
      loadPendingDueAmount(details.patient.id);
    }
  }, [details?.patient?.id]);

  if (loading) {
    return (
      <Screen>
        <Text style={{ color: colors.muted }}>Loading patient profile...</Text>
      </Screen>
    );
  }

  if (!details?.patient) {
    return (
      <Screen>
        <EmptyState
          title="Patient not found"
          message="Go back and search again."
          icon="person-circle-outline"
        />
      </Screen>
    );
  }

  const { patient, history, visits, treatments, invoices } = details;

  return (
    <Screen refreshing={refreshing} onRefresh={refreshProfile}>
      <View style={{ gap: 8 }}>
        <Text style={{ color: colors.text, fontSize: 30, fontWeight: "900" }}>
          {patient.name}
        </Text>

        <Text style={{ color: colors.muted, fontSize: 15 }}>
          {patient.phone || "No phone"} {patient.age ? `• ${patient.age} yrs` : ""}{" "}
          {patient.gender ? `• ${patient.gender}` : ""}
        </Text>

        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {patient.patient_code ? <StatusBadge label={patient.patient_code} /> : null}
          <StatusBadge label={`Visits: ${visits.length}`} tone="success" />
          <StatusBadge label={`Files: ${details.files.length}`} />
        </View>
      </View>

      <SectionCard title="Patient Actions" subtitle="Quick actions for today's treatment, uploads, follow-up, and payment reminders.">
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
          <QuickAction
            title="Add visit"
            icon="sparkles-outline"
            onPress={() =>
              router.push({
                pathname: "/patient/visit",
                params: { patient_id: patient.id },
              } as never)
            }
          />
          <QuickAction
            title="Edit details"
            icon="create-outline"
            onPress={() =>
              router.push({
                pathname: "/patient/edit",
                params: { patient_id: patient.id },
              } as never)
            }
          />
          <QuickAction
            title="Edit history"
            icon="medkit-outline"
            onPress={() =>
              router.push({
                pathname: "/patient/medical-history",
                params: { patient_id: patient.id },
              } as never)
            }
          />
          <QuickAction
            title="Gallery"
            icon="images-outline"
            onPress={() =>
              router.push({
                pathname: "/gallery",
                params: { patient_id: patient.id },
              } as never)
            }
          />
          <QuickAction
            title="Before photo"
            icon="camera-outline"
            onPress={() =>
              router.push({
                pathname: "/patient/upload",
                params: { patient_id: patient.id, file_type: "before_photo" },
              } as never)
            }
          />
          <QuickAction
            title="After photo"
            icon="images-outline"
            onPress={() =>
              router.push({
                pathname: "/patient/upload",
                params: { patient_id: patient.id, file_type: "after_photo" },
              } as never)
            }
          />
          <QuickAction
            title="Prescription"
            icon="document-text-outline"
            onPress={() =>
              router.push({
                pathname: "/patient/upload",
                params: { patient_id: patient.id, file_type: "prescription" },
              } as never)
            }
          />
          <QuickAction
            title="X-ray"
            icon="scan-outline"
            onPress={() =>
              router.push({
                pathname: "/patient/upload",
                params: { patient_id: patient.id, file_type: "xray" },
              } as never)
            }
          />
          <QuickAction
            title="Follow up"
            icon="logo-whatsapp"
            onPress={() =>
              openWhatsAppMessage(
                patient.phone,
                buildFollowupMessage(patient.name)
              )
            }
          />
          <QuickAction
            title="Due reminder"
            icon="logo-whatsapp"
            onPress={() =>
              openWhatsAppMessage(
                patient.phone,
                buildDueReminderMessage(patient.name, pendingDueAmount)
              )
            }
          />
        </View>
      </SectionCard>

      <SectionCard
        title="Clinical Images & Files"
        subtitle="Doctor can view files directly here and delete wrong/duplicate uploads."
      >
        <FileGroup
          title="Before Photos"
          files={groupedFiles.before_photo}
          empty="Before treatment photos will appear here."
          onOpen={openFile}
          onDelete={deleteFile}
          deletingFileId={deletingFileId}
        />

        <FileGroup
          title="After Photos"
          files={groupedFiles.after_photo}
          empty="After treatment photos will appear here."
          onOpen={openFile}
          onDelete={deleteFile}
          deletingFileId={deletingFileId}
        />

        <FileGroup
          title="Prescriptions"
          files={groupedFiles.prescription}
          empty="Prescription photos/PDFs will appear here."
          onOpen={openFile}
          onDelete={deleteFile}
          deletingFileId={deletingFileId}
        />

        <FileGroup
          title="X-rays"
          files={groupedFiles.xray}
          empty="X-rays will appear here."
          onOpen={openFile}
          onDelete={deleteFile}
          deletingFileId={deletingFileId}
        />

        {(groupedFiles.report.length || groupedFiles.other.length) ? (
          <>
            <FileGroup
              title="Reports"
              files={groupedFiles.report}
              empty="Reports will appear here."
              onOpen={openFile}
              onDelete={deleteFile}
              deletingFileId={deletingFileId}
            />

            <FileGroup
              title="Other Files"
              files={groupedFiles.other}
              empty="Other files will appear here."
              onOpen={openFile}
              onDelete={deleteFile}
              deletingFileId={deletingFileId}
            />
          </>
        ) : null}
      </SectionCard>

      <SectionCard title="Medical History Summary" subtitle="Check risk conditions before treatment. Keep this updated when patient reveals new information.">
        <AppButton
          title={history ? "Edit Medical History" : "Add Medical History"}
          icon="medkit-outline"
          variant="secondary"
          onPress={() =>
            router.push({
              pathname: "/patient/medical-history",
              params: { patient_id: patient.id },
            } as never)
          }
        />

        {history ? (
          <View style={{ gap: 10 }}>
            <RiskRow label="Heart issue" value={history.heart_issue} />
            <RiskRow label="Kidney issue" value={history.kidney_issue} />
            <RiskRow label="Brain issue" value={history.brain_issue} />
            <RiskRow label="Diabetes / sugar" value={history.diabetes} />
            <RiskRow label="Blood pressure / BP" value={history.blood_pressure} />

            <Text style={{ color: colors.muted }}>
              Allergies: <Text style={{ color: colors.text }}>{history.allergies || "None"}</Text>
            </Text>
            <Text style={{ color: colors.muted }}>
              Current medicines:{" "}
              <Text style={{ color: colors.text }}>{history.current_medicines || "None"}</Text>
            </Text>
            <Text style={{ color: colors.muted }}>
              Other notes: <Text style={{ color: colors.text }}>{history.other_notes || "None"}</Text>
            </Text>
          </View>
        ) : (
          <EmptyState
            title="No medical history"
            message="Add medical history from patient registration or edit flow."
            icon="medkit-outline"
          />
        )}
      </SectionCard>

      <SectionCard title="Patient Edit Audit" subtitle="Shows important patient detail changes for owner and staff accountability.">
        {auditLogs.length ? (
          <View style={{ gap: 10 }}>
            {auditLogs.slice(0, 8).map((log) => (
              <View
                key={log.id}
                style={{
                  backgroundColor: colors.background,
                  borderWidth: 1,
                  borderColor: colors.border,
                  borderRadius: 18,
                  padding: 12,
                  gap: 4,
                }}
              >
                <Text style={{ color: colors.text, fontWeight: "900" }}>
                  {log.field_name}
                </Text>
                <Text style={{ color: colors.muted }}>
                  {log.old_value || "Blank"} {"->"} {log.new_value || "Blank"}
                </Text>
                <Text style={{ color: colors.muted, fontSize: 12 }}>
                  {new Date(log.created_at).toLocaleString()}
                  {log.reason ? ` • ${log.reason}` : ""}
                </Text>
              </View>
            ))}
          </View>
        ) : (
          <EmptyState
            title="No edits recorded"
            message="Name, phone, age, gender, and address changes will appear here."
            icon="shield-checkmark-outline"
          />
        )}
      </SectionCard>

      <SectionCard title="Visits" subtitle="Past consultation history for this patient.">
        {visits.length ? (
          <View style={{ gap: 12 }}>
            {visits.map((visit) => (
              <View
                key={visit.id}
                style={{
                  backgroundColor: colors.background,
                  borderWidth: 1,
                  borderColor: colors.border,
                  borderRadius: 18,
                  padding: 14,
                  gap: 7,
                }}
              >
                <Text style={{ color: colors.text, fontWeight: "900", fontSize: 16 }}>
                  {new Date(visit.visit_date).toLocaleString()}
                </Text>
                {visit.chief_complaint ? (
                  <Text style={{ color: colors.muted }}>
                    Complaint: <Text style={{ color: colors.text }}>{visit.chief_complaint}</Text>
                  </Text>
                ) : null}
                {visit.diagnosis ? (
                  <Text style={{ color: colors.muted }}>
                    Diagnosis: <Text style={{ color: colors.text }}>{visit.diagnosis}</Text>
                  </Text>
                ) : null}
                {visit.doctor_notes ? (
                  <Text style={{ color: colors.muted }}>
                    Notes: <Text style={{ color: colors.text }}>{visit.doctor_notes}</Text>
                  </Text>
                ) : null}
              </View>
            ))}
          </View>
        ) : (
          <EmptyState
            title="No visits yet"
            message="Add the first visit after consultation."
            icon="clipboard-outline"
          />
        )}
      </SectionCard>

      <SectionCard title="Treatments & Billing" subtitle="Treatment charges, paid amount, due amount, and payment status.">
        {treatments.length || invoices.length ? (
          <View style={{ gap: 12 }}>
            {treatments.map((item) => (
              <View
                key={item.id}
                style={{
                  backgroundColor: colors.background,
                  borderWidth: 1,
                  borderColor: colors.border,
                  borderRadius: 18,
                  padding: 14,
                  gap: 6,
                }}
              >
                <Text style={{ color: colors.text, fontWeight: "900" }}>
                  {item.treatment_name}
                </Text>
                <Text style={{ color: colors.muted }}>₹{item.cost} • {item.status}</Text>
              </View>
            ))}

            {invoices.map((invoice) => (
              <View
                key={invoice.id}
                style={{
                  backgroundColor: colors.background,
                  borderWidth: 1,
                  borderColor: colors.border,
                  borderRadius: 18,
                  padding: 14,
                  gap: 6,
                }}
              >
                <Text style={{ color: colors.text, fontWeight: "900" }}>
                  Invoice ₹{invoice.total_amount}
                </Text>
                <Text style={{ color: colors.muted }}>
                  Paid ₹{invoice.paid_amount} • Due ₹{invoice.due_amount}
                </Text>
                <StatusBadge
                  label={invoice.status}
                  tone={invoice.status === "paid" ? "success" : invoice.status === "partial" ? "warning" : "danger"}
                />
              </View>
            ))}
          </View>
        ) : (
          <EmptyState
            title="No treatment billing yet"
            message="Treatment and invoice details will appear here."
            icon="cash-outline"
          />
        )}
      </SectionCard>

    </Screen>
  );
}

function QuickAction({
  title,
  icon,
  onPress,
}: {
  title: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        width: 132,
        minHeight: 100,
        borderRadius: 20,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: pressed ? colors.surfaceSoft : colors.surface,
        alignItems: "center",
        justifyContent: "center",
        gap: 10,
        padding: 10,
      })}
    >
      <View
        style={{
          width: 46,
          height: 46,
          borderRadius: 999,
          backgroundColor: colors.primarySoft,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Ionicons name={icon} size={23} color={colors.primary} />
      </View>
      <Text style={{ color: colors.text, fontSize: 13, fontWeight: "900", textAlign: "center" }}>
        {title}
      </Text>
    </Pressable>
  );
}

function FileGroup({
  title,
  files,
  empty,
  onOpen,
  onDelete,
  deletingFileId,
}: {
  title: string;
  files: PatientFile[];
  empty: string;
  onOpen: (file: PatientFile) => void;
  onDelete: (file: PatientFile) => void;
  deletingFileId: string | null;
}) {
  return (
    <View style={{ gap: 10 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Text style={{ color: colors.text, fontSize: 16, fontWeight: "900" }}>
          {title}
        </Text>
        <StatusBadge label={`${files.length}`} />
      </View>

      {files.length ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
          {files.map((file) => (
            <FileTile
              key={file.id}
              file={file}
              onOpen={() => onOpen(file)}
              onDelete={() => onDelete(file)}
              deleting={deletingFileId === file.id}
            />
          ))}
        </View>
      ) : (
        <Text style={{ color: colors.muted, fontSize: 13, lineHeight: 18 }}>
          {empty}
        </Text>
      )}
    </View>
  );
}

function FileTile({
  file,
  onOpen,
  onDelete,
  deleting,
}: {
  file: PatientFile;
  onOpen: () => void;
  onDelete: () => void;
  deleting: boolean;
}) {
  const isImage =
    /\.(png|jpe?g|webp|gif)$/i.test(file.file_url) ||
    /\.(png|jpe?g|webp|gif)$/i.test(file.file_name) ||
    imageTypes.includes(file.file_type);

  return (
    <View
      style={{
        width: 168,
        borderRadius: 20,
        backgroundColor: colors.background,
        borderWidth: 1,
        borderColor: colors.border,
        overflow: "hidden",
      }}
    >
      <Pressable onPress={onOpen}>
        {isImage ? (
          <SecureStorageImage
            uri={file.file_url}
            style={{ width: "100%", height: 132, backgroundColor: colors.surfaceSoft }}
            contentFit="cover"
          />
        ) : (
          <View
            style={{
              width: "100%",
              height: 132,
              backgroundColor: colors.surfaceSoft,
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
            }}
          >
            <Ionicons name="document-text-outline" size={36} color={colors.primary} />
            <Text style={{ color: colors.primary, fontWeight: "900" }}>Open file</Text>
          </View>
        )}
      </Pressable>

      <View style={{ padding: 10, gap: 8 }}>
        <Text numberOfLines={1} style={{ color: colors.text, fontWeight: "900" }}>
          {file.file_name}
        </Text>

        <Text style={{ color: colors.muted, fontSize: 12 }}>
          {new Date(file.created_at).toLocaleDateString()}
        </Text>

        <View style={{ flexDirection: "row", gap: 8 }}>
          <Pressable
            onPress={onOpen}
            style={{
              flex: 1,
              minHeight: 36,
              borderRadius: 12,
              backgroundColor: colors.primarySoft,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Text style={{ color: colors.primaryDark, fontWeight: "900", fontSize: 12 }}>
              View
            </Text>
          </Pressable>

          <Pressable
            onPress={onDelete}
            disabled={deleting}
            style={{
              flex: 1,
              minHeight: 36,
              borderRadius: 12,
              backgroundColor: colors.dangerSoft,
              alignItems: "center",
              justifyContent: "center",
              opacity: deleting ? 0.5 : 1,
            }}
          >
            <Text style={{ color: colors.danger, fontWeight: "900", fontSize: 12 }}>
              {deleting ? "Deleting" : "Delete"}
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

function RiskRow({ label, value }: { label: string; value: boolean }) {
  return (
    <Text style={{ color: colors.muted }}>
      {label}:{" "}
      <Text style={{ color: value ? colors.danger : colors.success, fontWeight: "900" }}>
        {value ? "Yes" : "No"}
      </Text>
    </Text>
  );
}
