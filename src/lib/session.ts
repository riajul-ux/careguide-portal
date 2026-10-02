import { cookies } from "next/headers";
import { prisma } from "./db";

export const SESSION_COOKIE = "careguide_demo_user";

export interface CurrentUser {
  id: string;
  name: string;
  role: "COORDINATOR" | "SUPERVISOR" | "ADMIN";
  department: string | null;
}

/** Demo-only "login": the role switcher stores a user id in a cookie. No real auth in the MVP. */
export async function getCurrentUser(): Promise<CurrentUser> {
  const jar = await cookies();
  const id = jar.get(SESSION_COOKIE)?.value;
  let user = id ? await prisma.user.findUnique({ where: { id } }) : null;
  if (!user) user = await prisma.user.findFirst({ where: { isDemo: true, role: "COORDINATOR" }, orderBy: { name: "asc" } });
  if (!user) user = await prisma.user.findFirst();
  if (!user) return { id: "", name: "System", role: "ADMIN", department: null };
  return { id: user.id, name: user.name, role: user.role as CurrentUser["role"], department: user.department };
}

export function isSupervisorLike(u: CurrentUser) {
  return u.role === "SUPERVISOR" || u.role === "ADMIN";
}
