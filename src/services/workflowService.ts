/**
 * workflowService
 * ----------------
 * Database-backed operations: completing follow-ups, escalations, assignment,
 * manual dates and rule re-application. Business decisions are delegated to
 * the pure engines (followUpEngine, escalationEngine, caseEvaluator).
 */
import type { Case, FollowUpTask, StatusRule } from "@prisma/client";
import { prisma, type Tx } from "../lib/db";
import { getSettings, type AppSettings } from "../lib/settings";
import { combineDateTime, toHHmm } from "../lib/time";
import { outcomeLabel } from "../lib/constants";
import { computeIssues, evaluateCase } from "./caseEvaluator";
import {
  findAnyRuleForStatus,
  planAfterOutcome,
  resolveNoAnswerPolicy,
  resolveStatusRule,
  type PlannedTask,
} from "./followUpEngine";
import { applyEscalationAction, escalationReasonForAttempts, type EscalationAction } from "./escalationEngine";
import { interpretNote, type NoteInterpretation } from "./noteInterpreter";

export interface RuleContext {
  rules: StatusRule[];
  departments: { name: string; isActive: boolean; defaultSupervisor: string | null }[];
  settings: AppSettings;
}

export async function loadRuleContext(db: Tx = prisma): Promise<RuleContext> {
  const [rules, departments, settings] = await Promise.all([
    db.statusRule.findMany({ orderBy: { createdAt: "asc" } }),
    db.department.findMany({ orderBy: { sortOrder: "asc" } }),
    getSettings(db),
  ]);
  return { rules, departments, settings };
}

export async function audit(db: Tx, user: string, action: string, entityType: string, entityId: string, extra: { field?: string; oldValue?: string | null; newValue?: string | null; details?: unknown } = {}) {
  await db.auditLog.create({
    data: {
      user,
      action,
      entityType,
      entityId,
      field: extra.field,
      oldValue: extra.oldValue ?? null,
      newValue: extra.newValue ?? null,
      details: extra.details === undefined ? null : JSON.stringify(extra.details),
    },
  });
}

function existingInvalidDates(c: Pick<Case, "dataIssuesJson">): string[] {
  try {
    const arr = JSON.parse(c.dataIssuesJson ?? "[]") as string[];
    return arr.includes("INVALID_DATE") ? ["(from import)"] : [];
  } catch {
    return [];
  }
}

/** Recomputes and stores the Needs Review flags for a case. */
export async function refreshCaseIssues(db: Tx, caseId: string, ctx: RuleContext) {
  const c = await db.case.findUnique({ where: { id: caseId } });
  if (!c) return;
  const openTasks = await db.followUpTask.count({ where: { caseId, status: "OPEN" } });
  const rule = resolveStatusRule(ctx.rules, c.currentStatus, c.department);
  const known = !!(rule || findAnyRuleForStatus(ctx.rules, c.currentStatus));
  let interp: Pick<NoteInterpretation, "requiresConfirmation"> | null = null;
  try {
    interp = c.interpretationJson ? JSON.parse(c.interpretationJson) : null;
  } catch {
    interp = null;
  }
  const issues = computeIssues({
    caseState: c.caseState,
    assignedCoordinator: c.assignedCoordinator,
    department: c.department,
    status: c.currentStatus,
    rule,
    statusKnown: known,
    hasNextFollowUp: openTasks > 0,
    interpretation: interp,
    invalidDates: existingInvalidDates(c),
  });
  await db.case.update({ where: { id: caseId }, data: { dataIssuesJson: JSON.stringify(issues) } });
}

function taskData(caseRow: Pick<Case, "id" | "assignedCoordinator" | "department">, p: PlannedTask) {
  return {
    caseId: caseRow.id,
    assignedCoordinator: caseRow.assignedCoordinator,
    department: caseRow.department,
    taskType: p.taskType,
    reason: p.reason,
    dueDate: p.dueDate,
    hasDueTime: p.hasTime,
    dueTime: p.hasTime ? toHHmm(p.dueDate) : null,
    priority: p.taskType === "PHONE_RETRY" ? 2 : 3,
    status: "OPEN",
    waitingOn: p.waitingOn,
    attemptNumber: p.attemptNumber,
    maxAttempts: p.maxAttempts,
    generatedBy: p.generatedBy,
  };
}

