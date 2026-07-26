import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const path = "src/app/reception/checkin.tsx";

if (!existsSync(path)) {
  throw new Error(`Missing file: ${path}`);
}

let text = readFileSync(path, "utf8").replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");

function replaceOnce(from, to, label) {
  if (text.includes(to)) {
    console.log(`${label}: already applied`);
    return;
  }

  const count = text.split(from).length - 1;
  if (count !== 1) {
    throw new Error(`${label}: expected 1 match, found ${count}`);
  }

  text = text.replace(from, to);
  console.log(`${label}: applied`);
}

replaceOnce(
  'import { Ionicons } from "@expo/vector-icons";\n',
  'import { Ionicons } from "@expo/vector-icons";\nimport * as ImagePicker from "expo-image-picker";\n',
  "image picker import"
);

replaceOnce(
  'import { Alert, Pressable, Text, TextInput, View } from "react-native";',
  'import { Alert, Image, Pressable, Text, TextInput, View } from "react-native";',
  "image import"
);

replaceOnce(
  'import { DEFAULT_OP_FEE_AMOUNT, getClinicFeatureSettings } from "@/lib/clinicOptions";',
  'import {\n  DEFAULT_CLINIC_FEATURE_SETTINGS,\n  DEFAULT_OP_FEE_AMOUNT,\n  getClinicFeatureSettings,\n} from "@/lib/clinicOptions";',
  "clinic feature import"
);

replaceOnce(
  'import { searchPatientsPage } from "@/lib/patientDirectory";\n',
  'import { searchPatientsPage } from "@/lib/patientDirectory";\nimport { uploadPatientProfilePhoto } from "@/lib/patientProfilePhoto";\n',
  "photo upload import"
);

replaceOnce(
  '  const [address, setAddress] = useState("");\n\n  const [clinicOpFee, setClinicOpFee] = useState(DEFAULT_OP_FEE_AMOUNT);',
  '  const [address, setAddress] = useState("");\n  const [patientPhotosEnabled, setPatientPhotosEnabled] = useState(\n    DEFAULT_CLINIC_FEATURE_SETTINGS.enable_patient_photos\n  );\n  const [photoUri, setPhotoUri] = useState<string | null>(null);\n\n  const [clinicOpFee, setClinicOpFee] = useState(DEFAULT_OP_FEE_AMOUNT);',
  "photo state"
);

replaceOnce(
  '          ? getClinicFeatureSettings().catch(() => ({ op_fee_amount: DEFAULT_OP_FEE_AMOUNT }))\n',
  '          ? getClinicFeatureSettings().catch(() => DEFAULT_CLINIC_FEATURE_SETTINGS)\n',
  "full clinic settings fallback"
);

replaceOnce(
  '        setClinicOpFee(nextOpFee);\n        setOpAmount(String(nextOpFee));\n',
  '        setClinicOpFee(nextOpFee);\n        setOpAmount(String(nextOpFee));\n        setPatientPhotosEnabled(Boolean(clinicSettings.enable_patient_photos));\n',
  "photo setting load"
);

replaceOnce(
  '  function resetPatientSelection(nextMode: Mode) {\n    setMode(nextMode);\n    setSelectedPatientId("");\n    setPatientSearch("");\n  }',
  '  async function pickPatientPhoto() {\n    const result = await ImagePicker.launchImageLibraryAsync({\n      mediaTypes: ImagePicker.MediaTypeOptions.Images,\n      quality: 0.8,\n      allowsEditing: true,\n      aspect: [1, 1],\n    });\n\n    if (result.canceled) return;\n    setPhotoUri(result.assets[0].uri);\n  }\n\n  function resetPatientSelection(nextMode: Mode) {\n    setMode(nextMode);\n    setSelectedPatientId("");\n    setPatientSearch("");\n    setPhotoUri(null);\n  }',
  "photo picker"
);

replaceOnce(
  '    setAddress("");\n    setOpAmount(String(clinicOpFee));',
  '    setAddress("");\n    setPhotoUri(null);\n    setOpAmount(String(clinicOpFee));',
  "clear photo"
);

