"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { SESSION_COOKIE, getCurrentUser, isSupervisorLike } from "@/lib/session";
import { setSetting } from "@/lib/settings";
import {
  assignCoordinator,
  audit,
  completeTask,
  confirmInterpretation,
  performEscalationAction,
  reapplyRules,
  scheduleManualFollowUp,
  setDepartment,
} from "@/services/workflowService";
import type { EscalationAction } from "@/services/escalationEngine";

export interface ActionResult {
  ok: boolean;
  message: string;
}

const str = (f: FormData, k: string) => {
  const v = f.get(k);
  return typeof v === "string" && v.trim() ? v.trim() : null;
};

export async function switchUser(userId: string) {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, userId, { path: "/", sameSite: "lax", httpOnly: true });
}

export async function completeTaskAction(_prev: ActionResult | null, f: FormData): Promise<ActionResult> {
  const user = await getCurrentUser();
  const caseId = str(f, "caseId");
  const outcome = str(f, "outcome");
  if (!caseId || !outcome) return { ok: false, message: "Choose an outcome." };
  if (outcome === "OTHER" && !str(f, "note")) return { ok: false, message: "Add a note when the outcome is Other." };
  try {
    const res = await completeTask({
      caseId,
      taskId: str(f, "taskId"),
      outcome,
      note: str(f, "note"),
      nextDate: str(f, "nextDate"),
      nextTime: str(f, "nextTime"),
      manualOverride: f.get("manualOverride") === "on",
      newStatus: str(f, "newStatus"),
      user: user.name,
    });
    revalidatePath("/", "layout");
    return { ok: true, message: res.message + (res.requiresManual ? " No follow-up date could be determined - please set one manually." : "") };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Failed to save" };
  }
}

export async function escalationAction(f: FormData) {
  const user = await getCurrentUser();
  if (!isSupervisorLike(user)) throw new Error("Supervisor role required");
  await performEscalationAction({
    escalationId: str(f, "escalationId")!,
    action: str(f, "action") as EscalationAction,
    instruction: str(f, "instruction"),
    newCoordinator: str(f, "newCoordinator"),
    followUpDate: str(f, "followUpDate"),
    user: user.name,
  });
  revalidatePath("/", "layout");
}

export async function assignAction(f: FormData) {
  const user = await getCurrentUser();
  const coordinator = str(f, "coordinator");
  const ids = f.getAll("caseId").filter((x): x is string => typeof x === "string" && !!x);
  if (!coordinator || !ids.length) return;
  await assignCoordinator(ids, coordinator, user.name);
  revalidatePath("/", "layout");
}

export async function setDepartmentAction(f: FormData) {
  const user = await getCurrentUser();
  const caseId = str(f, "caseId");
  const department = str(f, "department");
  if (caseId && department) await setDepartment(caseId, department, user.name);
  revalidatePath("/", "layout");
}

