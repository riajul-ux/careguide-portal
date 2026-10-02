import Link from "next/link";
import { format } from "date-fns";
import { reportData } from "@/services/queries";
import { outcomeLabel } from "@/lib/constants";
import { Card, KpiCard, PageHeader } from "@/components/ui";
import { DepartmentChart, TrendChart } from "@/components/Charts";

export const dynamic = "force-dynamic";

export default async function Reports({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const r = await reportData(sp.from, sp.to);
  const range = `${format(r.from, "MM/dd/yyyy")} - ${format(r.to, "MM/dd/yyyy")}`;
  return (
    <div className="space-y-5">
      <PageHeader title="Reports" subtitle={`Operational follow-up metrics for ${range}. "Overdue", "cases without next action" and "average active cases" are current snapshots.`} />
      <form method="get" className="card flex flex-wrap items-end gap-3 p-3">
        <div><label className="label">From</label><input type="date" name="from" defaultValue={format(r.from, "yyyy-MM-dd")} className="input" /></div>
        <div><label className="label">To</label><input type="date" name="to" defaultValue={format(r.to, "yyyy-MM-dd")} className="input" /></div>
        <button className="btn-primary">Apply</button>
        <Link className="btn" href={`/reports?from=${format(new Date(), "yyyy-MM-dd")}&to=${format(new Date(), "yyyy-MM-dd")}`}>Today</Link>
        <Link className="btn" href="/reports">Last 14 days</Link>
      </form>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <KpiCard label="Follow-ups completed" value={r.completed} tone="green" />
        <KpiCard label="Follow-ups overdue (now)" value={r.overdueNow} tone="red" href="/follow-ups?coordinator=__all&state=OVERDUE" />
        <KpiCard label="No-answer attempts" value={r.noAnswerAttempts} tone="gray" />
        <KpiCard label="Escalations created" value={r.escalationsCreated} tone="orange" href="/escalations?show=all" />
        <KpiCard label="Cases without next action" value={r.casesWithoutNextAction} tone="red" href="/review?type=NO_FUTURE_FOLLOWUP" />
        <KpiCard label="Avg active cases / coordinator" value={r.avgActivePerCoordinator} />
      </div>
      <div className="grid gap-5 xl:grid-cols-2">
        <Card title="Follow-ups completed per day"><TrendChart data={r.byDay} label="Completed" /></Card>
        <Card title="Follow-ups completed by department"><DepartmentChart data={r.byDepartment.map((d) => ({ name: d.name, value: d.completed }))} label="Completed" /></Card>
        <Card title="Follow-ups by coordinator">
          <table className="table-base">
            <thead><tr><th>Coordinator</th><th className="text-right">Completed</th><th className="text-right">No-answer attempts</th><th className="text-right">Active cases (now)</th></tr></thead>
            <tbody>{r.byCoordinator.map((c) => <tr key={c.name}><td>{c.name}</td><td className="text-right tabular-nums">{c.completed}</td><td className="text-right tabular-nums">{c.noAnswer}</td><td className="text-right tabular-nums">{c.activeCases}</td></tr>)}</tbody>
          </table>
        </Card>
        <Card title="Outcomes recorded">
          <table className="table-base">
            <thead><tr><th>Outcome</th><th className="text-right">Count</th></tr></thead>
            <tbody>{r.outcomes.map((o) => <tr key={o.outcome}><td>{outcomeLabel(o.outcome)}</td><td className="text-right tabular-nums">{o.count}</td></tr>)}</tbody>
          </table>
          <table className="table-base mt-4">
            <thead><tr><th>Department</th><th className="text-right">Completed</th><th className="text-right">No-answer attempts</th></tr></thead>
            <tbody>{r.byDepartment.map((d) => <tr key={d.name}><td>{d.name}</td><td className="text-right tabular-nums">{d.completed}</td><td className="text-right tabular-nums">{d.noAnswer}</td></tr>)}</tbody>
          </table>
        </Card>
      </div>
    </div>
  );
}
