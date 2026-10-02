/**
 * Read-side queries for dashboards, worklists and reports.
 * Task states are computed with the same pure categorizeTask() used in tests.
 */
import { endOfDay, startOfDay, subDays, eachDayOfInterval, format, parseISO, isValid } from "date-fns";
import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/db";
import { OPEN_CASE_STATES, TASK_STATE_PRIORITY, type TaskState } from "../lib/constants";
import { categorizeTask } from "./followUpEngine";

export interface WorkItem {
  taskId: string;
  caseId: string;
  referralId: string;
  patientName: string | null;
  department: string | null;
  status: string | null;
  coordinator: string | null;
  lastFollowUp: Date | null;
  dueDate: Date;
  hasDueTime: boolean;
  reason: string;
  attemptNumber: number;
  maxAttempts: number | null;
  state: TaskState;
  taskType: string;
  waitingOn: string | null;
  completedAt: Date | null;
  completedBy: string | null;
  outcome: string | null;
}

export interface WorkFilters {
  coordinator?: string;
  department?: string;
  status?: string;
  /** TaskState, or REMAINING (overdue + due today + later today), or TODAY (due today + later today) */
  state?: string;
  date?: string; // yyyy-MM-dd: tasks due on that day
  q?: string;
  /** Include supervisor-review tasks (supervisor views) */
  includeSupervisorTasks?: boolean;
}

const caseSelect = {
  id: true,
  referralId: true,
  patientName: true,
  currentStatus: true,
  department: true,
  assignedCoordinator: true,
  lastActionAt: true,
  lastNoteDate: true,
} satisfies Prisma.CaseSelect;

type TaskWithCase = Prisma.FollowUpTaskGetPayload<{ include: { case: { select: typeof caseSelect } } }>;

function toItem(t: TaskWithCase, now: Date): WorkItem {
  return {
    taskId: t.id,
    caseId: t.caseId,
    referralId: t.case.referralId,
    patientName: t.case.patientName,
    department: t.department ?? t.case.department,
    status: t.case.currentStatus,
    coordinator: t.assignedCoordinator,
    lastFollowUp: t.case.lastActionAt ?? t.case.lastNoteDate,
    dueDate: t.dueDate,
    hasDueTime: t.hasDueTime,
    reason: t.reason,
    attemptNumber: t.attemptNumber,
    maxAttempts: t.maxAttempts,
    state: categorizeTask(t, now),
    taskType: t.taskType,
    waitingOn: t.waitingOn,
    completedAt: t.completedAt,
    completedBy: t.completedBy,
    outcome: t.outcome,
  };
}

function matchesState(item: WorkItem, state?: string): boolean {
  if (!state) return true;
  if (state === "REMAINING") return ["OVERDUE", "DUE_TODAY", "DUE_LATER_TODAY"].includes(item.state);
  if (state === "TODAY") return ["DUE_TODAY", "DUE_LATER_TODAY"].includes(item.state);
  return item.state === state;
}

export async function getWorkItems(f: WorkFilters, now = new Date()): Promise<WorkItem[]> {
  const where: Prisma.FollowUpTaskWhereInput = {};
  if (f.state === "COMPLETED") {
    where.status = "COMPLETED";
    where.completedAt = { gte: startOfDay(now), lte: endOfDay(now) };
  } else {
    where.status = "OPEN";
  }
  if (f.coordinator) {
    if (f.state === "COMPLETED") where.completedBy = f.coordinator;
    else where.assignedCoordinator = f.coordinator;
  }
  if (f.department) where.OR = [{ department: f.department }, { department: null, case: { department: f.department } }];
  if (!f.includeSupervisorTasks && f.state !== "SUPERVISOR_REVIEW") where.taskType = { not: "SUPERVISOR_REVIEW" };
  const caseWhere: Prisma.CaseWhereInput = {};
  if (f.status) caseWhere.currentStatus = f.status;
  if (f.q) {
    const q = f.q.trim();
    caseWhere.OR = [{ referralId: { contains: q } }, { patientName: { contains: q } }, { lastNote: { contains: q } }];
  }
  if (Object.keys(caseWhere).length) where.case = caseWhere;
  if (f.date) {
    const d = parseISO(f.date);
    if (isValid(d)) where.dueDate = { gte: startOfDay(d), lte: endOfDay(d) };
  }

  const tasks = await prisma.followUpTask.findMany({ where, include: { case: { select: caseSelect } }, orderBy: { dueDate: "asc" }, take: 5000 });
  return tasks
    .map((t) => toItem(t, now))
    .filter((i) => matchesState(i, f.state))
    .sort((a, b) => TASK_STATE_PRIORITY[a.state] - TASK_STATE_PRIORITY[b.state] || a.dueDate.getTime() - b.dueDate.getTime());
}

