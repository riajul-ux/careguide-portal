import { Fragment } from "react";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { getCurrentUser, isSupervisorLike } from "@/lib/session";
import { fmtDateTime } from "@/lib/time";
import { daysOpen, ESCALATION_ACTION_LABEL } from "@/services/escalationEngine";
import { Badge, Card, Empty, PageHeader } from "@/components/ui";
import { escalationAction } from "@/app/actions";

export const dynamic = "force-dynamic";

export default async function Escalations({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const user = await getCurrentUser();
  const canAct = isSupervisorLike(user);
  const showClosed = sp.show === "all";
  const escalations = await prisma.escalation.findMany({
    where: { ...(showClosed ? {} : { status: { in: ["OPEN", "REVIEWED"] } }), ...(sp.coordinator ? { coordinator: sp.coordinator } : {}) },
    include: { case: true },
    orderBy: { createdAt: "asc" },
  });
  const coordinators = await prisma.user.findMany({ where: { role: "COORDINATOR", isActive: true }, orderBy: { name: "asc" } });
  const now = new Date();

  return (
    <div>
      <PageHeader
        title="Supervisor escalation queue"
        subtitle={`${escalations.length} ${showClosed ? "escalations" : "open escalations"}${sp.coordinator ? ` for ${sp.coordinator}` : ""}. Escalated cases are never closed automatically.`}
        actions={<Link className="btn" href={showClosed ? "/escalations" : "/escalations?show=all"}>{showClosed ? "Show open only" : "Show all (incl. closed)"}</Link>}
      />
      {!canAct && <p className="mb-3 rounded-md bg-slate-100 p-3 text-sm text-slate-600">Switch to the Supervisor role (top right) to act on escalations.</p>}
      <Card>
        {escalations.length === 0 ? (
          <Empty>No escalations.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr><th>Patient</th><th>Referral ID</th><th>Coordinator</th><th>Department</th><th>Status</th><th>Attempts</th><th>Last Attempt</th><th className="min-w-56">Reason for escalation</th><th>Days open</th></tr>
              </thead>
              <tbody>
                {escalations.map((e) => (
                  <Fragment key={e.id}>
                  <tr className="[&>td]:border-b-0">
                    <td><Link href={`/cases/${e.caseId}`} className="font-medium text-brand-700 hover:underline">{e.case.patientName ?? "(no name)"}</Link></td>
                    <td>#{e.case.referralId}</td>
                    <td className="whitespace-nowrap">{e.coordinator ?? "—"}</td>
                    <td className="whitespace-nowrap">{e.department ?? "—"}</td>
                    <td>
                      <div className="text-slate-700">{e.case.currentStatus}</div>
                      <Badge tone={e.status === "OPEN" ? "orange" : e.status === "REVIEWED" ? "blue" : "green"}>{e.status.toLowerCase()}</Badge>
                    </td>
                    <td className="tabular-nums">{e.attempts}</td>
                    <td className="whitespace-nowrap">{fmtDateTime(e.lastAttemptAt)}</td>
                    <td className="text-slate-700">
                      {e.reason}
                      {e.supervisorInstruction && <div className="mt-1 whitespace-pre-wrap text-xs text-slate-500">Instruction: {e.supervisorInstruction}</div>}
                    </td>
                    <td className="tabular-nums">{daysOpen(e.createdAt, now)}</td>
                  </tr>
                  <tr>
                    <td colSpan={9} className="bg-slate-50/60">
                      {canAct && (e.status === "OPEN" || e.status === "REVIEWED") ? (
                        <form action={escalationAction} className="flex flex-wrap items-center gap-2">
                          <input type="hidden" name="escalationId" value={e.id} />
                          <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Supervisor actions</span>
                          <input name="instruction" className="input min-w-64 flex-1" placeholder="Instruction for coordinator (optional)" />
                          <select name="newCoordinator" className="input" defaultValue="" aria-label="Reassign to">
                            <option value="">Reassign to...</option>
                            {coordinators.filter((c) => c.name !== e.coordinator).map((c) => <option key={c.id}>{c.name}</option>)}
                          </select>
                          <input type="date" name="followUpDate" className="input" title="Follow-up date when returning (default today)" aria-label="Follow-up date" />
                          {(["RETURN", "REASSIGN", "INSTRUCTION", "REVIEWED", "CLOSE"] as const).map((a) => (
                            <button key={a} name="action" value={a} className={a === "RETURN" ? "btn-primary" : "btn"}>{ESCALATION_ACTION_LABEL[a]}</button>
                          ))}
                        </form>
                      ) : (
                        <span className="text-xs text-slate-500">{e.resolvedBy ? `${e.status.toLowerCase()} by ${e.resolvedBy}` : canAct ? "—" : "Supervisor role required to act."}</span>
                      )}
                    </td>
                  </tr>
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
