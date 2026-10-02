import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getCurrentUser, isSupervisorLike } from "@/lib/session";
import { fmtDate, fmtDateTime, fmtDue } from "@/lib/time";
import { REVIEW_TYPES, outcomeLabel } from "@/lib/constants";
import { attemptLabel, categorizeTask, describeRule, resolveNoAnswerPolicy, resolveStatusRule } from "@/services/followUpEngine";
import type { NoteInterpretation } from "@/services/noteInterpreter";
import { Badge, Card, CaseStateBadge, ConfidenceBadge, Field, TaskStateBadge } from "@/components/ui";
import { FollowUpForm } from "@/components/FollowUpForm";
import { ManualFollowUpForm } from "@/components/ManualFollowUpForm";
import { assignAction, confirmInterpretationAction, setDepartmentAction } from "@/app/actions";
import { AlertTriangle, ArrowLeft, Phone } from "lucide-react";

export const dynamic = "force-dynamic";

const HISTORY_LABEL: Record<string, string> = {
  FOLLOW_UP: "Follow-up",
  NOTE: "Note",
  STATUS_CHANGE: "Status change",
  ASSIGNMENT: "Assignment",
  ESCALATION: "Escalation",
  IMPORT: "Import",
  SUPERVISOR_ACTION: "Supervisor action",
  TASK_CREATED: "Task scheduled",
};