// ---------------------------------------------------------------------------

export interface CoordinatorKpis {
  activeCases: number;
  overdue: number;
  dueToday: number;
  dueLaterToday: number;
  upcoming: number;
  waiting: number;
  completedToday: number;
  supervisorReview: number;
}

export async function coordinatorKpis(coordinator: string | null, now = new Date()): Promise<CoordinatorKpis> {
  const coordWhere = coordinator ? { assignedCoordinator: coordinator } : {};
  const [activeCases, open, completedToday, supervisorReview] = await Promise.all([
    prisma.case.count({ where: { ...coordWhere, caseState: { in: OPEN_CASE_STATES } } }),
    prisma.followUpTask.findMany({ where: { ...coordWhere, status: "OPEN", taskType: { not: "SUPERVISOR_REVIEW" } }, select: { status: true, dueDate: true, hasDueTime: true, waitingOn: true, taskType: true } }),
    prisma.followUpTask.count({ where: { ...(coordinator ? { completedBy: coordinator } : {}), status: "COMPLETED", completedAt: { gte: startOfDay(now), lte: endOfDay(now) } } }),
    prisma.case.count({ where: { ...coordWhere, caseState: "SUPERVISOR_REVIEW" } }),
  ]);
  const k: CoordinatorKpis = { activeCases, overdue: 0, dueToday: 0, dueLaterToday: 0, upcoming: 0, waiting: 0, completedToday, supervisorReview };
  for (const t of open) {
    const s = categorizeTask(t, now);
    if (s === "OVERDUE") k.overdue++;
    else if (s === "DUE_TODAY") k.dueToday++;
    else if (s === "DUE_LATER_TODAY") k.dueLaterToday++;
    else if (s === "UPCOMING") k.upcoming++;
    else if (s === "WAITING") k.waiting++;
  }
  return k;
}

// ---------------------------------------------------------------------------

export interface TeamRow {
  coordinator: string;
  activeCases: number;
  dueToday: number;
  workedToday: number;
  remainingToday: number;
  overdue: number;
  escalated: number;
}

export interface SupervisorOverview {
  totalActive: number;
  dueToday: number;
  completedToday: number;
  stillDue: number;
  overdue: number;
  waiting: number;
  escalations: number;
  missingFollowUp: number;
  team: TeamRow[];
  departments: { department: string; active: number; overdue: number; dueToday: number; completedToday: number; waiting: number; missingFollowUp: number }[];
}

