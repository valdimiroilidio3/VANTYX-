import { cookies } from "next/headers";
import { routeHandler } from "@/lib/api/respond";
import { SESSION_COOKIE } from "@/lib/auth/context";
import { logout } from "@/lib/services/session.service";

export const dynamic = "force-dynamic";

export const POST = routeHandler(async () => {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (token) await logout(token);
  cookieStore.delete(SESSION_COOKIE);
  return { loggedOut: true };
});
