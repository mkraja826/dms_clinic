import {
  getAnalytics,
  logEvent,
  setAnalyticsCollectionEnabled,
  setConsent,
} from "@react-native-firebase/analytics";
import { configureFirebaseAnalyticsAdapter } from "@/lib/firebaseAnalytics";

let installed = false;

export function installFirebaseAnalyticsAdapter() {
  if (installed) return;

  configureFirebaseAnalyticsAdapter({
    setConsent: (consent) => setConsent(getAnalytics(), consent),
    setAnalyticsCollectionEnabled: (enabled) =>
      setAnalyticsCollectionEnabled(getAnalytics(), enabled),
    logEvent: (name, params) => logEvent(getAnalytics(), name, params),
  });
  installed = true;
}