export async function supervisorOverview(now = new Date()): Promise<SupervisorOverview> {
  const dayStart = startOfDay(now);
  const dayEnd = endOfDay(now);
  const [activeCases, openTasks, completedToday, escalations] = await Promise.all([
    prisma.case.findMany({ where: { caseState: { in: OPEN_CASE_STATES } }, select: { id: true, assignedCoordinator: true, department: true, caseState: true, tasks: { where: { status: "OPEN" }, select: { id: true } } } }),
    prisma.followUpTask.findMany({ where: { status: "OPEN", taskType: { not: "SUPERVISOR_REVIEW" } }, select: { assignedCoordinator: true, department: true, status: true, dueDate: true, hasDueTime: true, waitingOn: true, taskType: true } }),
    prisma.followUpTask.findMany({ where: { status: "COMPLETED", completedAt: { gte: dayStart, lte: dayEnd }, taskType: { not: "SUPERVISOR_REVIEW" } }, select: { completedBy: true, department: true, dueDate: true } }),
    prisma.escalation.findMany({ where: { status: { in: ["OPEN", "REVIEWED"] } }, select: { coordinator: true } }),
  ]);

  const team = new Map<string, TeamRow>();
  const row = (name: string | null) => {
    const key = name ?? "Unassigned";
    if (!team.has(key)) team.set(key, { coordinator: key, activeCases: 0, dueToday: 0, workedToday: 0, remainingToday: 0, overdue: 0, escalated: 0 });
    return team.get(key)!;
  };
  const deps = new Map<string, SupervisorOverview["departments"][number]>();
  const dep = (name: string | null) => {
    const key = name ?? "(No department)";
    if (!deps.has(key)) deps.set(key, { department: key, active: 0, overdue: 0, dueToday: 0, completedToday: 0, waiting: 0, missingFollowUp: 0 });
    return deps.get(key)!;
  };

  let missingFollowUp = 0;
  for (const c of activeCases) {
    row(c.assignedCoordinator).activeCases++;
    dep(c.department).active++;
    if (c.caseState === "ACTIVE" && c.tasks.length === 0) {
      missingFollowUp++;
      dep(c.department).missingFollowUp++;
    }
  }
  let dueToday = 0, stillDue = 0, overdue = 0, waiting = 0;
  for (const t of openTasks) {
    const s = categorizeTask(t, now);
    const r = row(t.assignedCoordinator);
    const d = dep(t.department);
    if (s === "OVERDUE") {
      overdue++; stillDue++; r.overdue++; r.remainingToday++; d.overdue++;
    } else if (s === "DUE_TODAY" || s === "DUE_LATER_TODAY") {
      dueToday++; stillDue++; r.dueToday++; r.remainingToday++; d.dueToday++;
    } else if (s === "WAITING") {
      waiting++; d.waiting++;
    }
  }
  for (const t of completedToday) {
    const r = row(t.completedBy);
    r.workedToday++;
    dep(t.department).completedToday++;
    // a task that was due today (or earlier) and got worked is part of today's workload
    if (t.dueDate <= dayEnd) {
      r.dueToday++;
      dueToday++;
    }
  }
  for (const e of escalations) row(e.coordinator).escalated++;

  const coordinators = new Set((await prisma.user.findMany({ where: { role: "COORDINATOR", isActive: true }, select: { name: true } })).map((u) => u.name));
  const teamRows = Array.from(team.values())
    .filter((r) => r.activeCases + r.dueToday + r.workedToday + r.overdue + r.escalated > 0 || coordinators.has(r.coordinator))
    .sort((a, b) => (a.coordinator === "Unassigned" ? 1 : b.coordinator === "Unassigned" ? -1 : b.remainingToday - a.remainingToday || a.coordinator.localeCompare(b.coordinator)));

  const deptOrder = (await prisma.department.findMany({ orderBy: { sortOrder: "asc" } })).map((d) => d.name);
  const departments = Array.from(deps.values()).sort((a, b) => {
    const ia = deptOrder.indexOf(a.department), ib = deptOrder.indexOf(b.department);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });

  return {
    totalActive: activeCases.length,
    dueToday,
    completedToday: completedToday.length,
    stillDue,
    overdue,
    waiting,
    escalations: escalations.length,
    missingFollowUp,
    team: teamRows,
    departments,
  };
}

// ---------------------------------------------------------------------------

export interface ReportData {
  from: Date;
  to: Date;
  completed: number;
  overdueNow: number;
  noAnswerAttempts: number;
  escalationsCreated: number;
  casesWithoutNextAction: number;
  avgActivePerCoordinator: number;
  byDepartment: { name: string; completed: number; noAnswer: number }[];
  byCoordinator: { name: string; completed: number; noAnswer: number; activeCases: number }[];
  byDay: { day: string; completed: number }[];
  outcomes: { outcome: string; count: number }[];
}