// ---------------------------------------------------------------------------
// Complete a follow-up
// ---------------------------------------------------------------------------

export interface CompleteTaskInput {
  caseId: string;
  taskId?: string | null;
  outcome: string;
  note?: string | null;
  nextDate?: string | null; // yyyy-MM-dd
  nextTime?: string | null; // HH:mm
  manualOverride?: boolean;
  newStatus?: string | null;
  user: string;
  now?: Date;
}

export interface CompleteTaskResult {
  message: string;
  nextTaskId: string | null;
  escalated: boolean;
  requiresManual: boolean;
}

export async function completeTask(input: CompleteTaskInput): Promise<CompleteTaskResult> {
  const now = input.now ?? new Date();
  const ctx = await loadRuleContext();

  return prisma.$transaction(async (db) => {
    const c = await db.case.findUniqueOrThrow({ where: { id: input.caseId } });
    const openTasks = await db.followUpTask.findMany({ where: { caseId: c.id, status: "OPEN" }, orderBy: { dueDate: "asc" } });
    let task: FollowUpTask | undefined = input.taskId ? openTasks.find((t) => t.id === input.taskId) : openTasks.find((t) => t.taskType !== "SUPERVISOR_REVIEW");

    // --- status change -----------------------------------------------------
    let status = c.currentStatus;
    if (input.newStatus && input.newStatus !== c.currentStatus) {
      status = input.newStatus;
      await db.followUpHistory.create({
        data: { caseId: c.id, coordinator: input.user, actionDate: now, actionType: "STATUS_CHANGE", previousValue: c.currentStatus, newValue: status, note: `Status changed from "${c.currentStatus ?? "—"}" to "${status}"` },
      });
      await audit(db, input.user, "STATUS_CHANGE", "Case", c.id, { field: "currentStatus", oldValue: c.currentStatus, newValue: status });
    }
    const rule = resolveStatusRule(ctx.rules, status, status === c.currentStatus ? c.department : null);
    const department = rule?.department ?? c.department;

    const note = input.note?.trim() || null;
    const interpretation = note ? interpretNote(note, now, now) : null;
    const manualDate = input.nextDate ? combineDateTime(input.nextDate, input.nextTime || null) : null;

    const plan = planAfterOutcome({
      outcome: input.outcome,
      now,
      department,
      rule,
      noAnswerPolicy: resolveNoAnswerPolicy(ctx.rules, department),
      currentAttempts: c.noAnswerAttempts,
      interpretation,
      manualDate,
      manualHasTime: !!input.nextTime,
      manualOverride: !!input.manualOverride,
      businessDayEndHour: ctx.settings.businessDayEndHour,
      businessDayStartHour: ctx.settings.businessDayStartHour,
    });

    // --- complete the current task (create an ad-hoc one if none was open) --
    if (!task) {
      task = await db.followUpTask.create({
        data: {
          caseId: c.id,
          assignedCoordinator: c.assignedCoordinator ?? input.user,
          department,
          taskType: "MANUAL",
          reason: "Unscheduled follow-up",
          dueDate: now,
          hasDueTime: true,
          dueTime: toHHmm(now),
          status: "OPEN",
          attemptNumber: plan.attemptNumber,
          generatedBy: "MANUAL",
        },
      });
    }
    await db.followUpTask.update({
      where: { id: task.id },
      data: { status: "COMPLETED", completedAt: now, completedBy: input.user, outcome: input.outcome, attemptNumber: plan.attemptNumber },
    });
    // Any other open coordinator tasks for this case are superseded by the new plan.
    await db.followUpTask.updateMany({
      where: { caseId: c.id, status: "OPEN", id: { not: task.id }, taskType: { not: "SUPERVISOR_REVIEW" } },
      data: { status: "CANCELLED", completedAt: now, outcome: "SUPERSEDED" },
    });

    // --- next task ------------------------------------------------------------
    const updatedCase = { id: c.id, assignedCoordinator: c.assignedCoordinator, department };
    let nextTaskId: string | null = null;
    if (plan.nextTask) {
      const t = await db.followUpTask.create({ data: taskData(updatedCase, plan.nextTask) });
      nextTaskId = t.id;
      if (input.manualOverride && manualDate) {
        await audit(db, input.user, "MANUAL_DATE_OVERRIDE", "FollowUpTask", t.id, { newValue: manualDate.toISOString() });
      }
    }

    await db.followUpHistory.create({
      data: {
        caseId: c.id,
        taskId: task.id,
        coordinator: input.user,
        actionDate: now,
        actionType: "FOLLOW_UP",
        outcome: input.outcome,
        note,
        nextFollowUpDate: plan.nextTask?.dueDate ?? null,
        attemptNumber: plan.attemptNumber,
        newValue: plan.message,
      },
    });

    // --- escalation -------------------------------------------------------------
    if (plan.escalate) {
      await createEscalation(db, {
        caseRow: { ...c, department },
        taskId: task.id,
        reason: plan.escalationReason ?? escalationReasonForAttempts(plan.attemptNumber, resolveNoAnswerPolicy(ctx.rules, department)),
        attempts: plan.attemptNumber,
        lastAttemptAt: now,
        user: input.user,
        supervisor: c.assignedSupervisor ?? ctx.settings.defaultSupervisor,
      });
    }

    // --- update case ------------------------------------------------------------
    await db.case.update({
      where: { id: c.id },
      data: {
        currentStatus: status,
        department,
        statusRuleId: rule?.id ?? null,
        process: rule?.process ?? c.process,
        currentStage: interpretation?.suggestedStage ?? (status !== c.currentStatus ? rule?.stage ?? null : c.currentStage),
        lastNote: note ? `${note}` : c.lastNote,
        lastNoteDate: note ? now : c.lastNoteDate,
        noAnswerAttempts: plan.newAttemptCount,
        caseState: plan.caseState,
        lastActionAt: now,
        interpretationJson: interpretation ? JSON.stringify(interpretation) : c.interpretationJson,
        interpretationConfidence: interpretation?.confidence ?? c.interpretationConfidence,
      },
    });
    await audit(db, input.user, "FOLLOW_UP_COMPLETED", "FollowUpTask", task.id, { details: { outcome: outcomeLabel(input.outcome), attempt: plan.attemptNumber, next: plan.nextTask?.dueDate ?? null } });
    await refreshCaseIssues(db, c.id, ctx);

    return { message: plan.message, nextTaskId, escalated: plan.escalate, requiresManual: plan.requiresManual };
  });
}

