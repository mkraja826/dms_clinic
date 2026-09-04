import { Session } from "@supabase/supabase-js";
import * as WebBrowser from "expo-web-browser";
import { router, useSegments } from "expo-router";
import {
  createContext,
  ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Alert } from "react-native";
import {
  getCurrentProfile,
  getDashboardPath,
  getRoleSegment,
  normalizeRole,
  Profile,
  clearForceSignedOut,
  clearSupabaseAuthStorage,
  invalidateSupabaseCache,
  markForceSignedOut,
  shouldForceSignedOut,
  supabase,
} from "@/lib/supabase";

WebBrowser.maybeCompleteAuthSession();

type AuthContextValue = {
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  loadingMessage: string;
  refreshProfile: () => Promise<Profile | null>;
  signIn: (email: string, password: string) => Promise<void>;
  signInWithGoogle: () => Promise<boolean>;
  signUpOwner: (email: string, password: string) => Promise<void>;
  signUpStaff: (email: string, password: string) => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  updatePassword: (password: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);
const PASSWORD_RESET_REDIRECT_URL =
  process.env.EXPO_PUBLIC_PASSWORD_RESET_REDIRECT_URL ?? "dms://auth/reset-password";
const GOOGLE_AUTH_REDIRECT_URL =
  process.env.EXPO_PUBLIC_GOOGLE_AUTH_REDIRECT_URL ?? "dms://auth/callback";

function isRoleGroup(segment?: string) {
  return segment === "(head)" || segment === "(doctor)" || segment === "(reception)";
}

async function withTimeout<T>(promise: Promise<T>, ms = 12000): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("Request timed out")), ms)),
  ]);
}

function paramsFromUrl(url: string) {
  const queryIndex = url.indexOf("?");
  const hashIndex = url.indexOf("#");
  const query = queryIndex >= 0 ? url.slice(queryIndex + 1, hashIndex >= 0 ? hashIndex : undefined) : "";
  const hash = hashIndex >= 0 ? url.slice(hashIndex + 1) : "";
  const params = new URLSearchParams(query);

  new URLSearchParams(hash).forEach((value, key) => {
    if (!params.has(key)) params.set(key, value);
  });

  return params;
}

