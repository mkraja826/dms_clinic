import { usePathname } from "expo-router";
import { PropsWithChildren, useEffect, useRef } from "react";
import { useAuth } from "@/lib/auth";
import {
  analyticsRole,
  analyticsScreenName,
  initializeFirebaseAnalytics,
  logCapDentAnalyticsEvent,
} from "@/lib/firebaseAnalytics";
import { installFirebaseAnalyticsAdapter } from "@/lib/firebaseAnalyticsAdapter";
import { initializeFirebaseCrashlytics } from "@/lib/firebaseCrashlytics";
import { installFirebaseCrashlyticsAdapter } from "@/lib/firebaseCrashlyticsAdapter";

// Install before any coordinator effect can initialize Firebase telemetry.
installFirebaseAnalyticsAdapter();
installFirebaseCrashlyticsAdapter();

export function FirebaseAnalyticsCoordinator({ children }: PropsWithChildren) {
  const pathname = usePathname();
  const { loading, session, profile } = useAuth();
  const appReadyLogged = useRef(false);
  const lastScreen = useRef<string | null>(null);
  const lastFeaturePath = useRef<string | null>(null);

  useEffect(() => {
    void initializeFirebaseAnalytics();
    void initializeFirebaseCrashlytics();
  }, []);

  useEffect(() => {
    if (loading || !session || !profile?.clinic_id || appReadyLogged.current) return;

    appReadyLogged.current = true;
    void logCapDentAnalyticsEvent("capdent_app_ready", {
      role: analyticsRole(profile.role),
    });
  }, [loading, profile?.clinic_id, profile?.role, session]);

  useEffect(() => {
    const screenName = analyticsScreenName(pathname);
    if (screenName === lastScreen.current) return;

    lastScreen.current = screenName;
    void logCapDentAnalyticsEvent("capdent_screen_view", {
      screen_name: screenName,
      role: analyticsRole(profile?.role),
      signed_in: Boolean(session),
    });
  }, [pathname, profile?.role, session]);

  useEffect(() => {
    if (lastFeaturePath.current === pathname) return;
    lastFeaturePath.current = pathname;

    if (pathname === "/settings/subscription") {
      void logCapDentAnalyticsEvent("capdent_plan_viewed", {
        plan: "unknown",
        locked_context: false,
      });
      return;
    }

    if (pathname === "/settings/subscription-recovery") {
      void logCapDentAnalyticsEvent("capdent_billing_recovery", {
        action: "view",
        outcome: "viewed",
        plan: "unknown",
        state: "unknown",
      });
    }
  }, [pathname]);

  return children;
}