// ---------------------------------------------------------------------------
// Escalations
// ---------------------------------------------------------------------------

export async function createEscalation(
  db: Tx,
  args: { caseRow: Pick<Case, "id" | "assignedCoordinator" | "department" | "assignedSupervisor">; taskId?: string | null; reason: string; attempts: number; lastAttemptAt: Date | null; user: string; supervisor: string | null },
) {
  const existing = await db.escalation.findFirst({ where: { caseId: args.caseRow.id, status: { in: ["OPEN", "REVIEWED"] } } });
  if (existing) return existing;
  const esc = await db.escalation.create({
    data: {
      caseId: args.caseRow.id,
      taskId: args.taskId ?? null,
      coordinator: args.caseRow.assignedCoordinator,
      department: args.caseRow.department,
      reason: args.reason,
      attempts: args.attempts,
      lastAttemptAt: args.lastAttemptAt,
      status: "OPEN",
    },
  });
  await db.followUpTask.create({
    data: {
      caseId: args.caseRow.id,
      assignedCoordinator: args.supervisor,
      department: args.caseRow.department,
      taskType: "SUPERVISOR_REVIEW",
      reason: args.reason,
      dueDate: args.lastAttemptAt ?? new Date(),
      hasDueTime: false,
      priority: 1,
      status: "OPEN",
      attemptNumber: args.attempts,
      generatedBy: "ESCALATION",
      escalationRequired: true,
    },
  });
  await db.followUpHistory.create({
    data: { caseId: args.caseRow.id, coordinator: args.user, actionDate: args.lastAttemptAt ?? new Date(), actionType: "ESCALATION", note: args.reason, attemptNumber: args.attempts },
  });
  await audit(db, args.user, "ESCALATION_CREATED", "Escalation", esc.id, { details: { reason: args.reason } });
  return esc;
}

