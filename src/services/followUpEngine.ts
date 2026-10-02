/**
 * followUpEngine
 * ---------------
 * Pure business rules for follow-up scheduling and task categorization.
 * No database access - everything is passed in, so it is easy to test.
 *
 * Follow-up date priority (per operations policy):
 *   1. Explicit date / action identified in the latest note
 *   2. Department / status follow-up rule
 *   3. Manual coordinator-selected date
 * A coordinator may explicitly override (checkbox) - that is logged.
 *
 * Unconfigured rules (Code 54, H-78, ...) NEVER get an invented interval.
 */
import { addDays, addHours, addBusinessDays, isSameDay, startOfDay, endOfDay, setHours, setMinutes } from "date-fns";
import {
  SUCCESSFUL_CONTACT_OUTCOMES,
  UNSUCCESSFUL_CONTACT_OUTCOMES,
  WAITING_OUTCOMES,
  type TaskState,
} from "../lib/constants";
import type { NoteInterpretation } from "./noteInterpreter";

export interface RuleConfig {
  id?: string;
  status?: string | null;
  department?: string | null;
  process?: string | null;
  stage?: string | null;
  outcome?: string | null;
  followUpIntervalDays: number | null;
  sameDayRetryHours: number | null;
  maximumAttempts: number | null;
  escalateAfterAttempts: number | null;
  isActive: boolean;
  isConfigured: boolean;
  isTerminal: boolean;
  isHold: boolean;
  requiresSupervisorReview: boolean;
  needsConfirmation?: boolean;
  instructions?: string | null;
}

export interface NoAnswerPolicy {
  sameDayRetryHours: number | null;
  maximumAttempts: number | null;
  escalateAfterAttempts: number | null;
}

export type FollowUpSource = "NOTE" | "RULE" | "MANUAL" | "RETRY" | "NONE";

export interface NextFollowUp {
  dueDate: Date | null;
  hasTime: boolean;
  source: FollowUpSource;
  reason: string;
  /** No date could be determined - a coordinator/supervisor must pick one. */
  requiresManual: boolean;
  ruleNotConfigured: boolean;
}

const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

// ---------------------------------------------------------------------------
// Rule resolution
// ---------------------------------------------------------------------------

/** Finds the rule for a referral status: exact status match first, then the department default. */
export function resolveStatusRule<R extends RuleConfig>(rules: R[], status: string | null | undefined, department?: string | null): R | null {
  const active = rules.filter((r) => r.isActive && !r.outcome);
  if (status && norm(status)) {
    const exact = active.find((r) => r.status && norm(r.status) === norm(status));
    if (exact) return exact;
  }
  if (department) {
    const dflt = active.find((r) => !r.status && norm(r.department) === norm(department));
    if (dflt) return dflt;
  }
  return null;
}

/** Inactive rules (e.g. HMO) still identify a status so it isn't reported as "unknown". */
export function findAnyRuleForStatus<R extends RuleConfig>(rules: R[], status: string | null | undefined): R | null {
  if (!status || !norm(status)) return null;
  return rules.find((r) => !r.outcome && r.status && norm(r.status) === norm(status)) ?? null;
}

/**
 * Merges the global "Phone Not Answered" rule with a department-specific
 * no-answer rule (e.g. "MLTC + No Answer: retry after 4 hours").
 */
export function resolveNoAnswerPolicy(rules: RuleConfig[], department: string | null | undefined): NoAnswerPolicy {
  const noAnswer = rules.filter((r) => r.isActive && r.outcome === "NO_ANSWER");
  const global = noAnswer.find((r) => !r.department);
  const dept = department ? noAnswer.find((r) => r.department && norm(r.department) === norm(department)) : undefined;
  return {
    sameDayRetryHours: dept?.sameDayRetryHours ?? global?.sameDayRetryHours ?? null,
    maximumAttempts: dept?.maximumAttempts ?? global?.maximumAttempts ?? null,
    escalateAfterAttempts: dept?.escalateAfterAttempts ?? global?.escalateAfterAttempts ?? null,
  };
}

// ---------------------------------------------------------------------------
// Next follow-up date
// ---------------------------------------------------------------------------

export interface NextFollowUpInput {
  /** Date of the last completed follow-up (or last note date for imports). */
  baseDate: Date;
  rule: RuleConfig | null;
  interpretation?: Pick<NoteInterpretation, "explicitFollowUpDate" | "explicitFollowUpTime" | "reason"> | null;
  manualDate?: Date | null;
  manualHasTime?: boolean;
  /** Coordinator explicitly overrides the system date with the manual date. */
  manualOverride?: boolean;
}

