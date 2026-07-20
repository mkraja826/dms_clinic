import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { AppButton } from "@/components/AppButton";
import { EmptyState } from "@/components/EmptyState";
import { SecureStorageImage } from "@/components/SecureStorageImage";
import { Screen } from "@/components/Screen";
import { SectionCard } from "@/components/SectionCard";
import { StatusBadge } from "@/components/StatusBadge";
import { colors } from "@/constants/colors";
import { deletePatientFileRecord, supabase } from "@/lib/supabase";
import { resolveStorageUrls } from "@/lib/storageUrls";

type FileType =
  | "all"
  | "before_photo"
  | "after_photo"
  | "xray"
  | "prescription"
  | "report"
  | "other";

type PatientMini = {
  id: string;
  name: string;
  phone?: string | null;
};

type GalleryFile = {
  id: string;
  patient_id: string;
  file_type: Exclude<FileType, "all">;
  file_url: string;
  file_name?: string | null;
  created_at: string;
  patients?: PatientMini | null;
};

const FILTERS: { key: FileType; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: "all", label: "All", icon: "grid-outline" },
  { key: "xray", label: "X-rays", icon: "scan-outline" },
  { key: "prescription", label: "Rx", icon: "document-text-outline" },
  { key: "before_photo", label: "Before", icon: "camera-outline" },
  { key: "after_photo", label: "After", icon: "images-outline" },
  { key: "report", label: "Reports", icon: "reader-outline" },
  { key: "other", label: "Other", icon: "folder-outline" },
];

function fileTypeLabel(type?: string | null) {
  switch (type) {
    case "before_photo":
      return "Before";
    case "after_photo":
      return "After";
    case "xray":
      return "X-ray";
    case "prescription":
      return "Prescription";
    case "report":
      return "Report";
    default:
      return "Other";
  }
}

function getFileIcon(type?: string | null): keyof typeof Ionicons.glyphMap {
  switch (type) {
    case "before_photo":
      return "camera-outline";
    case "after_photo":
      return "images-outline";
    case "xray":
      return "scan-outline";
    case "prescription":
      return "document-text-outline";
    case "report":
      return "reader-outline";
    default:
      return "folder-outline";
  }
}

