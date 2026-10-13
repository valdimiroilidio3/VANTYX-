export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Subscribe notification handlers to the domain event bus exactly once
    // per server process (module guards re-registration on hot reload).
    const { initNotificationSubscriptions } = await import(
      "@/lib/services/notification.service"
    );
    initNotificationSubscriptions();
  }
}
