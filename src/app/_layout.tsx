import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { ActivityIndicator, Image, StyleSheet, Text, View } from "react-native";
import { AuthProvider, useAuth } from "@/lib/auth";
import { colors } from "@/constants/colors";
import { isSupabaseConfigured, normalizeRole } from "@/lib/supabase";

const appLogo = require("../../assets/icon.png");

function ConfigurationErrorScreen() {
  return (
    <View
      style={{
        flex: 1,
        justifyContent: "center",
        backgroundColor: colors.background,
        padding: 24,
        gap: 12,
      }}
    >
      <Text style={{ color: colors.text, fontSize: 24, fontWeight: "900" }}>
        Supabase is not configured
      </Text>
      <Text selectable style={{ color: colors.muted, fontSize: 16, lineHeight: 23 }}>
        Add EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY in your .env file.
      </Text>
    </View>
  );
}

function RootStack() {
  const { loading, loadingMessage, session, profile } = useAuth();

  if (loading) {
    return (
      <View style={styles.loadingScreen}>
        <StatusBar style="dark" />

        <View style={styles.logoCard}>
          <Image source={appLogo} style={styles.loadingLogo} resizeMode="contain" />
        </View>

        <Text style={styles.loadingTitle}>CapDent</Text>
        <Text style={styles.loadingSubtitle}>Dental Clinic Management</Text>

        <View style={styles.loadingStatus}>
          <ActivityIndicator color={colors.primary} />
          <Text style={styles.loadingMessage}>
            {loadingMessage || "Preparing your dental workspace..."}
          </Text>
        </View>
      </View>
    );
  }

  const hasSession = Boolean(session);
  const hasClinicProfile = Boolean(profile?.clinic_id);
  const appReady = hasSession && hasClinicProfile;
  const role = profile ? normalizeRole(profile.role) : null;

  return (
    <>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.background },
        }}
      >
        <Stack.Screen name="index" />

        <Stack.Protected guard={!hasSession}>
          <Stack.Screen name="login" />
        </Stack.Protected>

        {/* These routes must remain reachable while an email deep link creates a session. */}
        <Stack.Screen name="auth/callback" options={{ headerShown: true, title: "Verifying Email" }} />
        <Stack.Screen name="auth/forgot-password" options={{ headerShown: true, title: "Forgot Password" }} />
        <Stack.Screen name="auth/reset-password" options={{ headerShown: true, title: "Reset Password" }} />

        <Stack.Protected guard={hasSession}>
          <Stack.Screen
            name="onboarding"
            options={{
              headerShown: true,
              title: "Clinic Setup",
              headerStyle: { backgroundColor: colors.background },
              headerTintColor: colors.text,
              headerShadowVisible: false,
            }}
          />
          <Stack.Screen name="settings/change-password" options={{ headerShown: true, title: "Change Password" }} />
          <Stack.Screen name="clinic/contact-admin" options={{ headerShown: true, title: "Contact Owner" }} />
        </Stack.Protected>

        <Stack.Protected guard={appReady}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="appointment/book" options={{ headerShown: true, title: "Book Appointment" }} />
          <Stack.Screen name="clinic/branding" options={{ headerShown: true, title: "Clinic Branding" }} />
          <Stack.Screen name="gallery/index" options={{ headerShown: true, title: "Gallery" }} />
          <Stack.Screen name="image-viewer" />
          <Stack.Screen name="patient/index" options={{ headerShown: true, title: "Patients" }} />
          <Stack.Screen name="patient/add" options={{ headerShown: true, title: "Add Patient" }} />
          <Stack.Screen name="patient/add-old" options={{ headerShown: true, title: "Add Old Patient" }} />
          <Stack.Screen name="patient/edit" options={{ headerShown: true, title: "Edit Patient" }} />
          <Stack.Screen name="patient/[id]" options={{ headerShown: true, title: "Patient Profile" }} />
          <Stack.Screen name="patient/followup" options={{ headerShown: true, title: "Patient Follow-up" }} />
          <Stack.Screen name="patient/medical-history" options={{ headerShown: true, title: "Medical History" }} />
          <Stack.Screen name="patient/medications" options={{ headerShown: true, title: "Medications" }} />
          <Stack.Screen name="patient/payment" options={{ headerShown: true, title: "Collect Payment" }} />
          <Stack.Screen name="patient/upload" options={{ headerShown: true, title: "Upload File" }} />
          <Stack.Screen name="patient/upload-prescription" options={{ headerShown: true, title: "Upload Prescription" }} />
          <Stack.Screen name="patient/upload-xray" options={{ headerShown: true, title: "Upload X-ray" }} />
          <Stack.Screen name="patient/upload-photo" options={{ headerShown: true, title: "Upload Patient Photo" }} />
          <Stack.Screen name="patient/visit" options={{ headerShown: true, title: "Add Visit" }} />
          <Stack.Screen name="payment/consultation" options={{ headerShown: true, title: "Consultation Fee" }} />
          <Stack.Screen name="payment/fee" options={{ headerShown: true, title: "Reception Fees" }} />
          <Stack.Screen name="payment/op-fee" options={{ headerShown: true, title: "OP Fee" }} />
          <Stack.Screen name="payment/medication-fee" options={{ headerShown: true, title: "Medication Fee" }} />
          <Stack.Screen name="reception/checkin" options={{ headerShown: true, title: "Patient Check-in" }} />
          <Stack.Screen name="reminders/index" options={{ headerShown: true, title: "Reminders" }} />
          <Stack.Screen name="reports/activity" options={{ headerShown: true, title: "Activity Report" }} />
          <Stack.Screen name="reports/clinic" options={{ headerShown: true, title: "Clinic Report" }} />
          <Stack.Screen name="reports/export" options={{ headerShown: true, title: "Export Report" }} />
          <Stack.Screen name="reports/followups" options={{ headerShown: true, title: "Follow-up Report" }} />
          <Stack.Screen name="reports/owner-review" options={{ headerShown: true, title: "Owner Review" }} />
          <Stack.Screen name="reports/payments" options={{ headerShown: true, title: "Payment Report" }} />
          <Stack.Screen name="reports/staff-performance" options={{ headerShown: true, title: "Staff Performance" }} />
          <Stack.Screen name="reports/treatments" options={{ headerShown: true, title: "Treatment Report" }} />
          <Stack.Screen name="settings/account" options={{ headerShown: true, title: "Account" }} />
          <Stack.Screen name="settings/delete-account" options={{ headerShown: true, title: "Delete Account" }} />
          <Stack.Screen name="settings/legal" options={{ headerShown: true, title: "Legal" }} />
          <Stack.Screen name="settings/privacy" options={{ headerShown: true, title: "Privacy Policy" }} />
          <Stack.Screen name="settings/report-issue" options={{ headerShown: true, title: "Report an Issue" }} />
          <Stack.Screen name="settings/subscription" options={{ headerShown: true, title: "Subscription" }} />
          <Stack.Screen name="settings/terms" options={{ headerShown: true, title: "Terms" }} />
          <Stack.Screen name="staff/index" options={{ headerShown: true, title: "Staff Management" }} />
          <Stack.Screen name="staff/add" options={{ headerShown: true, title: "Add Staff" }} />
          <Stack.Screen name="treatments/ongoing" options={{ headerShown: true, title: "Ongoing Treatments" }} />
        </Stack.Protected>

        <Stack.Protected guard={appReady && role === "head_doctor"}>
          <Stack.Screen name="(head)" />
        </Stack.Protected>
        <Stack.Protected guard={appReady && role === "working_doctor"}>
          <Stack.Screen name="(doctor)" />
        </Stack.Protected>
        <Stack.Protected guard={appReady && role === "receptionist"}>
          <Stack.Screen name="(reception)" />
        </Stack.Protected>
      </Stack>
    </>
  );
}

const styles = StyleSheet.create({
  loadingScreen: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.background,
    paddingHorizontal: 28,
  },
  logoCard: {
    width: 164,
    height: 164,
    borderRadius: 42,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: colors.shadow,
    shadowOpacity: 0.1,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  loadingLogo: {
    width: 132,
    height: 132,
    borderRadius: 30,
  },
  loadingTitle: {
    marginTop: 26,
    color: colors.text,
    fontSize: 34,
    fontWeight: "900",
    letterSpacing: 0.8,
  },
  loadingSubtitle: {
    marginTop: 8,
    color: colors.muted,
    fontSize: 14,
    fontWeight: "700",
    letterSpacing: 0.4,
  },
  loadingStatus: {
    marginTop: 34,
    alignItems: "center",
    gap: 12,
  },
  loadingMessage: {
    color: colors.muted,
    fontSize: 14,
    fontWeight: "700",
    textAlign: "center",
  },
});

export default function Layout() {
  if (!isSupabaseConfigured) {
    return <ConfigurationErrorScreen />;
  }

  return (
    <AuthProvider>
      <RootStack />
    </AuthProvider>
  );
}