replaceOnce(
  '      const result = Array.isArray(data) ? data[0] : data;\n      const patientId = result?.patient_id || selectedPatientId;\n      let limitNotice = "";\n',
  '      const result = Array.isArray(data) ? data[0] : data;\n      const patientId = result?.patient_id || selectedPatientId;\n      let limitNotice = "";\n      let photoNotice = "";\n\n      if (mode === "new" && patientPhotosEnabled && photoUri && patientId) {\n        try {\n          await uploadPatientProfilePhoto(patientId, photoUri);\n          photoNotice = "\\n\\nPatient photo added.";\n        } catch (photoError) {\n          console.warn("Reception patient photo upload failed:", photoError);\n          photoNotice = "\\n\\nPatient checked in, but the photo could not upload. Add it later from Edit details.";\n        }\n      }\n',
  "photo upload after check-in"
);

replaceOnce(
  '          ? `OP fee ${money(fee)} collected. Patient is now in doctor\'s waiting queue.${limitNotice}`\n          : opStatus === "pending"\n          ? `OP fee ${money(fee)} marked pending. Patient is now in doctor\'s waiting queue.${limitNotice}`\n          : `OP fee waived: ${waiverReason}. Patient is now in doctor\'s waiting queue.${limitNotice}`;',
  '          ? `OP fee ${money(fee)} collected. Patient is now in doctor\'s waiting queue.${photoNotice}${limitNotice}`\n          : opStatus === "pending"\n          ? `OP fee ${money(fee)} marked pending. Patient is now in doctor\'s waiting queue.${photoNotice}${limitNotice}`\n          : `OP fee waived: ${waiverReason}. Patient is now in doctor\'s waiting queue.${photoNotice}${limitNotice}`;',
  "photo result message"
);

replaceOnce(
  '        <SectionCard title="Register New Patient" subtitle="Enter only the minimum details needed for quick clinic entry.">\n          <AppInput label="Patient Name" value={name} onChangeText={setName} placeholder="Patient name" />',
  '        <SectionCard title="Register New Patient" subtitle="Enter only the minimum details needed for quick clinic entry.">\n          {patientPhotosEnabled ? (\n            <View style={{ alignItems: "flex-end" }}>\n              <Pressable\n                accessibilityRole="button"\n                accessibilityLabel={photoUri ? "Change patient photo" : "Add patient photo"}\n                onPress={pickPatientPhoto}\n                style={({ pressed }) => ({\n                  width: 52,\n                  height: 52,\n                  borderRadius: 18,\n                  borderWidth: 1,\n                  borderColor: photoUri ? colors.primary : colors.border,\n                  backgroundColor: pressed ? colors.surfaceSoft : colors.primarySoft,\n                  overflow: "hidden",\n                  alignItems: "center",\n                  justifyContent: "center",\n                })}\n              >\n                {photoUri ? (\n                  <Image\n                    source={{ uri: photoUri }}\n                    style={{ width: "100%", height: "100%" }}\n                    resizeMode="cover"\n                  />\n                ) : (\n                  <Ionicons name="person-add-outline" size={25} color={colors.primary} />\n                )}\n              </Pressable>\n            </View>\n          ) : null}\n          <AppInput label="Patient Name" value={name} onChangeText={setName} placeholder="Patient name" />',
  "small photo button"
);

writeFileSync(path, text.endsWith("\n") ? text : `${text}\n`, "utf8");
console.log(`${path}: updated`);

const updated = readFileSync(path, "utf8");
for (const marker of [
  'name="person-add-outline"',
  "uploadPatientProfilePhoto(patientId, photoUri)",
  "patientPhotosEnabled",
]) {
  if (!updated.includes(marker)) throw new Error(`Verification failed: missing ${marker}`);
}

console.log("Running TypeScript validation...");
if (process.platform === "win32") {
  execFileSync("cmd.exe", ["/d", "/s", "/c", "npm run typecheck"], { stdio: "inherit" });
} else {
  execFileSync("npm", ["run", "typecheck"], { stdio: "inherit" });
}

console.log("Reception check-in photo button added successfully.");
