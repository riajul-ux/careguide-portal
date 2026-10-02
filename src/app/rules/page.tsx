import { prisma } from "@/lib/db";
import { getCurrentUser, isSupervisorLike } from "@/lib/session";
import { Badge, Card, PageHeader } from "@/components/ui";
import { RuleEditor, ReapplyButton } from "@/components/RuleEditor";

export const dynamic = "force-dynamic";

export default async function Rules({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const user = await getCurrentUser();
  const canEdit = isSupervisorLike(user);
  const [rules, departments, counts] = await Promise.all([
    prisma.statusRule.findMany(),
    prisma.department.findMany({ orderBy: { sortOrder: "asc" } }),
    prisma.case.groupBy({ by: ["statusRuleId"], where: { caseState: { in: ["ACTIVE", "SUPERVISOR_REVIEW"] } }, _count: true }),
  ]);
  const caseCount = new Map(counts.map((c) => [c.statusRuleId, c._count]));
  const order = departments.map((d) => d.name);
  const sorted = [...rules].sort((a, b) => {
    const oa = a.outcome ? -1 : order.indexOf(a.department ?? "") < 0 ? 98 : order.indexOf(a.department ?? "");
    const ob = b.outcome ? -1 : order.indexOf(b.department ?? "") < 0 ? 98 : order.indexOf(b.department ?? "");
    return oa - ob || (a.status ? 1 : 0) - (b.status ? 1 : 0) || (a.status ?? "").localeCompare(b.status ?? "");
  });
  const editing = sp.edit ? rules.find((r) => r.id === sp.edit) : null;
  const filtered = sp.dept ? sorted.filter((r) => (r.department ?? "") === sp.dept || (sp.dept === "(outcome rules)" && r.outcome)) : sorted;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Admin > Follow-Up Rules"
        subtitle="Rules live in the database (StatusRule table). Changes take effect immediately for new follow-ups; use 'Re-apply' to recalculate open rule-generated tasks. All changes are audit-logged."
        actions={canEdit && <><ReapplyButton /><a className="btn-primary" href="/rules?edit=new#editor">New rule</a></>}
      />
      {!canEdit && <p className="rounded-md bg-slate-100 p-3 text-sm text-slate-600">Read-only. Switch to the Supervisor or Admin role (top right) to edit rules.</p>}

      {canEdit && (sp.edit === "new" || editing) && (
        <div id="editor">
          <Card title={editing ? `Edit rule: ${editing.status ?? editing.process ?? editing.department}` : "New rule"}>
            <RuleEditor key={editing?.id ?? "new"} rule={editing ?? null} departments={departments.map((d) => d.name)} />
          </Card>
        </div>
      )}

      <div className="flex flex-wrap gap-2 text-sm">
        <a className={!sp.dept ? "btn-primary" : "btn"} href="/rules">All ({rules.length})</a>
        <a className={sp.dept === "(outcome rules)" ? "btn-primary" : "btn"} href="/rules?dept=(outcome rules)">Outcome rules</a>
        {order.map((d) => <a key={d} className={sp.dept === d ? "btn-primary" : "btn"} href={`/rules?dept=${encodeURIComponent(d)}`}>{d}</a>)}
      </div>

      <Card>
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th>Status / Outcome</th><th>Department</th><th>Process</th><th>Stage</th>
                <th className="text-right">Interval (days)</th><th className="text-right">Same-day retry (h)</th><th className="text-right">Max attempts</th><th className="text-right">Escalate after</th>
                <th>State</th><th className="text-right">Open cases</th><th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} className={!r.isActive ? "opacity-60" : ""}>
                  <td className="min-w-72 max-w-md"><div className="font-medium">{r.outcome ? <span>{r.department ? `${r.department} + ` : ""}{r.outcome === "NO_ANSWER" ? "No Answer / Phone Not Answered" : r.outcome}</span> : r.status ?? <span className="italic text-slate-500">Department default</span>}</div>{r.instructions && <div className="mt-0.5 text-xs text-slate-500">{r.instructions}</div>}</td>
                  <td>{r.department ?? "—"}</td>
                  <td>{r.process ?? "—"}</td>
                  <td>{r.stage ?? "—"}</td>
                  <td className="text-right tabular-nums">{r.followUpIntervalDays ?? "—"}</td>
                  <td className="text-right tabular-nums">{r.sameDayRetryHours ?? "—"}</td>
                  <td className="text-right tabular-nums">{r.maximumAttempts ?? "—"}</td>
                  <td className="text-right tabular-nums">{r.escalateAfterAttempts ?? "—"}</td>
                  <td>
                    <div className="flex flex-wrap gap-1">
                      {!r.isActive && <Badge>Inactive</Badge>}
                      {r.isActive && !r.isConfigured && <Badge tone="amber">{/H-?78/i.test(r.status ?? "") ? "Duration not configured" : "Rule not configured"}</Badge>}
                      {r.isTerminal && <Badge>Closed</Badge>}
                      {r.isHold && <Badge>Hold</Badge>}
                      {r.requiresSupervisorReview && <Badge tone="orange">Supervisor review</Badge>}
                      {r.needsConfirmation && <Badge tone="purple">Placeholder - confirm</Badge>}
                      {r.isActive && r.isConfigured && !r.isTerminal && !r.isHold && !r.needsConfirmation && <Badge tone="green">Active</Badge>}
                    </div>
                  </td>
                  <td className="text-right tabular-nums">{caseCount.get(r.id) ?? 0}</td>
                  <td>{canEdit && <a className="btn !px-2 !py-1 !text-xs" href={`/rules?edit=${r.id}#editor`}>Edit</a>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