async function completeOAuthSession(url: string) {
  const params = paramsFromUrl(url);
  const errorDescription = params.get("error_description") || params.get("error");

  if (errorDescription) {
    throw new Error(decodeURIComponent(errorDescription.replace(/\+/g, " ")));
  }

  const code = params.get("code");
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) throw error;
    return;
  }

  const accessToken = params.get("access_token");
  const refreshToken = params.get("refresh_token");

  if (accessToken && refreshToken) {
    const { error } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });
    if (error) throw error;
    return;
  }

  throw new Error("Google did not return a valid CapDent session.");
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const segments = useSegments();
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMessage, setLoadingMessage] = useState("Opening CapDent...");

  async function refreshProfile() {
    try {
      setLoadingMessage("Loading clinic profile...");
      const current = await withTimeout(getCurrentProfile({ force: true }), 12000);
      setProfile(current);
      return current;
    } catch (error) {
      console.warn("refreshProfile error:", error);
      setProfile(null);
      return null;
    }
  }

  async function loadSession(nextSession: Session | null) {
    setLoadingMessage("Checking login...");
    setSession(nextSession);
    if (!nextSession) {
      invalidateSupabaseCache();
      setProfile(null);
      return;
    }
    await refreshProfile();
  }

  useEffect(() => {
    let mounted = true;
    let authChangeTimer: ReturnType<typeof setTimeout> | null = null;
    async function initAuth() {
      try {
        setLoadingMessage("Opening CapDent...");
        if (await shouldForceSignedOut()) {
          await clearSupabaseAuthStorage();
          if (!mounted) return;
          setSession(null);
          setProfile(null);
          return;
        }
        const { data } = await supabase.auth.getSession();
        if (!mounted) return;
        await loadSession(data.session);
      } catch (error) {
        console.warn("Initial auth load failed:", error);
        if (!mounted) return;
        setSession(null);
        setProfile(null);
      } finally {
        if (mounted) setLoading(false);
      }
    }
    initAuth();
    const { data: listener } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (!mounted) return;
      if (event === "TOKEN_REFRESHED") {
        setSession(nextSession);
        return;
      }

      // Supabase recommends keeping this callback synchronous. Profile queries
      // are deferred so they cannot contend with the auth client's internal lock.
      if (authChangeTimer) clearTimeout(authChangeTimer);
      authChangeTimer = setTimeout(() => {
        void (async () => {
          try {
            setLoading(true);
            setLoadingMessage("Restoring clinic session...");
            await loadSession(nextSession);
          } catch (error) {
            console.warn("Auth state load failed:", error);
            setSession(null);
            setProfile(null);
          } finally {
            if (mounted) setLoading(false);
          }
        })();
      }, 0);
    });
    return () => {
      mounted = false;
      if (authChangeTimer) clearTimeout(authChangeTimer);
      listener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (loading) return;
    const [firstSegment, secondSegment] = segments as [string?, string?];
    const isAuthScreen = firstSegment === "auth";
    const isSettingsPasswordScreen = firstSegment === "settings" && secondSegment === "change-password";

    if (!session) {
      if (firstSegment !== "login" && !isAuthScreen) router.replace("/login");
      return;
    }
    if (isAuthScreen || isSettingsPasswordScreen) return;
    if (session && !profile) {
      if (firstSegment !== "onboarding") router.replace("/onboarding");
      return;
    }
    if (session && profile) {
      const normalizedRole = normalizeRole(profile.role);
      if (!profile.clinic_id) {
        if (normalizedRole === "head_doctor") {
          if (firstSegment !== "onboarding") router.replace("/onboarding");
          return;
        }
        if (firstSegment !== "clinic" || secondSegment !== "contact-admin") router.replace("/clinic/contact-admin" as never);
        return;
      }
      const correctPath = getDashboardPath(profile.role);
      const correctSegment = getRoleSegment(profile.role);
      if (firstSegment === "login" || firstSegment === "onboarding" || firstSegment === undefined) {
        router.replace(correctPath as never);
        return;
      }
      if (isRoleGroup(firstSegment) && firstSegment !== correctSegment) router.replace(correctPath as never);
    }
  }, [loading, session, profile, segments]);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      profile,
      loading,
      loadingMessage,
      refreshProfile,
      async signIn(email, password) {
        const { data, error } = await withTimeout(
          supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password }),
          10000
        );
        if (error) throw error;
        invalidateSupabaseCache();
        await clearForceSignedOut();
        if (data.user && !data.user.email_confirmed_at) {
          await supabase.auth.signOut();
          setSession(null);
          setProfile(null);
          throw new Error("Please verify your email before logging in.");
        }
      },
      async signInWithGoogle() {
        await clearForceSignedOut();

        const { data, error } = await withTimeout(
          supabase.auth.signInWithOAuth({
            provider: "google",
            options: {
              redirectTo: GOOGLE_AUTH_REDIRECT_URL,
              skipBrowserRedirect: true,
              queryParams: {
                prompt: "select_account",
              },
            },
          }),
          10000
        );

        if (error) throw error;
        if (!data.url) throw new Error("Google login could not be started.");

        const result = await WebBrowser.openAuthSessionAsync(
          data.url,
          GOOGLE_AUTH_REDIRECT_URL
        );

        if (result.type !== "success" || !result.url) return false;

        await completeOAuthSession(result.url);
        invalidateSupabaseCache();
        return true;
      },
      async signUpOwner(email, password) {
        const { error } = await withTimeout(
          supabase.auth.signUp({
            email: email.trim().toLowerCase(),
            password,
            options: { emailRedirectTo: "dms://auth/callback" },
          }),
          10000
        );
        if (error) throw error;
      },
      async signUpStaff(email, password) {
        const { error } = await withTimeout(
          supabase.auth.signUp({
            email: email.trim().toLowerCase(),
            password,
            options: { emailRedirectTo: "dms://auth/callback" },
          }),
          10000
        );
        if (error) throw error;
      },
      async resetPassword(email) {
        const { error } = await withTimeout(supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), { redirectTo: PASSWORD_RESET_REDIRECT_URL }), 10000);
        if (error) throw error;
        Alert.alert("Check your email", "Open the reset link from the same phone to set a new password.");
      },
      async updatePassword(password) {
        const { error } = await withTimeout(supabase.auth.updateUser({ password }), 10000);
        if (error) throw error;
      },
      async signOut() {
        try {
          const { error } = await withTimeout(supabase.auth.signOut({ scope: "local" }), 8000);
          if (error) console.warn("Sign out request failed:", error.message);
        } catch (error) {
          console.warn("Sign out request failed:", error);
        } finally {
          await markForceSignedOut();
          invalidateSupabaseCache();
          await clearSupabaseAuthStorage();
          setSession(null);
          setProfile(null);
          setLoading(false);
          router.replace("/login" as never);
        }
      },
    }),
    [loading, loadingMessage, profile, session]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}
