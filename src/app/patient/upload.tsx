import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  DimensionValue,
  Image,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { AppButton } from "@/components/AppButton";
import { AppInput } from "@/components/AppInput";
import { EmptyState } from "@/components/EmptyState";
import { Screen } from "@/components/Screen";
import { SectionCard } from "@/components/SectionCard";
import { StatusBadge } from "@/components/StatusBadge";
import { colors } from "@/constants/colors";
import { searchPatientsPage } from "@/lib/patientDirectory";
import {
  getCapDentEntitlementsV25,
  uploadQuotaMessage,
  type CapDentEntitlementsV25,
} from "@/lib/pricingV25";
import {
  FileType,
  Patient,
  supabase,
  UploadProgressState,
  uploadPatientFile,
} from "@/lib/supabase";
import { CAPDENT_V25_LIMITS, formatStorageBytes } from "@/lib/v25Limits";

type UploadType = FileType;

const FILE_TYPES: {
  key: UploadType;
  label: string;
  bucket: "prescriptions" | "xrays" | "patient-files";
  icon: keyof typeof Ionicons.glyphMap;
}[] = [
  { key: "xray", label: "X-ray", bucket: "xrays", icon: "scan-outline" },
  { key: "prescription", label: "Prescription", bucket: "prescriptions", icon: "document-text-outline" },
  { key: "before_photo", label: "Before Photo", bucket: "patient-files", icon: "camera-outline" },
  { key: "after_photo", label: "After Photo", bucket: "patient-files", icon: "images-outline" },
  { key: "report", label: "Report", bucket: "patient-files", icon: "reader-outline" },
  { key: "other", label: "Other", bucket: "patient-files", icon: "folder-outline" },
];

function getConfig(type: UploadType) {
  return FILE_TYPES.find((item) => item.key === type) || FILE_TYPES[0];
}

function getDefaultFileName(type: UploadType, uri?: string) {
  const extension = uri?.split(".").pop()?.split("?")[0] || "jpg";
  const safeExtension = extension.length <= 5 ? extension : "jpg";
  return `${type}-${Date.now()}.${safeExtension}`;
}

