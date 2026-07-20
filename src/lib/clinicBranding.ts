import * as FileSystem from "expo-file-system/legacy";
import { optimizeUploadImage } from "@/lib/imageCompression";
import { parseStorageObjectUrl } from "@/lib/storageUrls";
import { getCurrentProfile, supabase } from "@/lib/supabase";

export type ClinicBrand = {
  id: string;
  name: string;
  logo_url: string | null;
  phone?: string | null;
  address?: string | null;
  brand_color?: string | null;
};

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

export async function getClinicBrand() {
  const profile = await getCurrentProfile();

  if (!profile?.clinic_id) return null;

  const { data, error } = await supabase
    .from("clinics")
    .select("id,name,logo_url,phone,address,brand_color")
    .eq("id", profile.clinic_id)
    .maybeSingle();

  if (error) throw error;

  return data as ClinicBrand | null;
}

export async function uploadClinicLogo(uri: string) {
  const profile = await getCurrentProfile();

  if (!profile?.clinic_id) {
    throw new Error("Clinic profile not found");
  }

  const { data: existingClinic, error: existingClinicError } = await supabase
    .from("clinics")
    .select("logo_url")
    .eq("id", profile.clinic_id)
    .maybeSingle();

  if (existingClinicError) throw existingClinicError;

  const optimized = await optimizeUploadImage(uri, "clinic_logo");
  const base64 = await FileSystem.readAsStringAsync(optimized.uri, {
    encoding: FileSystem.EncodingType.Base64,
  });

  const bytes = base64ToUint8Array(base64);
  const path = `${profile.clinic_id}/logo-${Date.now()}.webp`;

  const { error: uploadError } = await supabase.storage
    .from("clinic-logos")
    .upload(path, bytes, {
      contentType: optimized.mimeType,
      cacheControl: "31536000",
      upsert: true,
    });

  if (uploadError) throw uploadError;

  const { data } = supabase.storage.from("clinic-logos").getPublicUrl(path);

  const { error: updateError } = await supabase
    .from("clinics")
    .update({
      logo_url: data.publicUrl,
    })
    .eq("id", profile.clinic_id);

  if (updateError) {
    await supabase.storage.from("clinic-logos").remove([path]);
    throw updateError;
  }

  const previousLogo = parseStorageObjectUrl(existingClinic?.logo_url);
  if (
    previousLogo?.bucket === "clinic-logos" &&
    previousLogo.path !== path
  ) {
    const { error: cleanupError } = await supabase.storage
      .from(previousLogo.bucket)
      .remove([previousLogo.path]);

    if (cleanupError) {
      console.warn("Unable to remove the previous clinic logo:", cleanupError.message);
    }
  }

  return data.publicUrl;
}

export async function updateClinicBrand(input: {
  name: string;
  phone?: string;
  address?: string;
  logoUri?: string | null;
}) {
  const profile = await getCurrentProfile();

  if (!profile?.clinic_id) {
    throw new Error("Clinic profile not found");
  }

  let logoUrl: string | undefined;

  if (input.logoUri) {
    logoUrl = await uploadClinicLogo(input.logoUri);
  }

  const payload: Record<string, string | null> = {
    name: input.name.trim(),
    phone: input.phone?.trim() || null,
    address: input.address?.trim() || null,
  };

  if (logoUrl) {
    payload.logo_url = logoUrl;
  }

  const { data, error } = await supabase
    .from("clinics")
    .update(payload)
    .eq("id", profile.clinic_id)
    .select("id,name,logo_url,phone,address,brand_color")
    .single();

  if (error) throw error;

  return data as ClinicBrand;
}