export interface EscalationActionInput {
  escalationId: string;
  action: EscalationAction;
  instruction?: string | null;
  newCoordinator?: string | null;
  followUpDate?: string | null;
  user: string;
}

export async function performEscalationAction(input: EscalationActionInput) {
  const ctx = await loadRuleContext();
  const now = new Date();
  return prisma.$transaction(async (db) => {
    const esc = await db.escalation.findUniqueOrThrow({ where: { id: input.escalationId }, include: { case: true } });
    const effect = applyEscalationAction(input.action);
    const c = esc.case;
    const coordinator = input.action === "REASSIGN" && input.newCoordinator ? input.newCoordinator : c.assignedCoordinator;

    await db.escalation.update({
      where: { id: esc.id },
      data: {
        status: effect.escalationStatus,
        supervisorInstruction: input.instruction ? [esc.supervisorInstruction, input.instruction].filter(Boolean).join("\n") : esc.supervisorInstruction,
        resolvedBy: effect.escalationStatus === "RETURNED" || effect.escalationStatus === "CLOSED" ? input.user : esc.resolvedBy,
        resolvedAt: effect.escalationStatus === "RETURNED" || effect.escalationStatus === "CLOSED" ? now : esc.resolvedAt,
        coordinator,
      },
    });

    if (effect.escalationStatus === "RETURNED" || effect.escalationStatus === "CLOSED") {
      await db.followUpTask.updateMany({ where: { caseId: c.id, status: "OPEN", taskType: "SUPERVISOR_REVIEW" }, data: { status: "COMPLETED", completedAt: now, completedBy: input.user, outcome: input.action } });
    }

    if (coordinator !== c.assignedCoordinator) {
      await db.followUpHistory.create({ data: { caseId: c.id, coordinator: input.user, actionDate: now, actionType: "ASSIGNMENT", previousValue: c.assignedCoordinator, newValue: coordinator, note: `Reassigned from ${c.assignedCoordinator ?? "—"} to ${coordinator}` } });
      await audit(db, input.user, "REASSIGN", "Case", c.id, { field: "assignedCoordinator", oldValue: c.assignedCoordinator, newValue: coordinator });
    }

    await db.case.update({
      where: { id: c.id },
      data: {
        caseState: effect.caseState,
        assignedCoordinator: coordinator,
        noAnswerAttempts: effect.resetAttempts ? 0 : c.noAnswerAttempts,
        lastActionAt: now,
      },
    });

    if (effect.createCoordinatorTask) {
      const due = input.followUpDate ? combineDateTime(input.followUpDate) ?? now : now;
      await db.followUpTask.create({
        data: {
          caseId: c.id,
          assignedCoordinator: coordinator,
          department: c.department,
          taskType: "FOLLOW_UP",
          reason: `Returned by supervisor${input.instruction ? `: ${input.instruction}` : ""}`,
          dueDate: due,
          hasDueTime: false,
          priority: 2,
          status: "OPEN",
          attemptNumber: 1,
          generatedBy: "SUPERVISOR",
        },
      });
    }

    await db.followUpHistory.create({
      data: {
        caseId: c.id,
        coordinator: input.user,
        actionDate: now,
        actionType: "SUPERVISOR_ACTION",
        outcome: input.action,
        note: [`Escalation: ${input.action.replace(/_/g, " ").toLowerCase()}`, input.instruction].filter(Boolean).join(" - "),
      },
    });
    await audit(db, input.user, `ESCALATION_${input.action}`, "Escalation", esc.id, { details: { instruction: input.instruction, coordinator } });
    await refreshCaseIssues(db, c.id, ctx);
  });
}

// ---------------------------------------------------------------------------
// Assignment & manual dates
// ---------------------------------------------------------------------------