function getErrorMessage(error: unknown) {
  if (!error) return "Unknown error";
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;

  if (typeof error === "object") {
    const err = error as { message?: string; details?: string; hint?: string; code?: string };
    return [
      err.message,
      err.details ? `Details: ${err.details}` : "",
      err.hint ? `Hint: ${err.hint}` : "",
      err.code ? `Code: ${err.code}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  }

  return "Unknown error";
}

function formatBytes(value?: number) {
  if (!value || value <= 0) return "0 KB";
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function UploadProgressPanel({ progress }: { progress: UploadProgressState }) {
  const percent = Math.max(0, Math.min(100, progress.percent));
  const barWidth = `${Math.max(4, percent)}%` as DimensionValue;

  return (
    <View
      style={{
        borderRadius: 22,
        padding: 14,
        gap: 12,
        backgroundColor: progress.phase === "complete" ? colors.successSoft : colors.infoSoft,
        borderWidth: 1,
        borderColor: progress.phase === "complete" ? colors.success : colors.border,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <View
          style={{
            width: 42,
            height: 42,
            borderRadius: 15,
            backgroundColor: progress.phase === "complete" ? colors.success : colors.primary,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Ionicons
            name={progress.phase === "complete" ? "checkmark-outline" : "cloud-upload-outline"}
            size={21}
            color={colors.white}
          />
        </View>

        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.text, fontSize: 16, fontWeight: "900" }}>
            {progress.message}
          </Text>
          <Text style={{ color: colors.muted, marginTop: 2, fontVariant: ["tabular-nums"] }}>
            {formatBytes(progress.bytesSent)} of {formatBytes(progress.totalBytes)}
          </Text>
        </View>

        <Text style={{ color: colors.text, fontSize: 22, fontWeight: "900", fontVariant: ["tabular-nums"] }}>
          {percent}%
        </Text>
      </View>

      <View
        style={{
          height: 10,
          borderRadius: 999,
          backgroundColor: colors.white,
          overflow: "hidden",
          borderWidth: 1,
          borderColor: colors.border,
        }}
      >
        <View
          style={{
            width: barWidth,
            height: "100%",
            borderRadius: 999,
            backgroundColor: progress.phase === "complete" ? colors.success : colors.primary,
          }}
        />
      </View>
    </View>
  );
}

export default function ClinicalUploadScreen() {
  const params = useLocalSearchParams<{
    patient_id?: string;
    file_type?: string;
  }>();

  const incomingPatientId =
    typeof params.patient_id === "string" ? params.patient_id : "";

  const incomingType =
    FILE_TYPES.some((item) => item.key === params.file_type)
      ? (params.file_type as UploadType)
      : "xray";

  const [patients, setPatients] = useState<Patient[]>([]);
  const [patientSearch, setPatientSearch] = useState("");
  const [selectedPatientId, setSelectedPatientId] = useState(incomingPatientId);
  const [type, setType] = useState<UploadType>(incomingType);
  const [fileNote, setFileNote] = useState("");
  const [xrayAmount, setXrayAmount] = useState("");
  const [xrayFeeStatus, setXrayFeeStatus] = useState<"not_applicable" | "pending" | "paid" | "waived">("not_applicable");
  const [asset, setAsset] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [loadingPatients, setLoadingPatients] = useState(true);
  const [entitlements, setEntitlements] = useState<CapDentEntitlementsV25 | null>(null);
  const [loadingEntitlements, setLoadingEntitlements] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<UploadProgressState | null>(null);
  const [done, setDone] = useState(false);
  const patientRequestRef = useRef(0);
  const patientSearchMountedRef = useRef(false);
  const uploadLockRef = useRef(false);

  const config = getConfig(type);

  async function loadPatients(searchText = patientSearch) {
    const requestId = patientRequestRef.current + 1;
    patientRequestRef.current = requestId;

    try {
      setLoadingPatients(true);
      const result = await searchPatientsPage({
        query: searchText,
        page: 1,
        pageSize: 12,
      });
      let rows = result.patients;

      if (incomingPatientId && !rows.some((patient) => patient.id === incomingPatientId)) {
        const { data, error } = await supabase
          .from("patients")
          .select("*")
          .eq("id", incomingPatientId)
          .maybeSingle<Patient>();

        if (error) throw error;
        if (data) rows = [data, ...rows];
      }

      if (requestId === patientRequestRef.current) {
        setPatients(rows);

        if (incomingPatientId && rows.some((patient) => patient.id === incomingPatientId)) {
          setSelectedPatientId(incomingPatientId);
        }
      }
    } catch (error) {
      Alert.alert("Patients load failed", getErrorMessage(error));
    } finally {
      if (requestId === patientRequestRef.current) setLoadingPatients(false);
    }
  }

  async function loadEntitlements() {
    try {
      setLoadingEntitlements(true);
      setEntitlements(await getCapDentEntitlementsV25());
    } catch (error) {
      console.warn("Upload capacity load failed:", error);
    } finally {
      setLoadingEntitlements(false);
    }
  }

  useEffect(() => {
    void loadPatients("");
    void loadEntitlements();
  }, [incomingPatientId]);

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

  function goBack() {
    if (router.canGoBack()) {
      router.back();
      return;
    }

    if (selectedPatientId) {
      router.replace(`/patient/${selectedPatientId}` as never);
      return;
    }

    router.replace("/gallery" as never);
  }

  const filteredPatients = patients;
  const hasLiveEntitlements = Boolean(entitlements?.clinicId);
  const uploadLimit = entitlements?.uploadLimit ?? null;
  const uploadCount = entitlements?.uploadCount ?? 0;
  const uploadBlocked = hasLiveEntitlements && entitlements?.canUpload === false;
  const uploadWarning =
    hasLiveEntitlements &&
    entitlements?.plan === "free" &&
    uploadLimit !== null &&
    uploadCount >= CAPDENT_V25_LIMITS.free.uploadWarningAt &&
    uploadCount < uploadLimit &&
    entitlements?.canUpload !== false;
  const storageBlocked =
    hasLiveEntitlements &&
    entitlements?.storageLimitEnforced === true &&
    entitlements.storageUsedBytes >= entitlements.storageLimitBytes;
  const uploadCountBlocked =
    hasLiveEntitlements &&
    entitlements?.uploadLimitEnforced === true &&
    uploadLimit !== null &&
    uploadCount >= uploadLimit;
  const uploadUsageText = !hasLiveEntitlements
    ? "Upload availability will be checked again before saving."
    : uploadLimit === null
      ? `${uploadCount} uploads • Unlimited upload count`
      : `${uploadCount} of ${uploadLimit} uploads used`;
  const storageUsageText = hasLiveEntitlements && entitlements
    ? `${formatStorageBytes(entitlements.storageUsedBytes)} of ${formatStorageBytes(entitlements.storageLimitBytes)} storage used`
    : null;

  async function pickFromCamera() {
    if (uploadBlocked) {
      Alert.alert(
        "Upload capacity reached",
        storageBlocked
          ? "This clinic has reached its storage capacity. View plans before adding another clinical file."
          : "This clinic has reached its upload capacity. View plans before adding another clinical file.",
        [
          { text: "Cancel", style: "cancel" },
          { text: "View Plans", onPress: () => router.push("/settings/subscription" as never) },
        ]
      );
      return;
    }

    const permission = await ImagePicker.requestCameraPermissionsAsync();

    if (!permission.granted) {
      Alert.alert("Camera permission needed", "Allow camera permission to take photos.");
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      quality: 1,
      allowsEditing: false,
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
    });

    if (!result.canceled && result.assets[0]) {
      setAsset(result.assets[0]);
      setDone(false);
      setUploadProgress(null);
    }
  }

  async function pickFromGallery() {
    if (uploadBlocked) {
      Alert.alert(
        "Upload capacity reached",
        storageBlocked
          ? "This clinic has reached its storage capacity. View plans before adding another clinical file."
          : "This clinic has reached its upload capacity. View plans before adding another clinical file.",
        [
          { text: "Cancel", style: "cancel" },
          { text: "View Plans", onPress: () => router.push("/settings/subscription" as never) },
        ]
      );
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      quality: 1,
      allowsEditing: false,
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
    });

    if (!result.canceled && result.assets[0]) {
      setAsset(result.assets[0]);
      setDone(false);
      setUploadProgress(null);
    }
  }

  async function upload() {
    if (uploading || uploadLockRef.current) return;

    if (!selectedPatientId) {
      Alert.alert("Patient missing", "Select patient first.");
      return;
    }

    if (!asset?.uri) {
      Alert.alert("File missing", "Take photo or choose from gallery first.");
      return;
    }

    uploadLockRef.current = true;
    setDone(false);
    setUploading(true);
    setUploadProgress({
      phase: "preparing",
      percent: 0,
      message: "Checking clinic upload limits",
    });

    const fileName = getDefaultFileName(type, asset.uri);
    const billingRequested =
      type === "xray" &&
      Number(xrayAmount || 0) > 0 &&
      xrayFeeStatus !== "waived";

    try {
      const latestEntitlements = await getCapDentEntitlementsV25();
      setEntitlements(latestEntitlements);
      const quotaMessage = uploadQuotaMessage(latestEntitlements);

      if (quotaMessage) {
        setUploadProgress(null);
        Alert.alert("Upload limit reached", quotaMessage, [
          { text: "Cancel", style: "cancel" },
          {
            text: "View Plans",
            onPress: () => router.push("/settings/subscription" as never),
          },
        ]);
        return;
      }

      setUploadProgress({
        phase: "preparing",
        percent: 0,
        message: "Preparing selected file",
      });

      await uploadPatientFile({
        patient_id: selectedPatientId,
        file_type: type,
        bucket: config.bucket,
        uri: asset.uri,
        file_name: fileName,
        mimeType: asset.mimeType ?? "image/jpeg",
        file_note: fileNote.trim() || null,
        xray_amount: type === "xray" ? Number(xrayAmount || 0) : 0,
        xray_fee_status: type === "xray" ? xrayFeeStatus : "not_applicable",
        onProgress: setUploadProgress,
      });

      setDone(true);
      void loadEntitlements();

      Alert.alert("Upload complete", `${config.label} saved to patient gallery.`, [
        {
          text: "Open Gallery",
          onPress: () =>
            router.replace({
              pathname: "/gallery",
              params: { patient_id: selectedPatientId },
            } as never),
        },
        {
          text: "Open Patient",
          onPress: () => router.replace(`/patient/${selectedPatientId}` as never),
        },
        {
          text: "Upload Another",
          onPress: () => {
            setAsset(null);
            setDone(false);
            setUploadProgress(null);
          },
        },
      ]);
    } catch (error) {
      const message = getErrorMessage(error);

      if (billingRequested) {
        const storedFileName = fileName.replace(/\.[^.]+$/, ".webp");

        try {
          const { data: persistedFile, error: verificationError } = await supabase
            .from("files")
            .select("id")
            .eq("patient_id", selectedPatientId)
            .eq("file_type", "xray")
            .eq("file_name", storedFileName)
            .limit(1)
            .maybeSingle<{ id: string }>();

          if (verificationError) throw verificationError;

          if (persistedFile) {
            setDone(true);
            void loadEntitlements();
            setUploadProgress((current) => ({
              phase: "complete",
              percent: 100,
              bytesSent: current?.bytesSent,
              totalBytes: current?.totalBytes,
              message: "X-ray saved; billing needs review",
            }));
            Alert.alert(
              "X-ray saved; billing needs attention",
              `The X-ray is already saved in the patient gallery. Do not upload it again. Its billing record may be missing or incomplete and should be reviewed before collecting payment.\n\nBilling error: ${message}`,
              [
                {
                  text: "Open Gallery",
                  onPress: () =>
                    router.replace({
                      pathname: "/gallery",
                      params: { patient_id: selectedPatientId },
                    } as never),
                },
                {
                  text: "Open Patient",
                  onPress: () => router.replace(`/patient/${selectedPatientId}` as never),
                },
              ]
            );
            return;
          }
        } catch (verificationError) {
          console.warn(
            "Unable to verify whether the X-ray file persisted after billing failed:",
            verificationError
          );
        }
      }

      setUploadProgress((current) =>
        current
          ? {
              ...current,
              message: `Upload failed: ${message.slice(0, 120)}`,
            }
          : null
      );
      Alert.alert("Upload failed", message);
    } finally {
      uploadLockRef.current = false;
      setUploading(false);
    }
  }

  return (
    <Screen
      refreshing={loadingPatients || loadingEntitlements}
      onRefresh={() => {
        void loadPatients();
        void loadEntitlements();
      }}
    >
      <View style={{ gap: 6 }}>
        <Text style={{ color: colors.text, fontSize: 30, fontWeight: "900" }}>
          Upload File
        </Text>

        <Text style={{ color: colors.muted, fontSize: 15, lineHeight: 21 }}>
          Capture or upload clinical files to the correct patient record. Use camera for prescriptions, X-rays, and before/after photos.
        </Text>
      </View>

      <SectionCard
        title="Plan & Upload Capacity"
        subtitle={
          hasLiveEntitlements && entitlements
            ? `${entitlements.planLabel} plan • ${uploadUsageText}`
            : "CapDent checks clinic upload and storage capacity before every clinical file."
        }
      >
        {loadingEntitlements ? (
          <Text style={{ color: colors.muted }}>Checking upload capacity...</Text>
        ) : hasLiveEntitlements && entitlements ? (
          <View style={{ gap: 10 }}>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              <StatusBadge
                label={uploadLimit === null ? `${uploadCount} uploads` : `${uploadCount} / ${uploadLimit} uploads`}
                tone={uploadBlocked ? "warning" : "success"}
              />
              <StatusBadge
                label={formatStorageBytes(entitlements.storageUsedBytes)}
                tone={storageBlocked ? "warning" : "primary"}
              />
            </View>

            <Text style={{ color: colors.text, fontWeight: "900", fontSize: 17 }}>
              {uploadUsageText}
            </Text>
            <Text style={{ color: colors.muted, lineHeight: 20 }}>
              {storageUsageText}
            </Text>

            {uploadBlocked ? (
              <>
                <Text style={{ color: colors.danger, lineHeight: 20, fontWeight: "700" }}>
                  {storageBlocked
                    ? "Storage capacity has been reached. Existing files remain available, but another clinical file cannot be added on the current plan."
                    : uploadCountBlocked
                      ? "Upload capacity has been reached. Existing files remain available, but another clinical file cannot be added on the current plan."
                      : "Clinical uploads are unavailable under the current plan."}
                </Text>
                <AppButton
                  title="View Plans"
                  icon="card-outline"
                  variant="secondary"
                  onPress={() => router.push("/settings/subscription" as never)}
                />
              </>
            ) : uploadWarning ? (
              <Text style={{ color: colors.warning, lineHeight: 20, fontWeight: "700" }}>
                {Math.max((uploadLimit ?? 0) - uploadCount, 0)} uploads remaining. Free-plan upload capacity is running low; upgrade before reaching {uploadLimit} uploads.
              </Text>
            ) : (
              <Text style={{ color: colors.muted, lineHeight: 20 }}>
                Uploads are available. CapDent will verify capacity again immediately before saving the file.
              </Text>
            )}
          </View>
        ) : (
          <Text style={{ color: colors.muted, lineHeight: 20 }}>
            Live usage is temporarily unavailable. Upload remains fail-safe and the server will verify the clinic allowance immediately before saving.
          </Text>
        )}
      </SectionCard>

      <SectionCard title="Select Patient" subtitle="Confirm the correct patient before saving any clinical file.">
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
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <Ionicons name="person-circle-outline" size={28} color={colors.primary} />

              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.text, fontSize: 17, fontWeight: "900" }}>
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
                style={{ flex: 1, minHeight: 54, color: colors.text, fontSize: 16 }}
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
                      backgroundColor: pressed ? colors.surfaceSoft : colors.background,
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
                      <Ionicons name="person-outline" size={21} color={colors.primary} />
                    </View>

                    <View style={{ flex: 1 }}>
                      <Text style={{ color: colors.text, fontWeight: "900" }}>
                        {patient.name}
                      </Text>
                      <Text style={{ color: colors.muted, marginTop: 2 }}>
                        {patient.phone || "No phone"}
                      </Text>
                    </View>

                    <Ionicons name="chevron-forward" size={18} color={colors.muted} />
                  </Pressable>
                ))}
              </View>
            ) : (
              <EmptyState
                title="No patients found"
                message="Register or check-in patient first, then upload files."
                icon="search-outline"
              />
            )}
          </View>
        )}
      </SectionCard>

      <SectionCard title="File Type" subtitle="Choose the correct category so files appear in the right section of patient history.">
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
          {FILE_TYPES.map((item) => {
            const selected = type === item.key;

            return (
              <Pressable
                key={item.key}
                onPress={() => {
                  setType(item.key);
                  setDone(false);
                  if (item.key !== "xray") {
                    setXrayAmount("");
                    setXrayFeeStatus("not_applicable");
                  }
                }}
                style={{
                  width: "47%",
                  minHeight: 84,
                  borderRadius: 20,
                  borderWidth: 1,
                  borderColor: selected ? colors.primary : colors.border,
                  backgroundColor: selected ? colors.primary : colors.background,
                  padding: 12,
                  justifyContent: "space-between",
                }}
              >
                <Ionicons
                  name={item.icon}
                  size={23}
                  color={selected ? colors.white : colors.primary}
                />

                <Text
                  style={{
                    color: selected ? colors.white : colors.text,
                    fontWeight: "900",
                    marginTop: 8,
                  }}
                >
                  {item.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </SectionCard>

      <SectionCard title={type === "xray" ? "X-ray Details" : "File Details"} subtitle="Add a short note only when it helps the doctor understand this file later.">
        <AppInput
          label={type === "xray" ? "X-ray type / note" : "File note"}
          value={fileNote}
          onChangeText={setFileNote}
          placeholder={type === "xray" ? "Example: IOPA, OPG, RVG..." : "Optional note"}
          multiline
        />

        {type === "xray" ? (
          <>
            <AppInput
              label="X-ray amount optional"
              value={xrayAmount}
              onChangeText={setXrayAmount}
              keyboardType="numeric"
              placeholder="Example: 500"
              helper="If entered, CapDent creates a separate X-ray fee invoice."
            />

            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {(["not_applicable", "pending", "paid", "waived"] as const).map((status) => {
                const selected = xrayFeeStatus === status;
                const label = status === "not_applicable" ? "No fee" : status[0].toUpperCase() + status.slice(1);

                return (
                  <Pressable
                    key={status}
                    onPress={() => setXrayFeeStatus(status)}
                    style={{
                      minHeight: 40,
                      borderRadius: 999,
                      paddingHorizontal: 12,
                      borderWidth: 1,
                      borderColor: selected ? colors.primary : colors.border,
                      backgroundColor: selected ? colors.primary : colors.background,
                      justifyContent: "center",
                    }}
                  >
                    <Text style={{ color: selected ? colors.white : colors.text, fontWeight: "900", fontSize: 12 }}>
                      {label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </>
        ) : null}
      </SectionCard>

      <SectionCard title="Choose Image" subtitle="Take a fresh photo or choose an existing image, then upload it to patient history.">
        <View style={{ flexDirection: "row", gap: 10 }}>
          <AppButton
            title={uploadBlocked ? "Upload Locked" : "Camera"}
            icon={uploadBlocked ? "lock-closed-outline" : "camera-outline"}
            onPress={pickFromCamera}
            disabled={uploadBlocked}
            style={{ flex: 1 }}
          />

          <AppButton
            title={uploadBlocked ? "Upload Locked" : "Gallery"}
            icon={uploadBlocked ? "lock-closed-outline" : "images-outline"}
            variant="secondary"
            onPress={pickFromGallery}
            disabled={uploadBlocked}
            style={{ flex: 1 }}
          />
        </View>

        {asset?.uri ? (
          <View style={{ gap: 12 }}>
            <View
              style={{
                borderRadius: 26,
                overflow: "hidden",
                backgroundColor: colors.surfaceSoft,
                borderWidth: 1,
                borderColor: colors.border,
              }}
            >
              <Image
                source={{ uri: asset.uri }}
                style={{
                  width: "100%",
                  height: 280,
                  backgroundColor: colors.surfaceSoft,
                }}
                resizeMode="cover"
              />

              <View
                style={{
                  padding: 12,
                  gap: 10,
                  backgroundColor: colors.surface,
                }}
              >
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <View
                    style={{
                      width: 42,
                      height: 42,
                      borderRadius: 15,
                      backgroundColor: colors.primarySoft,
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Ionicons name={config.icon} size={21} color={colors.primary} />
                  </View>

                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.text, fontWeight: "900", fontSize: 16 }}>
                      {config.label} ready
                    </Text>
                    <Text style={{ color: colors.muted, marginTop: 2 }}>
                      {asset.fileName || getDefaultFileName(type, asset.uri)}
                    </Text>
                  </View>

                  <StatusBadge
                    label={done ? "Uploaded" : uploading ? "Uploading" : "Ready"}
                    tone={done ? "success" : uploading ? "warning" : "success"}
                  />
                </View>
              </View>
            </View>

            {uploadProgress ? <UploadProgressPanel progress={uploadProgress} /> : null}
          </View>
        ) : (
          <EmptyState
            title={uploadBlocked ? "Upload capacity reached" : "No image selected"}
            message={uploadBlocked ? "View plans to add another clinical file." : "Take photo or choose from gallery."}
            icon={uploadBlocked ? "lock-closed-outline" : "image-outline"}
          />
        )}

        <AppButton
          title={
            uploadBlocked
              ? "Upload Limit Reached"
              : done
                ? `${config.label} Uploaded`
                : uploading
                  ? `Uploading ${uploadProgress?.percent ?? 0}%`
                  : `Upload ${config.label}`
          }
          icon={uploadBlocked ? "lock-closed-outline" : "cloud-upload-outline"}
          onPress={upload}
          loading={uploading}
          disabled={uploadBlocked || uploading || done}
        />
      </SectionCard>

      <AppButton
        title="Back"
        icon="arrow-back-outline"
        variant="ghost"
        onPress={goBack}
      />
    </Screen>
  );
}
