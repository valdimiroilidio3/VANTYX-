import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth/context";
import { getDb } from "@/lib/db/client";

export const dynamic = "force-dynamic";

export default async function RootPage() {
  const ctx = await getAuthContext();
  if (!ctx) {
    // No session: show onboarding when the platform has no organizations yet
    const orgCount = (
      (await getDb().prepare(`SELECT COUNT(*) c FROM organizations`).get()) as { c: number }
    ).c;
    redirect(orgCount === 0 ? "/onboarding" : "/login");
  }
  redirect("/dashboard");
}