export async function assignCoordinator(caseIds: string[], coordinator: string, user: string) {
  const ctx = await loadRuleContext();
  for (const caseId of caseIds) {
    await prisma.$transaction(async (db) => {
      const c = await db.case.findUniqueOrThrow({ where: { id: caseId } });
      if (c.assignedCoordinator === coordinator) return;
      await db.case.update({ where: { id: caseId }, data: { assignedCoordinator: coordinator } });
      await db.followUpTask.updateMany({ where: { caseId, status: "OPEN", taskType: { not: "SUPERVISOR_REVIEW" } }, data: { assignedCoordinator: coordinator } });
      await db.followUpHistory.create({ data: { caseId, coordinator: user, actionType: "ASSIGNMENT", previousValue: c.assignedCoordinator, newValue: coordinator, note: `Assigned to ${coordinator}${c.assignedCoordinator ? ` (was ${c.assignedCoordinator})` : ""}` } });
      await audit(db, user, "ASSIGN", "Case", caseId, { field: "assignedCoordinator", oldValue: c.assignedCoordinator, newValue: coordinator });
      await refreshCaseIssues(db, caseId, ctx);
    });
  }
}

export async function setDepartment(caseId: string, department: string, user: string) {
  const ctx = await loadRuleContext();
  await prisma.$transaction(async (db) => {
    const c = await db.case.findUniqueOrThrow({ where: { id: caseId } });
    await db.case.update({ where: { id: caseId }, data: { department } });
    await db.followUpTask.updateMany({ where: { caseId, status: "OPEN" }, data: { department } });
    await db.followUpHistory.create({ data: { caseId, coordinator: user, actionType: "ASSIGNMENT", previousValue: c.department, newValue: department, note: `Department set to ${department}` } });
    await audit(db, user, "SET_DEPARTMENT", "Case", caseId, { field: "department", oldValue: c.department, newValue: department });
    await refreshCaseIssues(db, caseId, ctx);
  });
}

export async function scheduleManualFollowUp(args: { caseId: string; date: string; time?: string | null; reason?: string | null; user: string }) {
  const ctx = await loadRuleContext();
  const due = combineDateTime(args.date, args.time || null);
  if (!due) throw new Error("Invalid date");
  await prisma.$transaction(async (db) => {
    const c = await db.case.findUniqueOrThrow({ where: { id: args.caseId } });
    await db.followUpTask.updateMany({ where: { caseId: c.id, status: "OPEN", taskType: { not: "SUPERVISOR_REVIEW" } }, data: { status: "CANCELLED", completedAt: new Date(), outcome: "SUPERSEDED" } });
    const t = await db.followUpTask.create({
      data: {
        caseId: c.id,
        assignedCoordinator: c.assignedCoordinator,
        department: c.department,
        taskType: "MANUAL",
        reason: args.reason?.trim() || "Manual follow-up date",
        dueDate: due,
        hasDueTime: !!args.time,
        dueTime: args.time || null,
        status: "OPEN",
        attemptNumber: c.noAnswerAttempts + 1,
        generatedBy: "MANUAL",
      },
    });
    if (c.caseState === "HOLD" || c.caseState === "RESOLVED") await db.case.update({ where: { id: c.id }, data: { caseState: "ACTIVE" } });
    await db.followUpHistory.create({ data: { caseId: c.id, taskId: t.id, coordinator: args.user, actionType: "TASK_CREATED", nextFollowUpDate: due, note: `Manual follow-up scheduled: ${args.reason?.trim() || "no reason given"}` } });
    await audit(db, args.user, "MANUAL_FOLLOW_UP", "FollowUpTask", t.id, { newValue: due.toISOString() });
    await refreshCaseIssues(db, c.id, ctx);
  });
}

/** Marks an ambiguous note interpretation as confirmed by a coordinator. */
export async function confirmInterpretation(caseId: string, user: string) {
  const ctx = await loadRuleContext();
  await prisma.$transaction(async (db) => {
    const c = await db.case.findUniqueOrThrow({ where: { id: caseId } });
    if (!c.interpretationJson) return;
    const interp = JSON.parse(c.interpretationJson) as NoteInterpretation;
    interp.requiresConfirmation = false;
    interp.reason = `${interp.reason} Confirmed by ${user}.`;
    await db.case.update({ where: { id: caseId }, data: { interpretationJson: JSON.stringify(interp) } });
    await audit(db, user, "CONFIRM_INTERPRETATION", "Case", caseId);
    await refreshCaseIssues(db, caseId, ctx);
  });
}

