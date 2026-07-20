import * as FileSystem from "expo-file-system/legacy";
import { optimizeUploadImage } from "@/lib/imageCompression";
import { parseStorageObjectUrl } from "@/lib/storageUrls";
import { getCurrentProfile, supabase } from "@/lib/supabase";

function base64ToUint8Array(base64: string) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const clean = base64.replace(/=+$/, "");
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;

  for (const char of clean) {
    const value = chars.indexOf(char);
    if (value < 0) continue;

    buffer = (buffer << 6) | value;
    bits += 6;

    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }

  return new Uint8Array(bytes);
}

export async function uploadPatientProfilePhoto(patientId: string, uri: string) {
  const profile = await getCurrentProfile();

  if (!profile?.clinic_id) throw new Error("Clinic profile not found");
  if (!patientId) throw new Error("Patient ID missing");

  const { data: existingPatient, error: existingPatientError } = await supabase
    .from("patients")
    .select("photo_url")
    .eq("id", patientId)
    .eq("clinic_id", profile.clinic_id)
    .maybeSingle();

  if (existingPatientError) throw existingPatientError;

  const optimized = await optimizeUploadImage(uri, "patient_profile");
  const base64 = await FileSystem.readAsStringAsync(optimized.uri, {
    encoding: FileSystem.EncodingType.Base64,
  });

  const bytes = base64ToUint8Array(base64);
  const path = `${profile.clinic_id}/${patientId}/profile-${Date.now()}.webp`;

  const { error: uploadError } = await supabase.storage
    .from("patient-files")
    .upload(path, bytes, {
      contentType: optimized.mimeType,
      cacheControl: "31536000",
      upsert: true,
    });

  if (uploadError) throw uploadError;

  const { data } = supabase.storage.from("patient-files").getPublicUrl(path);

  const { error: updateError } = await supabase
    .from("patients")
    .update({ photo_url: data.publicUrl })
    .eq("id", patientId)
    .eq("clinic_id", profile.clinic_id);

  if (updateError) {
    await supabase.storage.from("patient-files").remove([path]);
    throw updateError;
  }

  const previousPhoto = parseStorageObjectUrl(existingPatient?.photo_url);
  if (
    previousPhoto?.bucket === "patient-files" &&
    previousPhoto.path !== path
  ) {
    const { error: cleanupError } = await supabase.storage
      .from(previousPhoto.bucket)
      .remove([previousPhoto.path]);

    if (cleanupError) {
      console.warn("Unable to remove the previous patient photo:", cleanupError.message);
    }
  }

  return data.publicUrl;
}
