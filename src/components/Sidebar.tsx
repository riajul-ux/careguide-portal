"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, ListChecks, FolderOpen, Upload, AlertTriangle, BarChart3, SlidersHorizontal, Settings, ClipboardList, HeartPulse } from "lucide-react";

const NAV = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/follow-ups", label: "My Follow-Ups", icon: ListChecks },
  { href: "/cases", label: "Cases", icon: FolderOpen },
  { href: "/import", label: "Import", icon: Upload },
  { href: "/escalations", label: "Escalations", icon: AlertTriangle, badge: "esc" },
  { href: "/review", label: "Needs Review", icon: ClipboardList, badge: "review" },
  { href: "/reports", label: "Reports", icon: BarChart3 },
  { href: "/rules", label: "Rules", icon: SlidersHorizontal },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;

export function Sidebar({ role, reviewCount, escalationCount }: { role: string; reviewCount: number; escalationCount: number }) {
  const path = usePathname();
  return (
    <aside className="sticky top-0 flex h-screen w-60 shrink-0 flex-col bg-brand-800 text-slate-200">
      <div className="flex h-14 items-center gap-2 border-b border-white/10 px-5">
        <HeartPulse className="h-5 w-5 text-sky-300" />
        <div>
          <div className="text-sm font-semibold text-white">CareGuide Portal</div>
          <div className="text-[11px] text-slate-400">Intake &amp; Follow-Up</div>
        </div>
      </div>
      <nav className="flex-1 space-y-0.5 p-3">
        {NAV.map((n) => {
          const active = n.href === "/" ? path === "/" : path.startsWith(n.href);
          const Icon = n.icon;
          const count = "badge" in n ? (n.badge === "esc" ? escalationCount : reviewCount) : 0;
          return (
            <Link
              key={n.href}
              href={n.href}
              className={`flex items-center gap-2.5 rounded-md px-3 py-2 text-sm ${active ? "bg-white/15 font-medium text-white" : "text-slate-300 hover:bg-white/5 hover:text-white"}`}
            >
              <Icon className="h-4 w-4" />
              <span className="flex-1">{n.label}</span>
              {count > 0 && <span className="rounded-full bg-white/15 px-2 py-0.5 text-[11px] text-white">{count}</span>}
            </Link>
          );
        })}
      </nav>
      <div className="border-t border-white/10 p-4 text-[11px] text-slate-400">
        Viewing as <span className="text-slate-200">{role.toLowerCase()}</span>
        <br />
        MVP - demo data only, no real authentication
      </div>
    </aside>
  );
}
