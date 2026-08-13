import { usePathname } from "expo-router";
import { PropsWithChildren, useEffect, useRef } from "react";
import { useAuth } from "@/lib/auth";
import {
  analyticsRole,
  analyticsScreenName,
  initializeFirebaseAnalytics,
  logCapDentAnalyticsEvent,
} from "@/lib/firebaseAnalytics";

export function FirebaseAnalyticsCoordinator({ children }: PropsWithChildren) {
  const pathname = usePathname();
  const { loading, session, profile } = useAuth();
  const appReadyLogged = useRef(false);
  const lastScreen = useRef<string | null>(null);

  useEffect(() => {
    void initializeFirebaseAnalytics();
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

  return children;
}