function noteDate(interp: NextFollowUpInput["interpretation"]): { date: Date; hasTime: boolean } | null {
  if (!interp?.explicitFollowUpDate) return null;
  const [y, m, d] = interp.explicitFollowUpDate.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  if (interp.explicitFollowUpTime) {
    const [hh, mm] = interp.explicitFollowUpTime.split(":").map(Number);
    date.setHours(hh, mm, 0, 0);
    return { date, hasTime: true };
  }
  return { date, hasTime: false };
}

export function describeRule(rule: RuleConfig | null): string {
  if (!rule) return "No rule for this status";
  const name = rule.status ?? rule.department ?? "rule";
  if (!rule.isConfigured) return `${name}: Rule not configured`;
  if (rule.isTerminal) return `${name}: closed - no follow-up`;
  if (rule.isHold) return `${name}: on hold - no automatic follow-up`;
  if (rule.followUpIntervalDays) return `${rule.department ?? name} follow-up every ${rule.followUpIntervalDays} day${rule.followUpIntervalDays === 1 ? "" : "s"}`;
  return `${name}: no interval configured`;
}

export function computeNextFollowUp(input: NextFollowUpInput): NextFollowUp {
  const { baseDate, rule, interpretation, manualDate, manualHasTime = false, manualOverride = false } = input;
  const ruleNotConfigured = !!rule && !rule.isConfigured;

  if (manualOverride && manualDate) {
    return { dueDate: manualDate, hasTime: manualHasTime, source: "MANUAL", reason: "Coordinator override date", requiresManual: false, ruleNotConfigured };
  }

  if (rule?.isTerminal) {
    return { dueDate: null, hasTime: false, source: "NONE", reason: describeRule(rule), requiresManual: false, ruleNotConfigured: false };
  }

  // 1. Explicit date in latest note
  const nd = noteDate(interpretation);
  if (nd) {
    return { dueDate: nd.date, hasTime: nd.hasTime, source: "NOTE", reason: `Date from latest note. ${interpretation?.reason ?? ""}`.trim(), requiresManual: false, ruleNotConfigured };
  }

  // 2. Department / status rule
  if (rule && rule.isConfigured && !rule.isHold && rule.followUpIntervalDays && rule.followUpIntervalDays > 0) {
    return {
      dueDate: addDays(startOfDay(baseDate), rule.followUpIntervalDays),
      hasTime: false,
      source: "RULE",
      reason: describeRule(rule),
      requiresManual: false,
      ruleNotConfigured: false,
    };
  }

  // 3. Manual coordinator date
  if (manualDate) {
    return {
      dueDate: manualDate,
      hasTime: manualHasTime,
      source: "MANUAL",
      reason: ruleNotConfigured ? `Manual date (${describeRule(rule)})` : "Manual coordinator date",
      requiresManual: false,
      ruleNotConfigured,
    };
  }

  if (rule?.isHold) {
    return { dueDate: null, hasTime: false, source: "NONE", reason: describeRule(rule), requiresManual: false, ruleNotConfigured: false };
  }

  return {
    dueDate: null,
    hasTime: false,
    source: "NONE",
    reason: ruleNotConfigured ? "Rule not configured - manual follow-up date required" : rule ? `${describeRule(rule)} - manual date required` : "No rule for this status - manual date required",
    requiresManual: true,
    ruleNotConfigured,
  };
}

// ---------------------------------------------------------------------------
// Recording an outcome
// ---------------------------------------------------------------------------

export interface OutcomeInput {
  outcome: string;
  now: Date;
  department: string | null;
  rule: RuleConfig | null;
  noAnswerPolicy: NoAnswerPolicy;
  /** Unsuccessful attempts so far in the current contact sequence. */
  currentAttempts: number;
  /** Interpretation of the note the coordinator just entered. */
  interpretation?: NextFollowUpInput["interpretation"];
  manualDate?: Date | null;
  manualHasTime?: boolean;
  manualOverride?: boolean;
  businessDayEndHour?: number;
  businessDayStartHour?: number;
}

export interface PlannedTask {
  dueDate: Date;
  hasTime: boolean;
  taskType: "FOLLOW_UP" | "PHONE_RETRY" | "NOTE_DATE" | "MANUAL";
  reason: string;
  generatedBy: "RULE" | "NOTE" | "MANUAL" | "RETRY";
  attemptNumber: number;
  maxAttempts: number | null;
  waitingOn: string | null;
}

export interface OutcomePlan {
  /** The completed task always counts as worked. */
  taskCompleted: true;
  /** Attempt number recorded on the completed action. */
  attemptNumber: number;
  newAttemptCount: number;
  escalate: boolean;
  escalationReason: string | null;
  caseState: "ACTIVE" | "SUPERVISOR_REVIEW" | "RESOLVED" | "HOLD" | "CLOSED";
  nextTask: PlannedTask | null;
  requiresManual: boolean;
  message: string;
}

