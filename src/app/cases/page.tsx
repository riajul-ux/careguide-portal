import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { fmtDate, fmtDue } from "@/lib/time";
import { CASE_STATES, OPEN_CASE_STATES } from "@/lib/constants";
import { categorizeTask } from "@/services/followUpEngine";
import { filterOptions } from "@/services/queries";
import { Badge, Card, CaseStateBadge, Empty, PageHeader, TaskStateBadge } from "@/components/ui";

export const dynamic = "force-dynamic";
const PAGE = 50;

export default async function Cases({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? 1));
  const where: Prisma.CaseWhereInput = {};
  if (sp.q) where.OR = [{ referralId: { contains: sp.q } }, { patientName: { contains: sp.q } }, { lastNote: { contains: sp.q } }];
  if (sp.department) where.department = sp.department;
  if (sp.status) where.currentStatus = sp.status;
  if (sp.coordinator && sp.coordinator !== "__all") where.assignedCoordinator = sp.coordinator;
  if (sp.caseState) where.caseState = sp.caseState;
  else if (sp.active === "1") where.caseState = { in: OPEN_CASE_STATES };

  const [total, cases, options] = await Promise.all([
    prisma.case.count({ where }),
    prisma.case.findMany({
      where,
      orderBy: [{ lastNoteDate: "desc" }],
      skip: (page - 1) * PAGE,
      take: PAGE,
      include: { tasks: { where: { status: "OPEN", taskType: { not: "SUPERVISOR_REVIEW" } }, orderBy: { dueDate: "asc" }, take: 1 } },
    }),
    filterOptions(),
  ]);
  const now = new Date();
  const qs = (p: number) => {
    const u = new URLSearchParams(Object.entries(sp).filter(([, v]) => v) as [string, string][]);
    u.set("page", String(p));
    return `/cases?${u.toString()}`;
  };

  return (
    <div>
      <PageHeader title="Cases" subtitle={`${total.toLocaleString()} case${total === 1 ? "" : "s"}. A case stays open until it is resolved or closed - follow-up tasks are tracked separately.`} />
      <form method="get" className="card mb-4 flex flex-wrap items-end gap-3 p-3">
        <div className="min-w-56 flex-1">
          <label className="label">Search</label>
          <input name="q" defaultValue={sp.q} className="input w-full" placeholder="Patient name, referral ID or note text" />
        </div>
        <div>
          <label className="label">Department</label>
          <select name="department" defaultValue={sp.department ?? ""} className="input"><option value="">All</option>{options.departments.map((d) => <option key={d}>{d}</option>)}</select>
        </div>
        <div>
          <label className="label">Status</label>
          <select name="status" defaultValue={sp.status ?? ""} className="input max-w-52"><option value="">All</option>{options.statuses.map((d) => <option key={d}>{d}</option>)}</select>
        </div>
        <div>
          <label className="label">Coordinator</label>
          <select name="coordinator" defaultValue={sp.coordinator ?? ""} className="input"><option value="">All</option>{options.coordinators.map((d) => <option key={d}>{d}</option>)}</select>
        </div>
        <div>
          <label className="label">Case state</label>
          <select name="caseState" defaultValue={sp.caseState ?? ""} className="input"><option value="">Any</option>{CASE_STATES.map((s) => <option key={s} value={s}>{s.replace("_", " ").toLowerCase()}</option>)}</select>
        </div>
        <label className="flex items-center gap-1.5 pb-2 text-sm"><input type="checkbox" name="active" value="1" defaultChecked={sp.active === "1"} /> Open only</label>
        <button className="btn-primary">Apply</button>
        <a className="btn" href="/cases">Reset</a>
      </form>
      <Card>
        {cases.length === 0 ? (
          <Empty>No cases found.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr><th>Patient / Referral</th><th>Department</th><th>Status</th><th>Coordinator</th><th>Case</th><th>Last Note</th><th>Next Follow-up</th><th>Review</th></tr>
              </thead>
              <tbody>
                {cases.map((c) => {
                  const t = c.tasks[0];
                  const issues: string[] = JSON.parse(c.dataIssuesJson ?? "[]");
                  return (
                    <tr key={c.id}>
                      <td><Link href={`/cases/${c.id}`} className="font-medium text-brand-700 hover:underline">{c.patientName ?? "(no name)"}</Link><div className="text-xs text-slate-500">#{c.referralId}</div></td>
                      <td className="whitespace-nowrap">{c.department ?? <span className="text-amber-700">Missing</span>}</td>
                      <td className="max-w-48">{c.currentStatus ?? <span className="text-amber-700">Unknown</span>}</td>
                      <td className="whitespace-nowrap">{c.assignedCoordinator ?? <span className="text-amber-700">Unassigned</span>}</td>
                      <td><CaseStateBadge state={c.caseState} /></td>
                      <td className="max-w-72"><div className="truncate text-slate-600" title={c.lastNote ?? ""}>{c.lastNote ?? "—"}</div><div className="text-xs text-slate-500">{fmtDate(c.lastNoteDate)}</div></td>
                      <td className="whitespace-nowrap">{t ? <div className="flex flex-col gap-1">{fmtDue(t.dueDate, t.hasDueTime)}<TaskStateBadge state={categorizeTask(t, now)} /></div> : "—"}</td>
                      <td>{issues.length > 0 && <Badge tone="amber">{issues.length} issue{issues.length > 1 ? "s" : ""}</Badge>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {total > PAGE && (
          <div className="flex items-center justify-between pt-3 text-sm text-slate-600">
            <span>Page {page} of {Math.ceil(total / PAGE)}</span>
            <div className="flex gap-2">
              {page > 1 && <Link className="btn" href={qs(page - 1)}>Previous</Link>}
              {page * PAGE < total && <Link className="btn" href={qs(page + 1)}>Next</Link>}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