export async function reportData(fromStr?: string, toStr?: string, now = new Date()): Promise<ReportData> {
  const to = endOfDay(toStr && isValid(parseISO(toStr)) ? parseISO(toStr) : now);
  const from = startOfDay(fromStr && isValid(parseISO(fromStr)) ? parseISO(fromStr) : subDays(now, 13));
  const [done, history, escalationsCreated, openTasks, activeCases] = await Promise.all([
    prisma.followUpTask.findMany({ where: { status: "COMPLETED", completedAt: { gte: from, lte: to }, taskType: { not: "SUPERVISOR_REVIEW" } }, select: { completedAt: true, completedBy: true, department: true, outcome: true } }),
    prisma.followUpHistory.findMany({ where: { actionType: "FOLLOW_UP", actionDate: { gte: from, lte: to }, outcome: { in: ["NO_ANSWER", "LEFT_VOICEMAIL"] } }, select: { coordinator: true, case: { select: { department: true } } } }),
    prisma.escalation.count({ where: { createdAt: { gte: from, lte: to } } }),
    prisma.followUpTask.findMany({ where: { status: "OPEN", taskType: { not: "SUPERVISOR_REVIEW" } }, select: { status: true, dueDate: true, hasDueTime: true, waitingOn: true, taskType: true } }),
    prisma.case.findMany({ where: { caseState: { in: OPEN_CASE_STATES } }, select: { assignedCoordinator: true, caseState: true, _count: { select: { tasks: { where: { status: "OPEN" } } } } } }),
  ]);

  const dept = new Map<string, { name: string; completed: number; noAnswer: number }>();
  const coord = new Map<string, { name: string; completed: number; noAnswer: number; activeCases: number }>();
  const d = (n: string | null) => {
    const k = n ?? "(No department)";
    if (!dept.has(k)) dept.set(k, { name: k, completed: 0, noAnswer: 0 });
    return dept.get(k)!;
  };
  const c = (n: string | null) => {
    const k = n ?? "Unassigned";
    if (!coord.has(k)) coord.set(k, { name: k, completed: 0, noAnswer: 0, activeCases: 0 });
    return coord.get(k)!;
  };
  const days = new Map(eachDayOfInterval({ start: from, end: to }).map((x) => [format(x, "yyyy-MM-dd"), 0]));
  const outcomes = new Map<string, number>();
  for (const t of done) {
    d(t.department).completed++;
    c(t.completedBy).completed++;
    const k = format(t.completedAt!, "yyyy-MM-dd");
    days.set(k, (days.get(k) ?? 0) + 1);
    const o = t.outcome ?? "OTHER";
    outcomes.set(o, (outcomes.get(o) ?? 0) + 1);
  }
  for (const h of history) {
    d(h.case.department).noAnswer++;
    c(h.coordinator).noAnswer++;
  }
  let casesWithoutNextAction = 0;
  const assigned = new Set<string>();
  for (const a of activeCases) {
    if (a.assignedCoordinator) {
      c(a.assignedCoordinator).activeCases++;
      assigned.add(a.assignedCoordinator);
    }
    if (a.caseState === "ACTIVE" && a._count.tasks === 0) casesWithoutNextAction++;
  }
  const assignedActive = activeCases.filter((a) => a.assignedCoordinator).length;

  return {
    from,
    to,
    completed: done.length,
    overdueNow: openTasks.filter((t) => categorizeTask(t, now) === "OVERDUE").length,
    noAnswerAttempts: history.length,
    escalationsCreated,
    casesWithoutNextAction,
    avgActivePerCoordinator: assigned.size ? Math.round((assignedActive / assigned.size) * 10) / 10 : 0,
    byDepartment: Array.from(dept.values()).sort((a, b) => b.completed - a.completed),
    byCoordinator: Array.from(coord.values()).filter((x) => x.completed + x.noAnswer + x.activeCases > 0).sort((a, b) => b.completed - a.completed || b.activeCases - a.activeCases),
    byDay: Array.from(days.entries()).map(([day, completed]) => ({ day: format(parseISO(day), "MM/dd"), completed })),
    outcomes: Array.from(outcomes.entries()).map(([outcome, count]) => ({ outcome, count })).sort((a, b) => b.count - a.count),
  };
}

// ---------------------------------------------------------------------------

export async function filterOptions() {
  const [departments, coordinators, statuses] = await Promise.all([
    prisma.department.findMany({ orderBy: { sortOrder: "asc" } }),
    prisma.user.findMany({ where: { role: "COORDINATOR" }, orderBy: { name: "asc" } }),
    prisma.case.groupBy({ by: ["currentStatus"], where: { caseState: { in: OPEN_CASE_STATES } }, _count: true }),
  ]);
  return {
    departments: departments.map((d) => d.name),
    coordinators: coordinators.map((c) => c.name),
    statuses: statuses.map((s) => s.currentStatus).filter(Boolean).sort() as string[],
  };
}