export function isUnsuccessfulContact(outcome: string): boolean {
  return UNSUCCESSFUL_CONTACT_OUTCOMES.includes(outcome);
}

export function shouldEscalate(attempts: number, policy: NoAnswerPolicy): boolean {
  const threshold = policy.escalateAfterAttempts ?? policy.maximumAttempts;
  return threshold != null && threshold > 0 && attempts >= threshold;
}

/** Same-day retry time, or null when it would land after business hours. */
export function sameDayRetryTime(now: Date, hours: number, businessDayEndHour = 18): Date | null {
  const retry = addHours(now, hours);
  if (!isSameDay(retry, now)) return null;
  const limit = setMinutes(setHours(startOfDay(now), businessDayEndHour), 0);
  if (retry > limit) return null;
  return retry;
}

function toPlanned(next: NextFollowUp, attemptNumber: number, maxAttempts: number | null, waitingOn: string | null): PlannedTask | null {
  if (!next.dueDate) return null;
  const typeBySource = { NOTE: "NOTE_DATE", RULE: "FOLLOW_UP", MANUAL: "MANUAL", RETRY: "PHONE_RETRY", NONE: "FOLLOW_UP" } as const;
  return {
    dueDate: next.dueDate,
    hasTime: next.hasTime,
    taskType: typeBySource[next.source],
    reason: next.reason,
    generatedBy: next.source === "NONE" ? "RULE" : next.source,
    attemptNumber,
    maxAttempts,
    waitingOn,
  };
}