export default async function CasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  const c = await prisma.case.findUnique({
    where: { id },
    include: {
      tasks: { orderBy: { dueDate: "asc" } },
      history: { orderBy: { actionDate: "desc" } },
      escalations: { orderBy: { createdAt: "desc" } },
      statusRule: true,
    },
  });
  if (!c) notFound();
  const [rules, coordinators, departments, statusRows] = await Promise.all([
    prisma.statusRule.findMany(),
    prisma.user.findMany({ where: { role: "COORDINATOR", isActive: true }, orderBy: { name: "asc" } }),
    prisma.department.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" } }),
    prisma.statusRule.findMany({ where: { isActive: true, status: { not: null } }, select: { status: true }, orderBy: { status: "asc" } }),
  ]);
  const now = new Date();
  const rule = resolveStatusRule(rules, c.currentStatus, c.department);
  const policy = resolveNoAnswerPolicy(rules, c.department);
  const openTasks = c.tasks.filter((t) => t.status === "OPEN");
  const coordTask = openTasks.find((t) => t.taskType !== "SUPERVISOR_REVIEW") ?? null;
  const openEsc = c.escalations.find((e) => e.status === "OPEN" || e.status === "REVIEWED");
  let interp: NoteInterpretation | null = null;
  try {
    interp = c.interpretationJson ? JSON.parse(c.interpretationJson) : null;
  } catch {
    interp = null;
  }
  const issues: string[] = (() => {
    try {
      return JSON.parse(c.dataIssuesJson ?? "[]");
    } catch {
      return [];
    }
  })();
  const ruleNotConfigured = rule && !rule.isConfigured;
  const nextAttempt = c.noAnswerAttempts + 1;
  const attemptInfo = `${attemptLabel(nextAttempt, policy.maximumAttempts)}`;
  const nextAction = openEsc
    ? "Supervisor review required"
    : coordTask
      ? coordTask.reason
      : ruleNotConfigured
        ? "Rule not configured - set a manual follow-up date / supervisor review"
        : c.caseState === "ACTIVE"
          ? interp?.action ?? "Set next follow-up date"
          : "No follow-up required";

  return (
    <div className="space-y-5">
      <Link href="/follow-ups" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700"><ArrowLeft className="h-4 w-4" /> Back to follow-ups</Link>

      {/* Header */}
      <section className="card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Referral #{c.referralId}</div>
            <h1 className="text-2xl font-semibold text-slate-900">{c.patientName ?? "(no patient name)"}</h1>
            {(c.homePhone || c.phone2) && (
              <div className="mt-1 flex items-center gap-1.5 text-sm text-slate-600"><Phone className="h-3.5 w-3.5" /> {[c.homePhone, c.phone2].filter(Boolean).join(" / ")}</div>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <CaseStateBadge state={c.caseState} />
            {openEsc && <Badge tone="orange">Escalated</Badge>}
            {issues.map((i) => <Badge key={i} tone="amber">{REVIEW_TYPES.find((r) => r.value === i)?.label ?? i}</Badge>)}
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-4 xl:grid-cols-7">
          <Field label="Department">{c.department ?? <span className="text-amber-700">Missing</span>}</Field>
          <Field label="Status">{c.currentStatus ?? <span className="text-amber-700">Unknown</span>}</Field>
          <Field label="Assigned Coordinator">{c.assignedCoordinator ?? <span className="text-amber-700">Unassigned</span>}</Field>
          <Field label="Assigned Supervisor">{c.assignedSupervisor ?? "—"}</Field>
          <Field label="Received Date">{fmtDate(c.receivedDate)}</Field>
          <Field label="Intake Person">{c.intakePerson ?? "—"}</Field>
          <Field label="Referral Source">{c.referralSource ?? "—"}</Field>
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-3">
        {/* Workflow */}
        <Card title="Current workflow">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Current Process">{c.process ?? rule?.process ?? "—"}</Field>
            <Field label="Current Stage">{c.currentStage ?? rule?.stage ?? "—"}</Field>
            <div className="col-span-2"><Field label="Next Required Action"><span className="font-medium">{nextAction}</span></Field></div>
            <Field label="Next Follow-Up">
              {coordTask ? (
                <span className="flex flex-wrap items-center gap-2">{fmtDue(coordTask.dueDate, coordTask.hasDueTime)} <TaskStateBadge state={categorizeTask(coordTask, now)} /></span>
              ) : (
                <span className="text-amber-700">None scheduled</span>
              )}
            </Field>
            <Field label="Attempts">{c.noAnswerAttempts > 0 ? `${c.noAnswerAttempts} unsuccessful - next is ${attemptInfo}` : coordTask ? attemptLabel(coordTask.attemptNumber, coordTask.maxAttempts ?? policy.maximumAttempts) : "—"}</Field>
            <div className="col-span-2"><Field label="Reason">{coordTask?.reason ?? describeRule(rule)}</Field></div>
            <div className="col-span-2">
              <Field label="Rule">
                {rule ? (
                  <span className="flex flex-wrap items-center gap-2">
                    {describeRule(rule)}
                    {!rule.isConfigured && <Badge tone="amber">Rule not configured</Badge>}
                    {rule.needsConfirmation && <Badge tone="purple">Placeholder</Badge>}
                  </span>
                ) : (
                  <Badge tone="amber">No rule for this status</Badge>
                )}
              </Field>
            </div>
            <div className="col-span-2">
              <Field label="Escalation">
                {openEsc ? (
                  <span className="flex items-start gap-1.5 text-orange-800"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {openEsc.reason}{openEsc.supervisorInstruction && <><br />Instruction: {openEsc.supervisorInstruction}</>}</span>
                ) : (
                  "None"
                )}
              </Field>
            </div>
          </div>
        </Card>

        {/* Latest note */}
        <Card title="Latest note">
          <Field label="Last Note Date">{fmtDateTime(c.lastNoteDate)}</Field>
          <blockquote className="mt-3 whitespace-pre-wrap rounded-md border-l-4 border-slate-300 bg-slate-50 p-3 text-sm text-slate-800">{c.lastNote ?? "No note."}</blockquote>
        </Card>

        {/* Interpretation */}
        <Card title="System interpretation" actions={<ConfidenceBadge confidence={interp?.confidence} />}>
          {interp ? (
            <div className="space-y-3">
              <Field label="What happened">{interp.summary}</Field>
              <Field label="Recommended action">{interp.action ?? "Follow department rule"}</Field>
              <Field label="Detected follow-up date">{interp.explicitFollowUpDate ? `${fmtDate(new Date(interp.explicitFollowUpDate + "T00:00:00"))}${interp.explicitFollowUpTime ? ` at ${interp.explicitFollowUpTime}` : ""}` : "None stated in note"}</Field>
              <Field label="Reason">{interp.reason}</Field>
              {(interp.suggestedDepartment || interp.suggestedStage) && (
                <Field label="Suggested">{[interp.suggestedDepartment, interp.suggestedStage].filter(Boolean).join(" / ")}</Field>
              )}
              {interp.signals.length > 0 && <div className="flex flex-wrap gap-1">{interp.signals.map((s) => <Badge key={s}>{s}</Badge>)}</div>}
              {interp.requiresConfirmation && (
                <form action={confirmInterpretationAction} className="rounded-md bg-amber-50 p-3 text-sm text-amber-900">
                  <input type="hidden" name="caseId" value={c.id} />
                  Low confidence - please confirm the interpretation or set the follow-up date manually.
                  <div className="mt-2"><button className="btn">Confirm interpretation</button></div>
                </form>
              )}
            </div>
          ) : (
            <p className="text-sm text-slate-500">No interpretation available.</p>
          )}
        </Card>
      </div>

      {/* Follow-up action */}
      {(c.caseState === "ACTIVE" || c.caseState === "SUPERVISOR_REVIEW" || c.caseState === "HOLD") && (
        <div id="follow-up">
          <Card title={coordTask ? `Complete follow-up - due ${fmtDue(coordTask.dueDate, coordTask.hasDueTime)}` : "Record a follow-up"}>
            {openEsc && <p className="mb-3 rounded-md bg-orange-50 p-2 text-sm text-orange-800">This case is waiting for supervisor review. You can still record contact; the escalation stays open until a supervisor acts on it.</p>}
            <FollowUpForm
              caseId={c.id}
              taskId={coordTask?.id ?? null}
              statuses={statusRows.map((s) => s.status!).filter(Boolean)}
              currentStatus={c.currentStatus}
              attemptInfo={attemptInfo}
              ruleHint={rule ? describeRule(rule) : "department/status rule (none for this status)"}
            />
          </Card>
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-3">
        <Card title="Assignment & manual scheduling" className="xl:col-span-1">
          <div className="space-y-4">
            <form action={assignAction} className="flex items-end gap-2">
              <input type="hidden" name="caseId" value={c.id} />
              <div className="flex-1">
                <label className="label">Coordinator</label>
                <select name="coordinator" className="input w-full" defaultValue={c.assignedCoordinator ?? ""}>
                  <option value="" disabled>Select...</option>
                  {coordinators.map((u) => <option key={u.id}>{u.name}</option>)}
                </select>
              </div>
              <button className="btn">Assign</button>
            </form>
            {(isSupervisorLike(user) || !c.department) && (
              <form action={setDepartmentAction} className="flex items-end gap-2">
                <input type="hidden" name="caseId" value={c.id} />
                <div className="flex-1">
                  <label className="label">Department</label>
                  <select name="department" className="input w-full" defaultValue={c.department ?? ""}>
                    <option value="" disabled>Select...</option>
                    {departments.map((d) => <option key={d.id}>{d.name}</option>)}
                  </select>
                </div>
                <button className="btn">Set</button>
              </form>
            )}
            <div>
              <div className="mb-1 text-sm font-medium text-slate-700">Schedule a manual follow-up</div>
              {ruleNotConfigured && <p className="mb-2 text-xs text-amber-800">{describeRule(rule)} - the system will not invent a date.</p>}
              <ManualFollowUpForm caseId={c.id} defaultReason={ruleNotConfigured ? `Manual date (${rule?.stage ?? "rule not configured"})` : ""} />
            </div>
          </div>
        </Card>

        <Card title="Tasks" className="xl:col-span-2">
          <table className="table-base">
            <thead>
              <tr><th>Due</th><th>Type</th><th>Reason</th><th>Attempt</th><th>State</th><th>Completed</th></tr>
            </thead>
            <tbody>
              {[...c.tasks].reverse().slice(0, 15).map((t) => (
                <tr key={t.id}>
                  <td className="whitespace-nowrap">{fmtDue(t.dueDate, t.hasDueTime)}</td>
                  <td className="whitespace-nowrap text-xs text-slate-600">{t.taskType.replace(/_/g, " ").toLowerCase()} ({t.generatedBy.toLowerCase()})</td>
                  <td className="text-slate-700">{t.reason}</td>
                  <td className="whitespace-nowrap">{attemptLabel(t.attemptNumber, t.maxAttempts)}</td>
                  <td>{t.status === "CANCELLED" ? <Badge>Superseded</Badge> : <TaskStateBadge state={categorizeTask(t, now)} />}</td>
                  <td className="min-w-40 text-xs text-slate-600">{t.completedAt && t.status === "COMPLETED" ? `${fmtDateTime(t.completedAt)} - ${t.completedBy ?? ""} - ${outcomeLabel(t.outcome)}` : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>

      <Card title="History">
        {c.history.length === 0 ? (
          <p className="text-sm text-slate-500">No history yet.</p>
        ) : (
          <ol className="relative ml-2 border-l border-slate-200">
            {c.history.map((h) => (
              <li key={h.id} className="mb-4 ml-4">
                <span className={`absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full border border-white ${h.actionType === "ESCALATION" ? "bg-orange-500" : h.actionType === "FOLLOW_UP" ? "bg-brand-600" : "bg-slate-400"}`} />
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                  <span>{fmtDateTime(h.actionDate)}</span>
                  <Badge tone={h.actionType === "ESCALATION" ? "orange" : h.actionType === "FOLLOW_UP" ? "blue" : "slate"}>{HISTORY_LABEL[h.actionType] ?? h.actionType}</Badge>
                  {h.outcome && <span className="font-medium text-slate-700">{outcomeLabel(h.outcome)}</span>}
                  {h.attemptNumber && h.actionType === "FOLLOW_UP" && ["NO_ANSWER", "LEFT_VOICEMAIL"].includes(h.outcome ?? "") && <span>{attemptLabel(h.attemptNumber, policy.maximumAttempts)}</span>}
                  {h.coordinator && <span>by {h.coordinator}</span>}
                </div>
                {h.note && <p className="mt-0.5 text-sm text-slate-800">{h.note}</p>}
                {h.nextFollowUpDate && <p className="text-xs text-slate-500">Next follow-up: {fmtDateTime(h.nextFollowUpDate)}</p>}
              </li>
            ))}
          </ol>
        )}
      </Card>
    </div>
  );
}