// ---------------------------------------------------------------------------
// Re-applying rules after an admin change
// ---------------------------------------------------------------------------

/**
 * Re-evaluates open cases linked to a status (after a rule edit):
 * - open RULE-generated tasks get their due date recomputed
 * - cases with no open task get one if the rule can now produce a date
 * Tasks set from a note date, manually or as retries are left untouched.
 */
export async function reapplyRules(user: string, onlyStatus?: string | null) {
  const ctx = await loadRuleContext();
  const now = new Date();
  const cases = await prisma.case.findMany({
    where: { caseState: { in: ["ACTIVE", "HOLD", "CLOSED"] }, ...(onlyStatus ? { currentStatus: onlyStatus } : {}) },
    include: { tasks: { where: { status: "OPEN" } } },
  });
  let changed = 0;
  for (const c of cases) {
    const ev = evaluateCase(
      { currentStatus: c.currentStatus, department: c.department, intakePerson: c.intakePerson, assignedCoordinator: c.assignedCoordinator, assignedSupervisor: c.assignedSupervisor, lastNote: c.lastNote, lastNoteDate: c.lastActionAt ?? c.lastNoteDate, receivedDate: c.receivedDate },
      { rules: ctx.rules, departments: ctx.departments, defaultSupervisor: ctx.settings.defaultSupervisor, now },
    );
    const ruleTasks = c.tasks.filter((t) => t.generatedBy === "RULE" || t.generatedBy === "IMPORT");
    const otherTasks = c.tasks.filter((t) => !ruleTasks.includes(t));
    const ops: Promise<unknown>[] = [];
    const stateChanged = ev.caseState !== c.caseState && c.caseState !== "SUPERVISOR_REVIEW";
    if (stateChanged || ev.rule?.id !== c.statusRuleId || ev.department !== c.department) {
      ops.push(prisma.case.update({ where: { id: c.id }, data: { caseState: stateChanged ? ev.caseState : c.caseState, statusRuleId: ev.rule?.id ?? null, department: ev.department ?? c.department, process: ev.process ?? c.process } }));
    }
    if (otherTasks.length === 0 && ev.caseState === "ACTIVE") {
      const due = ev.nextFollowUp.dueDate;
      const existing = ruleTasks[0];
      if (due && existing && existing.dueDate.getTime() !== due.getTime() && ev.nextFollowUp.source === "RULE") {
        ops.push(prisma.followUpTask.update({ where: { id: existing.id }, data: { dueDate: due, reason: ev.nextFollowUp.reason } }));
      } else if (due && !existing) {
        ops.push(
          prisma.followUpTask.create({
            data: {
              caseId: c.id, assignedCoordinator: c.assignedCoordinator, department: ev.department, taskType: ev.nextFollowUp.source === "NOTE" ? "NOTE_DATE" : "FOLLOW_UP",
              reason: ev.nextFollowUp.reason, dueDate: due, hasDueTime: ev.nextFollowUp.hasTime, dueTime: ev.nextFollowUp.hasTime ? toHHmm(due) : null,
              status: "OPEN", waitingOn: ev.interpretation.waitingOn, attemptNumber: c.noAnswerAttempts + 1, generatedBy: ev.nextFollowUp.source === "NOTE" ? "NOTE" : "RULE",
            },
          }),
        );
      } else if (!due && existing && ev.nextFollowUp.source === "NONE") {
        ops.push(prisma.followUpTask.update({ where: { id: existing.id }, data: { status: "CANCELLED", outcome: "RULE_CHANGED", completedAt: now } }));
      }
    } else if (ev.caseState !== "ACTIVE" && ruleTasks.length) {
      ops.push(prisma.followUpTask.updateMany({ where: { id: { in: ruleTasks.map((t) => t.id) } }, data: { status: "CANCELLED", outcome: "RULE_CHANGED", completedAt: now } }));
    }
    if (ops.length) {
      changed++;
      await Promise.all(ops);
      await refreshCaseIssues(prisma, c.id, ctx);
    }
  }
  await audit(prisma, user, "REAPPLY_RULES", "StatusRule", onlyStatus ?? "*", { details: { casesChanged: changed } });
  return changed;
}
