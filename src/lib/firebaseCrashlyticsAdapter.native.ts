import {
  getCrashlytics,
  setCrashlyticsCollectionEnabled,
} from "@react-native-firebase/crashlytics";
import { configureFirebaseCrashlyticsAdapter } from "@/lib/firebaseCrashlytics";

let installed = false;

export function installFirebaseCrashlyticsAdapter() {
  if (installed) return;

  configureFirebaseCrashlyticsAdapter({
    setCollectionEnabled: (enabled) =>
      setCrashlyticsCollectionEnabled(getCrashlytics(), enabled),
  });
  installed = true;
}
