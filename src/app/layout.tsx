import type { Metadata } from "next";
import "./globals.css";
import { Sidebar } from "@/components/Sidebar";
import { RoleSwitcher } from "@/components/RoleSwitcher";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { DEMO_USERS } from "@/lib/demoData";
import { format } from "date-fns";
import { refreshDemoIfStale } from "@/lib/seedDemo";

export const metadata: Metadata = {
  title: "CareGuide Portal",
  description: "Home care intake & follow-up management",
};

export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  await refreshDemoIfStale();
  const user = await getCurrentUser();
  const demoUsers = await prisma.user.findMany({ where: { isDemo: true } });
  const labels = new Map<string, string>(DEMO_USERS.map((u) => [u.name, u.label]));
  const options = demoUsers
    .map((u) => ({ id: u.id, name: u.name, label: labels.get(u.name) ?? u.role }))
    .sort((a, b) => DEMO_USERS.findIndex((d) => d.name === a.name) - DEMO_USERS.findIndex((d) => d.name === b.name));
  const reviewCount = await prisma.case.count({ where: { dataIssuesJson: { not: "[]" }, caseState: { in: ["ACTIVE", "SUPERVISOR_REVIEW"] } } });
  const escCount = await prisma.escalation.count({ where: { status: { in: ["OPEN", "REVIEWED"] } } });

  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <div className="flex min-h-screen">
          <Sidebar role={user.role} reviewCount={reviewCount} escalationCount={escCount} />
          <div className="flex min-w-0 flex-1 flex-col">
            <header className="flex h-14 items-center justify-between border-b border-slate-200 bg-white px-6">
              <div className="text-sm text-slate-500">
                {format(new Date(), "EEEE, MMMM d, yyyy")} <span className="mx-2 text-slate-300">|</span> Data source: CSV import (HHAeXchange not connected)
              </div>
              <RoleSwitcher current={user.id} currentName={user.name} options={options} />
            </header>
            {process.env.DEMO_MODE === "true" && (
              <div className="border-b border-amber-200 bg-amber-50 px-6 py-2 text-sm text-amber-900">
                <strong>Public demo</strong> - all patients and data are fake and reset daily. Do not upload real patient information (no PHI).
              </div>
            )}
            <main className="flex-1 p-6">{children}</main>
          </div>
        </div>
      </body>
    </html>
  );
}
