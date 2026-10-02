/**
 * escalationEngine
 * -----------------
 * Pure helpers describing supervisor escalations. Persistence lives in
 * workflowService.ts.
 */
import { differenceInCalendarDays } from "date-fns";
import { shouldEscalate, type NoAnswerPolicy } from "./followUpEngine";

export { shouldEscalate };

export type EscalationAction = "RETURN" | "REASSIGN" | "INSTRUCTION" | "REVIEWED" | "CLOSE";

export const ESCALATION_ACTION_LABEL: Record<EscalationAction, string> = {
  RETURN: "Return to Coordinator",
  REASSIGN: "Reassign",
  INSTRUCTION: "Add Instruction",
  REVIEWED: "Mark Reviewed",
  CLOSE: "Close Escalation",
};

export function escalationReasonForAttempts(attempts: number, policy: NoAnswerPolicy): string {
  return `${attempts} unsuccessful phone attempts (maximum ${policy.maximumAttempts ?? attempts}). Supervisor review required - case not closed.`;
}

export function escalationReasonForRule(ruleLabel: string): string {
  return `${ruleLabel}: rule not configured - manual assignment / supervisor review required.`;
}

export function daysOpen(createdAt: Date, now: Date): number {
  return Math.max(0, differenceInCalendarDays(now, createdAt));
}

/**
 * State transitions for supervisor actions.
 * - RETURN: escalation resolved, case back to ACTIVE with a fresh attempt sequence
 * - REASSIGN: same as return but to another coordinator
 * - INSTRUCTION: escalation stays open, instruction recorded
 * - REVIEWED: supervisor looked at it; still open in the queue until returned/closed
 * - CLOSE: escalation closed; case returns to ACTIVE (case itself is never auto-closed)
 */
export function applyEscalationAction(action: EscalationAction): {
  escalationStatus: "OPEN" | "REVIEWED" | "RETURNED" | "CLOSED";
  caseState: "ACTIVE" | "SUPERVISOR_REVIEW";
  resetAttempts: boolean;
  createCoordinatorTask: boolean;
} {
  switch (action) {
    case "RETURN":
    case "REASSIGN":
      return { escalationStatus: "RETURNED", caseState: "ACTIVE", resetAttempts: true, createCoordinatorTask: true };
    case "INSTRUCTION":
      return { escalationStatus: "OPEN", caseState: "SUPERVISOR_REVIEW", resetAttempts: false, createCoordinatorTask: false };
    case "REVIEWED":
      return { escalationStatus: "REVIEWED", caseState: "SUPERVISOR_REVIEW", resetAttempts: false, createCoordinatorTask: false };
    case "CLOSE":
      return { escalationStatus: "CLOSED", caseState: "ACTIVE", resetAttempts: true, createCoordinatorTask: false };
  }
}
