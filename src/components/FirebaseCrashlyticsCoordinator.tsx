import { PropsWithChildren, useEffect } from "react";
import { initializeFirebaseCrashlytics } from "@/lib/firebaseCrashlytics";
import { installFirebaseCrashlyticsAdapter } from "@/lib/firebaseCrashlyticsAdapter";

// Install before the coordinator effect enables or disables collection.
installFirebaseCrashlyticsAdapter();

export function FirebaseCrashlyticsCoordinator({ children }: PropsWithChildren) {
  useEffect(() => {
    void initializeFirebaseCrashlytics();
  }, []);

  return children;
}
