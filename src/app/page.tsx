import Link from "next/link";
import { getCurrentUser, isSupervisorLike } from "@/lib/session";
import { coordinatorKpis, getWorkItems, supervisorOverview } from "@/services/queries";
import { Card, KpiCard, PageHeader } from "@/components/ui";
import { WorkTable } from "@/components/WorkTable";
import { DepartmentChart } from "@/components/Charts";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const user = await getCurrentUser();
  if (isSupervisorLike(user)) return <SupervisorDashboard name={user.name} />;
  return <CoordinatorDashboard name={user.name} department={user.department} />;
}

async function CoordinatorDashboard({ name, department }: { name: string; department: string | null }) {
  const [k, items] = await Promise.all([coordinatorKpis(name), getWorkItems({ coordinator: name })]);
  const q = (state: string) => `/follow-ups?state=${state}`;
  return (
    <div>
      <PageHeader title={`Good day, ${name.split(" ")[0]}`} subtitle={`Coordinator dashboard${department ? ` - ${department}` : ""}. Work the list top to bottom: overdue first, then due now, then later today.`} />
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <KpiCard label="Active Cases" value={k.activeCases} href={`/cases?coordinator=${encodeURIComponent(name)}&active=1`} />
        <KpiCard label="Overdue" value={k.overdue} tone="red" href={q("OVERDUE")} />
        <KpiCard label="Due Today" value={k.dueToday} tone="orange" href={q("DUE_TODAY")} />
        <KpiCard label="Due Later Today" value={k.dueLaterToday} tone="orange" href={q("DUE_LATER_TODAY")} />
        <KpiCard label="Upcoming" value={k.upcoming} tone="blue" href={q("UPCOMING")} />
        <KpiCard label="Waiting" value={k.waiting} tone="gray" href={q("WAITING")} />
        <KpiCard label="Completed Today" value={k.completedToday} tone="green" href={q("COMPLETED")} />
        <KpiCard label="Supervisor Review" value={k.supervisorReview} tone="orange" href={`/cases?coordinator=${encodeURIComponent(name)}&caseState=SUPERVISOR_REVIEW`} />
      </div>
      <Card title="Prioritized follow-ups" actions={<Link href="/follow-ups" className="text-sm text-brand-700 hover:underline">Open full list &rarr;</Link>}>
        <WorkTable items={items} limit={40} />
      </Card>
    </div>
  );
}

async function SupervisorDashboard({ name }: { name: string }) {
  const o = await supervisorOverview();
  const fu = (params: string) => `/follow-ups?coordinator=__all&${params}`;
  return (
    <div>
      <PageHeader title="Supervisor overview" subtitle={`Operational facts for today. A completed call with "No Answer" counts as a completed required task. Signed in as ${name}.`} />
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <KpiCard label="Total Active Cases" value={o.totalActive} href="/cases?active=1" />
        <KpiCard label="Due Today" value={o.dueToday} tone="orange" href={fu("state=TODAY")} hint="Tasks due today (open) plus tasks due today or earlier that were completed today" />
        <KpiCard label="Completed Today" value={o.completedToday} tone="green" href={fu("state=COMPLETED")} />
        <KpiCard label="Still Due" value={o.stillDue} tone="orange" href={fu("state=REMAINING")} hint="Open tasks due today or earlier" />
        <KpiCard label="Overdue" value={o.overdue} tone="red" href={fu("state=OVERDUE")} />
        <KpiCard label="Waiting" value={o.waiting} tone="gray" href={fu("state=WAITING")} />
        <KpiCard label="Supervisor Escalations" value={o.escalations} tone="orange" href="/escalations" />
        <KpiCard label="Missing Future Follow-Up" value={o.missingFollowUp} tone="red" href="/review?type=NO_FUTURE_FOLLOWUP" />
      </div>

      <div className="grid gap-5 2xl:grid-cols-2">
        <Card title="Coordinator workload - today">
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>Coordinator</th>
                  <th className="text-right">Active Cases</th>
                  <th className="text-right">Due Today</th>
                  <th className="text-right">Worked Today</th>
                  <th className="text-right">Remaining Today</th>
                  <th className="text-right">Overdue</th>
                  <th className="text-right">Escalated</th>
                </tr>
              </thead>
              <tbody>
                {o.team.map((r) => {
                  const c = r.coordinator === "Unassigned" ? null : encodeURIComponent(r.coordinator);
                  const cell = (v: number, href: string | null) => (href && v > 0 ? <Link className="text-brand-700 hover:underline" href={href}>{v}</Link> : v);
                  return (
                    <tr key={r.coordinator}>
                      <td className="font-medium">{c ? r.coordinator : <Link className="text-amber-700 hover:underline" href="/review?type=MISSING_COORDINATOR">Unassigned</Link>}</td>
                      <td className="text-right tabular-nums">{cell(r.activeCases, c && `/cases?coordinator=${c}&active=1`)}</td>
                      <td className="text-right tabular-nums">{cell(r.dueToday, c && `/follow-ups?coordinator=${c}&state=TODAY`)}</td>
                      <td className="text-right tabular-nums">{cell(r.workedToday, c && `/follow-ups?coordinator=${c}&state=COMPLETED`)}</td>
                      <td className="text-right tabular-nums">{cell(r.remainingToday, c && `/follow-ups?coordinator=${c}&state=REMAINING`)}</td>
                      <td className="text-right tabular-nums">{cell(r.overdue, c && `/follow-ups?coordinator=${c}&state=OVERDUE`)}</td>
                      <td className="text-right tabular-nums">{cell(r.escalated, c && `/escalations?coordinator=${c}`)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-slate-500">Due Today = open tasks due today + tasks due today or earlier completed today. Remaining Today = open tasks due today or earlier (includes overdue).</p>
        </Card>

        <Card title="Department breakdown">
          <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-1">
          <DepartmentChart data={o.departments.filter((d) => d.active > 0).map((d) => ({ name: d.department, value: d.active }))} label="Active cases" />
          <div className="overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th>Department</th>
                <th className="text-right">Active</th>
                <th className="text-right">Overdue</th>
                <th className="text-right">Due Today</th>
                <th className="text-right">Done Today</th>
                <th className="text-right">No Follow-Up</th>
              </tr>
            </thead>
            <tbody>
              {o.departments.map((d) => {
                const dep = encodeURIComponent(d.department);
                return (
                  <tr key={d.department}>
                    <td className="font-medium">{d.department}</td>
                    <td className="text-right tabular-nums"><Link className="hover:underline" href={`/cases?department=${dep}&active=1`}>{d.active}</Link></td>
                    <td className="text-right tabular-nums"><Link className="hover:underline" href={fu(`department=${dep}&state=OVERDUE`)}>{d.overdue}</Link></td>
                    <td className="text-right tabular-nums"><Link className="hover:underline" href={fu(`department=${dep}&state=TODAY`)}>{d.dueToday}</Link></td>
                    <td className="text-right tabular-nums"><Link className="hover:underline" href={fu(`department=${dep}&state=COMPLETED`)}>{d.completedToday}</Link></td>
                    <td className="text-right tabular-nums"><Link className="hover:underline" href={`/review?type=NO_FUTURE_FOLLOWUP&department=${dep}`}>{d.missingFollowUp}</Link></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