export async function manualFollowUpAction(_prev: ActionResult | null, f: FormData): Promise<ActionResult> {
  const user = await getCurrentUser();
  const caseId = str(f, "caseId");
  const date = str(f, "date");
  if (!caseId || !date) return { ok: false, message: "Pick a date." };
  try {
    await scheduleManualFollowUp({ caseId, date, time: str(f, "time"), reason: str(f, "reason"), user: user.name });
    revalidatePath("/", "layout");
    return { ok: true, message: "Follow-up scheduled." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Failed" };
  }
}

export async function confirmInterpretationAction(f: FormData) {
  const user = await getCurrentUser();
  const caseId = str(f, "caseId");
  if (caseId) await confirmInterpretation(caseId, user.name);
  revalidatePath("/", "layout");
}

// ---------------------------------------------------------------------------
// Rules (Admin)
// ---------------------------------------------------------------------------

const num = (f: FormData, k: string) => {
  const v = str(f, k);
  if (v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

export async function saveRuleAction(_prev: ActionResult | null, f: FormData): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!isSupervisorLike(user)) return { ok: false, message: "Only a supervisor or admin can change rules." };
  const id = str(f, "id");
  const data = {
    status: str(f, "status"),
    department: str(f, "department"),
    process: str(f, "process"),
    stage: str(f, "stage"),
    outcome: str(f, "outcome"),
    followUpIntervalDays: num(f, "followUpIntervalDays") === null ? null : Math.round(num(f, "followUpIntervalDays")!),
    sameDayRetryHours: num(f, "sameDayRetryHours"),
    maximumAttempts: num(f, "maximumAttempts") === null ? null : Math.round(num(f, "maximumAttempts")!),
    escalateAfterAttempts: num(f, "escalateAfterAttempts") === null ? null : Math.round(num(f, "escalateAfterAttempts")!),
    isActive: f.get("isActive") === "on",
    isConfigured: f.get("isConfigured") === "on",
    isTerminal: f.get("isTerminal") === "on",
    isHold: f.get("isHold") === "on",
    requiresSupervisorReview: f.get("requiresSupervisorReview") === "on",
    needsConfirmation: f.get("needsConfirmation") === "on",
    instructions: str(f, "instructions"),
  };
  if (!data.status && !data.department && !data.outcome) return { ok: false, message: "A rule needs a status, a department or an outcome." };
  if (data.isConfigured && !data.isTerminal && !data.isHold && !data.outcome && !data.followUpIntervalDays) {
    return { ok: false, message: "A configured rule needs a follow-up interval (or mark it Hold / Closed, or untick Configured)." };
  }
  let ruleId = id;
  if (id) {
    const before = await prisma.statusRule.findUniqueOrThrow({ where: { id } });
    await prisma.statusRule.update({ where: { id }, data });
    const changed = (Object.keys(data) as (keyof typeof data)[]).filter((k) => String(before[k] ?? "") !== String(data[k] ?? ""));
    for (const k of changed) await audit(prisma, user.name, "RULE_UPDATED", "StatusRule", id, { field: k, oldValue: before[k] === null ? null : String(before[k]), newValue: data[k] === null ? null : String(data[k]) });
  } else {
    const r = await prisma.statusRule.create({ data });
    ruleId = r.id;
    await audit(prisma, user.name, "RULE_CREATED", "StatusRule", r.id, { details: data });
  }
  let msg = "Rule saved.";
  if (f.get("reapply") === "on") {
    const n = await reapplyRules(user.name, data.status ?? undefined);
    msg += ` Re-applied to open cases: ${n} case(s) updated.`;
  }
  revalidatePath("/", "layout");
  return { ok: true, message: `${msg}${ruleId ? "" : ""}` };
}

export async function reapplyAllRulesAction(): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!isSupervisorLike(user)) return { ok: false, message: "Only a supervisor or admin can re-apply rules." };
  const n = await reapplyRules(user.name);
  revalidatePath("/", "layout");
  return { ok: true, message: `Rules re-applied. ${n} case(s) updated.` };
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export async function saveSettingsAction(f: FormData) {
  const user = await getCurrentUser();
  if (user.role !== "ADMIN" && user.role !== "SUPERVISOR") throw new Error("Admin role required");
  for (const k of ["businessDayStartHour", "businessDayEndHour", "defaultSupervisor"]) {
    const v = str(f, k);
    if (v !== null) await setSetting(k, v);
  }
  await audit(prisma, user.name, "SETTINGS_UPDATED", "AppSetting", "*");
  revalidatePath("/", "layout");
}

export async function toggleDepartmentAction(f: FormData) {
  const user = await getCurrentUser();
  if (!isSupervisorLike(user)) throw new Error("Supervisor role required");
  const id = str(f, "id")!;
  const d = await prisma.department.findUniqueOrThrow({ where: { id } });
  await prisma.department.update({ where: { id }, data: { isActive: !d.isActive } });
  await audit(prisma, user.name, "DEPARTMENT_TOGGLED", "Department", id, { field: "isActive", oldValue: String(d.isActive), newValue: String(!d.isActive) });
  revalidatePath("/settings");
}

export async function resetDemoAction(): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (user.role !== "ADMIN") return { ok: false, message: "Admin role required." };
  const { seedDemo } = await import("@/lib/seedDemo");
  const msg = await seedDemo();
  revalidatePath("/", "layout");
  return { ok: true, message: `Demo data reset: ${msg}.` };
}
