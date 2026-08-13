import * as Notifications from "expo-notifications";
import { router } from "expo-router";
import { ReactNode, useEffect, useRef } from "react";
import { useAuth } from "@/lib/auth";
import { PAYMENT_PUSH_GLOBALLY_ENABLED } from "@/lib/featureFlags";
import {
  isSafePaymentNotificationData,
  registerPaymentPushToken,
} from "@/lib/paymentNotifications";

Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const shouldPresent =
      PAYMENT_PUSH_GLOBALLY_ENABLED &&
      isSafePaymentNotificationData(notification.request.content.data);
    return {
      shouldPlaySound: false,
      shouldSetBadge: false,
      shouldShowBanner: shouldPresent,
      shouldShowList: shouldPresent,
    };
  },
});

export function PaymentNotificationCoordinator({
  children,
}: {
  children: ReactNode;
}) {
  const { profile, session } = useAuth();
  const handledResponseIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!PAYMENT_PUSH_GLOBALLY_ENABLED || !session || !profile?.clinic_id) {
      return;
    }

    let active = true;
    let registrationRunning = false;

    async function register() {
      if (!active || registrationRunning) return;
      registrationRunning = true;
      try {
        await registerPaymentPushToken(profile);
      } catch (error) {
        console.warn("Payment push token registration failed:", error);
      } finally {
        registrationRunning = false;
      }
    }

    void register();

    const tokenSubscription = Notifications.addPushTokenListener(() => {
      void register();
    });

    return () => {
      active = false;
      tokenSubscription.remove();
    };
  }, [profile?.clinic_id, profile?.id, profile?.role, session?.user.id]);

  useEffect(() => {
    if (!PAYMENT_PUSH_GLOBALLY_ENABLED || !session?.user.id) return;

    let active = true;

    function openSafeResponse(
      response: Notifications.NotificationResponse
    ) {
      const request = response.notification.request;
      if (
        handledResponseIdRef.current === request.identifier ||
        !isSafePaymentNotificationData(request.content.data)
      ) {
        return;
      }

      handledResponseIdRef.current = request.identifier;
      router.push("/reports/payments" as never);
      void Notifications.clearLastNotificationResponseAsync().catch(() => {
        // Clearing is best-effort. The request identifier still prevents a
        // duplicate route during this mounted session.
      });
    }

    const responseSubscription =
      Notifications.addNotificationResponseReceivedListener((response) => {
        openSafeResponse(response);
      });

    // Response listeners do not replay the tap that cold-started the app.
    // Read the last response once auth is restored so that route is not lost.
    void Notifications.getLastNotificationResponseAsync()
      .then((response) => {
        if (active && response) openSafeResponse(response);
      })
      .catch(() => {
        // Notification-response recovery must never block app startup.
      });

    return () => {
      active = false;
      responseSubscription.remove();
    };
  }, [session?.user.id]);

  return children;
}
