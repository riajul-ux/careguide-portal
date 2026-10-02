import Link from "next/link";
import { TASK_STATE_LABEL, type TaskState } from "@/lib/constants";

const STATE_STYLE: Record<TaskState, string> = {
  OVERDUE: "bg-red-50 text-red-700 ring-red-200",
  DUE_TODAY: "bg-orange-50 text-orange-700 ring-orange-200",
  DUE_LATER_TODAY: "bg-amber-50 text-amber-800 ring-amber-200",
  UPCOMING: "bg-blue-50 text-blue-700 ring-blue-200",
  WAITING: "bg-slate-100 text-slate-600 ring-slate-200",
  COMPLETED: "bg-green-50 text-green-700 ring-green-200",
  SUPERVISOR_REVIEW: "bg-orange-50 text-orange-800 ring-orange-300",
};

export function TaskStateBadge({ state }: { state: TaskState }) {
  return <span className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${STATE_STYLE[state]}`}>{TASK_STATE_LABEL[state]}</span>;
}

export function Badge({ children, tone = "slate" }: { children: React.ReactNode; tone?: "slate" | "red" | "orange" | "green" | "blue" | "amber" | "purple" }) {
  const tones = {
    slate: "bg-slate-100 text-slate-700 ring-slate-200",
    red: "bg-red-50 text-red-700 ring-red-200",
    orange: "bg-orange-50 text-orange-700 ring-orange-200",
    green: "bg-green-50 text-green-700 ring-green-200",
    blue: "bg-blue-50 text-blue-700 ring-blue-200",
    amber: "bg-amber-50 text-amber-800 ring-amber-200",
    purple: "bg-violet-50 text-violet-700 ring-violet-200",
  };
  return <span className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${tones[tone]}`}>{children}</span>;
}

export function CaseStateBadge({ state }: { state: string }) {
  const map: Record<string, [string, "slate" | "orange" | "green" | "blue"]> = {
    ACTIVE: ["Active", "blue"],
    SUPERVISOR_REVIEW: ["Supervisor Review", "orange"],
    HOLD: ["Hold", "slate"],
    RESOLVED: ["Resolved", "green"],
    CLOSED: ["Closed", "slate"],
  };
  const [label, tone] = map[state] ?? [state, "slate"];
  return <Badge tone={tone}>{label}</Badge>;
}

export function ConfidenceBadge({ confidence }: { confidence: string | null | undefined }) {
  if (!confidence) return <Badge>—</Badge>;
  const tone = confidence === "HIGH" ? "green" : confidence === "MEDIUM" ? "blue" : "amber";
  return <Badge tone={tone}>{confidence.charAt(0) + confidence.slice(1).toLowerCase()} confidence</Badge>;
}

export function KpiCard({ label, value, href, tone = "default", hint }: { label: string; value: number | string; href?: string; tone?: "default" | "red" | "orange" | "blue" | "green" | "gray"; hint?: string }) {
  const accent = {
    default: "border-l-slate-300",
    red: "border-l-red-500",
    orange: "border-l-orange-400",
    blue: "border-l-blue-500",
    green: "border-l-green-500",
    gray: "border-l-slate-400",
  }[tone];
  const body = (
    <div className={`card h-full border-l-4 ${accent} px-4 py-3 ${href ? "transition hover:shadow-md" : ""}`} title={hint}>
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{value}</div>
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-5 flex items-start justify-between gap-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, children, actions, className = "" }: { title?: React.ReactNode; children: React.ReactNode; actions?: React.ReactNode; className?: string }) {
  return (
    <section className={`card ${className}`}>
      {title && (
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
          <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
          {actions}
        </div>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-0.5 text-sm text-slate-800">{children ?? "—"}</div>
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="py-10 text-center text-sm text-slate-500">{children}</div>;
}