function isLikelyImage(url?: string | null) {
  if (!url) return false;
  const clean = url.toLowerCase().split("?")[0];
  return (
    clean.endsWith(".jpg") ||
    clean.endsWith(".jpeg") ||
    clean.endsWith(".png") ||
    clean.endsWith(".webp") ||
    clean.endsWith(".heic") ||
    clean.includes("/object/public/")
  );
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
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
      err.details ? `Details: ${err.details}` : "",
      err.hint ? `Hint: ${err.hint}` : "",
      err.code ? `Code: ${err.code}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  }

  return "Unknown error";
}

export default function GalleryScreen() {
  const params = useLocalSearchParams<{ patient_id?: string }>();
  const patientId = typeof params.patient_id === "string" ? params.patient_id : "";

  const [files, setFiles] = useState<GalleryFile[]>([]);
  const [filter, setFilter] = useState<FileType>("all");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  async function load() {
    try {
      setLoading(true);

      let query = supabase
        .from("files")
        .select("id,patient_id,file_type,file_url,file_name,created_at,patients(id,name,phone)")
        .order("created_at", { ascending: false })
        .limit(250);

      if (patientId) {
        query = query.eq("patient_id", patientId);
      }

      const { data, error } = await query;

      if (error) throw error;

      const rows = (data || []) as unknown as GalleryFile[];
      const signedUrls = await resolveStorageUrls(rows.map((row) => row.file_url));
      setFiles(
        rows.map((row) => ({
          ...row,
          file_url: signedUrls.get(row.file_url) ?? row.file_url,
        }))
      );
    } catch (error) {
      Alert.alert("Gallery load failed", getErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [patientId]);

  const visibleFiles = useMemo(() => {
    const term = search.trim().toLowerCase();

    return files.filter((file) => {
      const typeMatch = filter === "all" || file.file_type === filter;

      const searchMatch =
        !term ||
        (file.file_name || "").toLowerCase().includes(term) ||
        fileTypeLabel(file.file_type).toLowerCase().includes(term) ||
        (file.patients?.name || "").toLowerCase().includes(term) ||
        (file.patients?.phone || "").toLowerCase().includes(term);

      return typeMatch && searchMatch;
    });
  }, [files, filter, search]);

  function openFile(file: GalleryFile) {
    router.push({
      pathname: "/image-viewer",
      params: {
        url: file.file_url,
        name: file.file_name || fileTypeLabel(file.file_type),
        type: isLikelyImage(file.file_url) ? "image/jpeg" : file.file_type,
      },
    } as never);
  }

  async function deleteFile(file: GalleryFile) {
    const performDelete = async () => {
      try {
        await deletePatientFileRecord(file.id);

        await load();
      } catch (error) {
        Alert.alert("Delete failed", getErrorMessage(error));
      }
    };

    if (Platform.OS === "web") {
      const confirmed = globalThis.confirm?.(
        "Delete file?\n\nThis removes this file from patient gallery."
      );
      if (confirmed) await performDelete();
      return;
    }

    Alert.alert(
      "Delete file?",
      "This removes this file from patient gallery. Use only for wrong or duplicate uploads.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: performDelete },
      ]
    );
  }

  const title = patientId ? "Patient Gallery" : "Clinic Gallery";

  return (
    <Screen refreshing={loading} onRefresh={load}>
      <View style={{ gap: 6 }}>
        <Text style={{ color: colors.text, fontSize: 30, fontWeight: "900" }}>
          {title}
        </Text>

        <Text style={{ color: colors.muted, fontSize: 15, lineHeight: 21 }}>
          Review clinical files across patients. Filter X-rays, prescriptions, reports, and before/after photos quickly.
        </Text>
      </View>

      <SectionCard title="Search & Filter">
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
            value={search}
            onChangeText={setSearch}
            placeholder="Search patient, phone, file name..."
            placeholderTextColor={colors.muted}
            style={{
              flex: 1,
              minHeight: 54,
              color: colors.text,
              fontSize: 16,
            }}
          />
        </View>

        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {FILTERS.map((item) => {
            const selected = filter === item.key;

            return (
              <Pressable
                key={item.key}
                onPress={() => setFilter(item.key)}
                style={{
                  minHeight: 42,
                  borderRadius: 999,
                  paddingHorizontal: 12,
                  borderWidth: 1,
                  borderColor: selected ? colors.primary : colors.border,
                  backgroundColor: selected ? colors.primary : colors.background,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <Ionicons
                  name={item.icon}
                  size={16}
                  color={selected ? colors.white : colors.primary}
                />
                <Text
                  style={{
                    color: selected ? colors.white : colors.text,
                    fontWeight: "900",
                    fontSize: 13,
                  }}
                >
                  {item.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          <StatusBadge label={`${visibleFiles.length} showing`} />
          <StatusBadge label={`${files.length} total`} tone="success" />
        </View>
      </SectionCard>

      <SectionCard title="Files" subtitle="Tap any file to view. Open patient profile to continue treatment or review history.">
        {loading ? (
          <Text style={{ color: colors.muted }}>Loading gallery...</Text>
        ) : visibleFiles.length ? (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
            {visibleFiles.map((file) => (
              <GalleryTile
                key={file.id}
                file={file}
                onOpen={() => openFile(file)}
                onDelete={() => deleteFile(file)}
              />
            ))}
          </View>
        ) : (
          <EmptyState
            title="No files found"
            message="Upload X-rays, prescriptions or photos from patient profile or doctor upload screen."
            icon="images-outline"
          />
        )}
      </SectionCard>

      <View style={{ flexDirection: "row", gap: 10 }}>
        <AppButton
          title="Refresh"
          icon="refresh-outline"
          variant="secondary"
          onPress={load}
          loading={loading}
          style={{ flex: 1 }}
        />

        <AppButton
          title="Upload"
          icon="cloud-upload-outline"
          onPress={() =>
            router.push(
              patientId
                ? ({
                    pathname: "/patient/upload",
                    params: { patient_id: patientId },
                  } as never)
                : ("/patient/upload" as never)
            )
          }
          style={{ flex: 1 }}
        />
      </View>
    </Screen>
  );
}

function GalleryTile({
  file,
  onOpen,
  onDelete,
}: {
  file: GalleryFile;
  onOpen: () => void;
  onDelete: () => void;
}) {
  return (
    <View
      style={{
        width: "47%",
        borderRadius: 22,
        backgroundColor: colors.background,
        borderWidth: 1,
        borderColor: colors.border,
        overflow: "hidden",
      }}
    >
      <Pressable onPress={onOpen}>
        <View
          style={{
            height: 138,
            backgroundColor: colors.surfaceSoft,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {isLikelyImage(file.file_url) ? (
            <SecureStorageImage
              uri={file.file_url}
              style={{ width: "100%", height: "100%" }}
              contentFit="cover"
            />
          ) : (
            <Ionicons name={getFileIcon(file.file_type)} size={42} color={colors.primary} />
          )}
        </View>

        <View style={{ padding: 10, gap: 5 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Ionicons name={getFileIcon(file.file_type)} size={15} color={colors.primary} />
            <Text
              numberOfLines={1}
              style={{ color: colors.text, fontWeight: "900", flex: 1 }}
            >
              {fileTypeLabel(file.file_type)}
            </Text>
          </View>

          <Text numberOfLines={1} style={{ color: colors.muted, fontSize: 12 }}>
            {file.patients?.name || "Patient"}
          </Text>

          <Text numberOfLines={1} style={{ color: colors.muted, fontSize: 11 }}>
            {formatDate(file.created_at)}
          </Text>
        </View>
      </Pressable>

      <View
        style={{
          flexDirection: "row",
          borderTopWidth: 1,
          borderTopColor: colors.border,
        }}
      >
        <Pressable
          onPress={() => router.push(`/patient/${file.patient_id}` as never)}
          style={{
            flex: 1,
            minHeight: 42,
            alignItems: "center",
            justifyContent: "center",
            borderRightWidth: 1,
            borderRightColor: colors.border,
          }}
        >
          <Text style={{ color: colors.primary, fontWeight: "900", fontSize: 12 }}>
            Patient
          </Text>
        </Pressable>

        <Pressable
          onPress={onDelete}
          style={{
            flex: 1,
            minHeight: 42,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text style={{ color: colors.danger, fontWeight: "900", fontSize: 12 }}>
            Delete
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
