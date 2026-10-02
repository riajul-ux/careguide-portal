/**
 * caseEvaluator
 * --------------
 * Derives everything the system "knows" about a case from its raw fields
 * (status, latest note, dates) and the configured rules. Shared by the seed,
 * the CSV importer and the workflow service so all paths behave the same.
 */
import { startOfDay } from "date-fns";
import type { ReviewType } from "../lib/constants";
import { assignCase, departmentForRule, type DepartmentInfo } from "./assignmentEngine";
import { computeNextFollowUp, findAnyRuleForStatus, resolveStatusRule, type NextFollowUp, type RuleConfig } from "./followUpEngine";
import { interpretNote, type NoteInterpretation } from "./noteInterpreter";

export interface RawCaseFields {
  currentStatus: string | null;
  /** Manually set department, used when the status has no specific rule. */
  department?: string | null;
  intakePerson?: string | null;
  assignedCoordinator?: string | null;
  assignedSupervisor?: string | null;
  lastNote: string | null;
  lastNoteDate: Date | null;
  receivedDate?: Date | null;
  /** fields that were present in the source but could not be parsed */
  invalidDates?: string[];
}

export interface CaseEvaluation<R extends RuleConfig = RuleConfig> {
  rule: R | null;
  department: string | null;
  process: string | null;
  stage: string | null;
  caseState: "ACTIVE" | "HOLD" | "CLOSED" | "SUPERVISOR_REVIEW";
  assignedCoordinator: string | null;
  assignedSupervisor: string | null;
  interpretation: NoteInterpretation;
  nextFollowUp: NextFollowUp;
  issues: ReviewType[];
}

export interface EvaluateOptions<R extends RuleConfig> {
  rules: R[];
  departments: DepartmentInfo[];
  defaultSupervisor?: string | null;
  now: Date;
}

export function evaluateCase<R extends RuleConfig>(raw: RawCaseFields, opts: EvaluateOptions<R>): CaseEvaluation<R> {
  const rule = resolveStatusRule(opts.rules, raw.currentStatus, raw.department ?? null);
  const knownInactive = !rule ? findAnyRuleForStatus(opts.rules, raw.currentStatus) : null;
  const department = departmentForRule(rule ?? knownInactive) ?? raw.department ?? null;
  const interpretation = interpretNote(raw.lastNote, raw.lastNoteDate, opts.now);

  let caseState: CaseEvaluation["caseState"] = "ACTIVE";
  if (rule?.isTerminal) caseState = "CLOSED";
  else if (rule?.isHold) caseState = "HOLD";

  const assignment = assignCase({
    intakePerson: raw.intakePerson,
    existingCoordinator: raw.assignedCoordinator,
    existingSupervisor: raw.assignedSupervisor,
    department,
    departments: opts.departments,
    defaultSupervisor: opts.defaultSupervisor,
    requiresManualAssignment: rule?.requiresSupervisorReview ?? false,
  });

  const nextFollowUp =
    caseState === "ACTIVE"
      ? computeNextFollowUp({ baseDate: raw.lastNoteDate ?? raw.receivedDate ?? startOfDay(opts.now), rule, interpretation })
      : { dueDate: null, hasTime: false, source: "NONE" as const, reason: rule?.isTerminal ? "Closed status" : "On hold", requiresManual: false, ruleNotConfigured: false };

  const issues = computeIssues({
    caseState,
    assignedCoordinator: assignment.assignedCoordinator,
    department,
    status: raw.currentStatus,
    rule,
    statusKnown: !!(rule || knownInactive),
    hasNextFollowUp: !!nextFollowUp.dueDate,
    interpretation,
    invalidDates: raw.invalidDates,
  });

  return {
    rule,
    department,
    process: rule?.process ?? null,
    stage: interpretation.suggestedStage ?? rule?.stage ?? null,
    caseState,
    assignedCoordinator: assignment.assignedCoordinator,
    assignedSupervisor: assignment.assignedSupervisor,
    interpretation,
    nextFollowUp,
    issues,
  };
}

export interface IssueInput {
  caseState: string;
  assignedCoordinator: string | null;
  department: string | null;
  status: string | null;
  rule: RuleConfig | null;
  statusKnown: boolean;
  hasNextFollowUp: boolean;
  interpretation: Pick<NoteInterpretation, "requiresConfirmation"> | null;
  invalidDates?: string[] | null;
}

/** Data-quality flags that put a case in the Needs Review queue. Never guesses a fix. */
export function computeIssues(i: IssueInput): ReviewType[] {
  const issues: ReviewType[] = [];
  const open = i.caseState === "ACTIVE" || i.caseState === "SUPERVISOR_REVIEW";
  if (open) {
    if (!i.assignedCoordinator) issues.push("MISSING_COORDINATOR");
    if (!i.department) issues.push("MISSING_DEPARTMENT");
    if (!i.status?.trim() || !i.statusKnown) issues.push("UNKNOWN_STATUS");
    if (i.rule && (!i.rule.isConfigured || i.rule.requiresSupervisorReview)) issues.push("UNCONFIGURED_RULE");
    if (!i.hasNextFollowUp && i.caseState === "ACTIVE") issues.push("NO_FUTURE_FOLLOWUP");
    if (i.interpretation?.requiresConfirmation) issues.push("AMBIGUOUS_NOTE");
  }
  if (i.invalidDates && i.invalidDates.length) issues.push("INVALID_DATE");
  return issues;
}