export function planAfterOutcome(input: OutcomeInput): OutcomePlan {
  const {
    outcome,
    now,
    department,
    rule,
    noAnswerPolicy,
    currentAttempts,
    interpretation,
    manualDate,
    manualHasTime,
    manualOverride,
    businessDayEndHour = 18,
    businessDayStartHour = 9,
  } = input;
  const maxAttempts = noAnswerPolicy.maximumAttempts;

  if (outcome === "RESOLVED") {
    return {
      taskCompleted: true,
      attemptNumber: currentAttempts + 1,
      newAttemptCount: 0,
      escalate: false,
      escalationReason: null,
      caseState: "RESOLVED",
      nextTask: null,
      requiresManual: false,
      message: "Task completed. Case marked resolved - no further follow-up scheduled.",
    };
  }

  // Status change to a closed / hold status
  if (rule?.isTerminal) {
    return {
      taskCompleted: true, attemptNumber: currentAttempts + 1, newAttemptCount: 0, escalate: false, escalationReason: null,
      caseState: "CLOSED", nextTask: null, requiresManual: false, message: `Task completed. ${describeRule(rule)}.`,
    };
  }

  if (isUnsuccessfulContact(outcome)) {
    const attempt = currentAttempts + 1;
    if (shouldEscalate(attempt, noAnswerPolicy)) {
      return {
        taskCompleted: true,
        attemptNumber: attempt,
        newAttemptCount: attempt,
        escalate: true,
        escalationReason: `${attempt} unsuccessful contact attempts (maximum ${maxAttempts ?? attempt}). Supervisor review required.`,
        caseState: "SUPERVISOR_REVIEW",
        nextTask: null,
        requiresManual: false,
        message: `Attempt ${attempt} of ${maxAttempts ?? attempt} recorded. Task completed; case escalated to supervisor (not closed).`,
      };
    }
    const nextAttempt = attempt + 1;
    const attemptLabel = `Attempt ${nextAttempt}${maxAttempts ? ` of ${maxAttempts}` : ""}`;

    // Manual override / explicit note date still win (priority 1)
    if (manualOverride && manualDate) {
      const p = toPlanned(computeNextFollowUp({ baseDate: now, rule, manualDate, manualHasTime, manualOverride }), nextAttempt, maxAttempts, null)!;
      return { taskCompleted: true, attemptNumber: attempt, newAttemptCount: attempt, escalate: false, escalationReason: null, caseState: "ACTIVE", nextTask: { ...p, reason: `${p.reason} - ${attemptLabel}` }, requiresManual: false, message: `Attempt ${attempt} recorded. Next: ${attemptLabel}.` };
    }
    if (interpretation?.explicitFollowUpDate) {
      const p = toPlanned(computeNextFollowUp({ baseDate: now, rule, interpretation }), nextAttempt, maxAttempts, null)!;
      return { taskCompleted: true, attemptNumber: attempt, newAttemptCount: attempt, escalate: false, escalationReason: null, caseState: "ACTIVE", nextTask: { ...p, reason: `${p.reason} - ${attemptLabel}` }, requiresManual: false, message: `Attempt ${attempt} recorded. Next follow-up from note date.` };
    }

    if (noAnswerPolicy.sameDayRetryHours && noAnswerPolicy.sameDayRetryHours > 0) {
      const retry = sameDayRetryTime(now, noAnswerPolicy.sameDayRetryHours, businessDayEndHour);
      const deptLabel = department ?? "Phone";
      if (retry) {
        return {
          taskCompleted: true,
          attemptNumber: attempt,
          newAttemptCount: attempt,
          escalate: false,
          escalationReason: null,
          caseState: "ACTIVE",
          nextTask: {
            dueDate: retry,
            hasTime: true,
            taskType: "PHONE_RETRY",
            reason: `${deptLabel} Phone Retry (${noAnswerPolicy.sameDayRetryHours}h after unanswered call) - ${attemptLabel}`,
            generatedBy: "RETRY",
            attemptNumber: nextAttempt,
            maxAttempts,
            waitingOn: null,
          },
          requiresManual: false,
          message: `Attempt ${attempt} recorded. Same-day retry scheduled (${attemptLabel}).`,
        };
      }
      // After business hours: first thing next business day
      const nextDay = setMinutes(setHours(addBusinessDays(startOfDay(now), 1), businessDayStartHour), 0);
      return {
        taskCompleted: true,
        attemptNumber: attempt,
        newAttemptCount: attempt,
        escalate: false,
        escalationReason: null,
        caseState: "ACTIVE",
        nextTask: {
          dueDate: nextDay,
          hasTime: true,
          taskType: "PHONE_RETRY",
          reason: `${deptLabel} Phone Retry - same-day retry would fall after business hours, moved to next business day - ${attemptLabel}`,
          generatedBy: "RETRY",
          attemptNumber: nextAttempt,
          maxAttempts,
          waitingOn: null,
        },
        requiresManual: false,
        message: `Attempt ${attempt} recorded. Retry moved to next business day (${attemptLabel}).`,
      };
    }

    // No same-day retry policy: normal rule interval applies
    const next = computeNextFollowUp({ baseDate: now, rule, manualDate, manualHasTime });
    const p = toPlanned(next, nextAttempt, maxAttempts, null);
    return {
      taskCompleted: true,
      attemptNumber: attempt,
      newAttemptCount: attempt,
      escalate: false,
      escalationReason: null,
      caseState: "ACTIVE",
      nextTask: p ? { ...p, reason: `${p.reason} - ${attemptLabel}` } : null,
      requiresManual: next.requiresManual,
      message: p ? `Attempt ${attempt} recorded. Next: ${attemptLabel}.` : `Attempt ${attempt} recorded. ${next.reason}.`,
    };
  }

  // Successful contact / other outcomes
  const resets = SUCCESSFUL_CONTACT_OUTCOMES.includes(outcome) || outcome in WAITING_OUTCOMES;
  const newAttemptCount = resets ? 0 : currentAttempts;
  const waitingOn = WAITING_OUTCOMES[outcome] ?? null;
  const next = computeNextFollowUp({ baseDate: now, rule, interpretation, manualDate, manualHasTime, manualOverride });
  const planned = toPlanned(next, newAttemptCount + 1, maxAttempts, waitingOn);
  return {
    taskCompleted: true,
    attemptNumber: currentAttempts + 1,
    newAttemptCount,
    escalate: false,
    escalationReason: null,
    caseState: rule?.isHold && !planned ? "HOLD" : "ACTIVE",
    nextTask: planned,
    requiresManual: next.requiresManual,
    message: planned ? `Task completed. Next follow-up generated (${next.source.toLowerCase()}).` : `Task completed. ${next.reason}.`,
  };
}

// ---------------------------------------------------------------------------
// Task categorization
// ---------------------------------------------------------------------------

export interface CategorizableTask {
  status: string;
  dueDate: Date;
  hasDueTime: boolean;
  waitingOn?: string | null;
  taskType?: string;
}

export function categorizeTask(task: CategorizableTask, now: Date): TaskState {
  if (task.status === "COMPLETED" || task.status === "CANCELLED") return "COMPLETED";
  if (task.taskType === "SUPERVISOR_REVIEW") return "SUPERVISOR_REVIEW";
  const today = startOfDay(now);
  if (task.dueDate < today) return "OVERDUE";
  if (task.dueDate <= endOfDay(now)) {
    return task.hasDueTime && task.dueDate > now ? "DUE_LATER_TODAY" : "DUE_TODAY";
  }
  return task.waitingOn ? "WAITING" : "UPCOMING";
}

export function attemptLabel(attemptNumber: number | null | undefined, maxAttempts: number | null | undefined): string {
  if (!attemptNumber) return "—";
  return maxAttempts ? `Attempt ${attemptNumber} of ${maxAttempts}` : `Attempt ${attemptNumber}`;
}
