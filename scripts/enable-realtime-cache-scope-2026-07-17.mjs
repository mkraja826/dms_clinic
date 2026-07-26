import { readFileSync, writeFileSync } from "node:fs";

const path = "src/lib/supabase.ts";
const text = readFileSync(path, "utf8").replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
const before = 'type AppDataCacheScope = "dashboard" | "patients" | "appointments" | "payments" | "staff";';
const after = 'type AppDataCacheScope = "dashboard" | "patients" | "appointments" | "payments" | "treatments" | "staff";';

if (text.includes(after)) {
  console.log("Realtime cache scope already enabled.");
} else {
  if (!text.includes(before)) throw new Error("AppDataCacheScope source line not found.");
  writeFileSync(path, text.replace(before, after), "utf8");
  console.log("Realtime cache scope enabled.");
}
