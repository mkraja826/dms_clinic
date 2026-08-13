import { ReactNode, useEffect, useRef } from "react";
import { usePathname } from "expo-router";
import { KeyboardAvoidingView, Platform, RefreshControl, ScrollView, useWindowDimensions, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { colors } from "@/constants/colors";
import {
  doctorWorkflowNavItems,
  headWorkflowNavItems,
  receptionWorkflowNavItems,
} from "@/constants/workflowNav";
import { useAuth } from "@/lib/auth";
import { WorkflowBottomNav, type WorkflowBottomNavItem } from "@/components/WorkflowBottomNav";

type BottomNavRole = "head_doctor" | "working_doctor" | "receptionist";

function normalizeBottomNavRole(role?: string | null): BottomNavRole | null {
  if (role === "owner" || role === "head_doctor") return "head_doctor";
  if (role === "doctor" || role === "working_doctor") return "working_doctor";
  if (role === "receptionist") return "receptionist";
  return null;
}

function shouldHideAutomaticBottomNav(pathname: string) {
  return (
    pathname === "/" ||
    pathname === "/login" ||
    pathname === "/onboarding" ||
    pathname.startsWith("/auth")
  );
}

function getBottomNavConfig(role: BottomNavRole): WorkflowBottomNavItem[] {
  if (role === "head_doctor") return headWorkflowNavItems;
  if (role === "working_doctor") return doctorWorkflowNavItems;
  return receptionWorkflowNavItems;
}

function getActiveBottomNavKey(role: BottomNavRole, pathname: string) {
  if (pathname === "/dashboard" || pathname.endsWith("/dashboard")) return "home";
  if (pathname === "/more" || pathname.endsWith("/more")) return "more";

  if (role === "receptionist") {
    if (pathname.startsWith("/reception/checkin")) return "checkin";
    if (pathname.startsWith("/payment") || pathname.startsWith("/patient/payment")) return "payments";
    if (pathname.startsWith("/patient")) return "patients";
    return "more";
  }

  if (role === "working_doctor") {
    if (pathname.startsWith("/patient/visit")) return "visit";
    if (pathname.startsWith("/treatments")) return "treatments";
    if (
      pathname.startsWith("/patient/upload") ||
      pathname.startsWith("/gallery") ||
      pathname.startsWith("/reminders") ||
      pathname.startsWith("/appointment") ||
      pathname.startsWith("/settings")
    ) {
      return "more";
    }
    if (pathname.startsWith("/patient")) return "patients";
    return "more";
  }

  if (pathname.startsWith("/reports/payments") || pathname.startsWith("/payment") || pathname.startsWith("/patient/payment")) {
    return "money";
  }
  if (pathname.startsWith("/treatments") || pathname.startsWith("/reports/treatments")) return "treatments";
  if (pathname.startsWith("/patient")) return "patients";
  return "more";
}

export function Screen({
  children,
  scroll = true,
  refreshing = false,
  onRefresh,
  scrollToTopKey,
  bottomBar,
}: {
  children: ReactNode;
  scroll?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  scrollToTopKey?: string | number | null;
  bottomBar?: ReactNode;
}) {
  const pathname = usePathname();
  const { profile } = useAuth();
  const scrollRef = useRef<ScrollView | null>(null);
  const { width } = useWindowDimensions();
  const isWide = width >= 768;
  const role = normalizeBottomNavRole(profile?.role);
  const automaticBottomBar =
    role && !shouldHideAutomaticBottomNav(pathname) ? (
      <WorkflowBottomNav
        items={getBottomNavConfig(role)}
        activeKey={getActiveBottomNavKey(role, pathname)}
      />
    ) : null;
  const resolvedBottomBar = bottomBar === undefined ? automaticBottomBar : bottomBar;
  const contentPadding = {
    width: "100%" as const,
    maxWidth: isWide ? 820 : undefined,
    alignSelf: "center" as const,
    paddingHorizontal: isWide ? 24 : 16,
    paddingTop: isWide ? 20 : 14,
    paddingBottom: resolvedBottomBar ? 118 : 40,
    gap: 16,
  };

  useEffect(() => {
    const timeout = setTimeout(() => {
      scrollRef.current?.scrollTo({ y: 0, animated: false });
    }, 0);

    return () => clearTimeout(timeout);
  }, []);

  useEffect(() => {
    if (scrollToTopKey === undefined) return;

    const timeout = setTimeout(() => {
      scrollRef.current?.scrollTo({ y: 0, animated: false });
    }, 0);

    return () => clearTimeout(timeout);
  }, [scrollToTopKey]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={["top", "left", "right"]}>
      <StatusBar style="dark" />
      <KeyboardAvoidingView
        style={{ flex: 1, backgroundColor: colors.background }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        {scroll ? (
          <ScrollView
            ref={scrollRef}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            contentInsetAdjustmentBehavior="automatic"
            scrollEventThrottle={16}
            refreshControl={
              onRefresh ? (
                <RefreshControl
                  accessibilityLabel="Refresh screen content"
                  refreshing={refreshing}
                  onRefresh={onRefresh}
                  tintColor={colors.primary}
                  colors={[colors.primary]}
                  progressBackgroundColor={colors.surface}
                />
              ) : undefined
            }
            style={{ flex: 1, backgroundColor: colors.background }}
            contentContainerStyle={contentPadding}
          >
            {children}
          </ScrollView>
        ) : (
          <View style={{ flex: 1, backgroundColor: colors.background, ...contentPadding }}>
            {children}
          </View>
        )}
        {resolvedBottomBar ? <View style={{ backgroundColor: colors.background }}>{resolvedBottomBar}</View> : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
