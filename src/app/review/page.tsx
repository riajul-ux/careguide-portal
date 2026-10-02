import Link from "next/link";
import { prisma } from "@/lib/db";
import { fmtDate } from "@/lib/time";
import { REVIEW_TYPES } from "@/lib/constants";
import { Badge, Card, Empty, PageHeader } from "@/components/ui";
import { assignAction } from "@/app/actions";

export const dynamic = "force-dynamic";
const LIMIT = 200;

export default async function Review({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const base = { caseState: { in: ["ACTIVE", "SUPERVISOR_REVIEW"] }, dataIssuesJson: { not: "[]" } };
  const all = await prisma.case.findMany({ where: { ...base, ...(sp.department ? { department: sp.department } : {}) }, select: { dataIssuesJson: true } });
  const counts = new Map<string, number>();
  for (const c of all) for (const i of JSON.parse(c.dataIssuesJson ?? "[]") as string[]) counts.set(i, (counts.get(i) ?? 0) + 1);

  const where = { ...base, ...(sp.department ? { department: sp.department } : {}), ...(sp.type ? { dataIssuesJson: { contains: `"${sp.type}"` } } : {}) };
  const [total, cases, coordinators] = await Promise.all([
    prisma.case.count({ where }),
    prisma.case.findMany({ where, orderBy: { lastNoteDate: "desc" }, take: LIMIT }),
    prisma.user.findMany({ where: { role: "COORDINATOR", isActive: true }, orderBy: { name: "asc" } }),
  ]);
  const label = (v: string) => REVIEW_TYPES.find((r) => r.value === v)?.label ?? v;
  const href = (type?: string) => `/review?${new URLSearchParams({ ...(type ? { type } : {}), ...(sp.department ? { department: sp.department } : {}) })}`;

  return (
    <div>
      <PageHeader title="Needs Review" subtitle="Open cases the system will not guess about. Fix the data or make the decision, and the case leaves this queue automatically." />
      <div className="mb-4 flex flex-wrap gap-2">
        <Link href={href()} className={!sp.type ? "btn-primary" : "btn"}>All ({all.length})</Link>
        {REVIEW_TYPES.map((r) => (
          <Link key={r.value} href={href(r.value)} className={sp.type === r.value ? "btn-primary" : "btn"}>
            {r.label} ({counts.get(r.value) ?? 0})
          </Link>
        ))}
      </div>
      <form action={assignAction}>
        <Card
          title={`${sp.type ? label(sp.type) : "All issues"}${sp.department ? ` - ${sp.department}` : ""}: ${total} case${total === 1 ? "" : "s"}${total > LIMIT ? ` (showing ${LIMIT})` : ""}`}
          actions={
            <div className="flex items-center gap-2">
              <select name="coordinator" className="input" defaultValue="">
                <option value="" disabled>Assign selected to...</option>
                {coordinators.map((c) => <option key={c.id}>{c.name}</option>)}
              </select>
              <button className="btn">Assign</button>
            </div>
          }
        >
          {cases.length === 0 ? (
            <Empty>Nothing to review.</Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="table-base">
                <thead><tr><th className="w-8"></th><th>Patient / Referral</th><th>Department</th><th>Status</th><th>Coordinator</th><th>Last Note</th><th>Issues</th><th></th></tr></thead>
                <tbody>
                  {cases.map((c) => (
                    <tr key={c.id}>
                      <td><input type="checkbox" name="caseId" value={c.id} aria-label={`Select ${c.referralId}`} /></td>
                      <td><Link href={`/cases/${c.id}`} className="font-medium text-brand-700 hover:underline">{c.patientName ?? "(no name)"}</Link><div className="text-xs text-slate-500">#{c.referralId}</div></td>
                      <td>{c.department ?? <span className="text-amber-700">Missing</span>}</td>
                      <td className="max-w-48">{c.currentStatus ?? <span className="text-amber-700">Unknown</span>}</td>
                      <td>{c.assignedCoordinator ?? <span className="text-amber-700">Unassigned</span>}</td>
                      <td className="max-w-72"><div className="truncate text-slate-600" title={c.lastNote ?? ""}>{c.lastNote ?? "—"}</div><div className="text-xs text-slate-500">{fmtDate(c.lastNoteDate)}</div></td>
                      <td><div className="flex flex-wrap gap-1">{(JSON.parse(c.dataIssuesJson ?? "[]") as string[]).map((i) => <Badge key={i} tone="amber">{label(i)}</Badge>)}</div></td>
                      <td><Link className="btn" href={`/cases/${c.id}`}>Open</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </form>
    </div>
  );
}
