import { describe, it, expect } from "vitest";
import { format } from "date-fns";
import {
  computeNextFollowUp,
  planAfterOutcome,
  categorizeTask,
  resolveStatusRule,
  resolveNoAnswerPolicy,
} from "../src/services/followUpEngine";
import { interpretNote } from "../src/services/noteInterpreter";
import { evaluateCase } from "../src/services/caseEvaluator";
import { RULES, d } from "./helpers";

const ymd = (x: Date | null) => (x ? format(x, "yyyy-MM-dd") : null);
const ymdhm = (x: Date | null) => (x ? format(x, "yyyy-MM-dd HH:mm") : null);

describe("Medicaid: every 4 days", () => {
  const rule = resolveStatusRule(RULES, "Medicaid Application");

  it("resolves the Medicaid rule", () => {
    expect(rule?.department).toBe("Medicaid");
    expect(rule?.followUpIntervalDays).toBe(4);
  });

  it("last follow-up Oct 2 -> next follow-up Oct 6", () => {
    const next = computeNextFollowUp({ baseDate: d(2026, 10, 2, 11), rule });
    expect(ymd(next.dueDate)).toBe("2026-10-06");
    expect(next.source).toBe("RULE");
  });

  it("Oct 6 is DUE TODAY, Oct 7 is OVERDUE", () => {
    const task = { status: "OPEN", dueDate: d(2026, 10, 6), hasDueTime: false };
    expect(categorizeTask(task, d(2026, 10, 5, 9))).toBe("UPCOMING");
    expect(categorizeTask(task, d(2026, 10, 6, 16))).toBe("DUE_TODAY");
    expect(categorizeTask(task, d(2026, 10, 7, 8))).toBe("OVERDUE");
  });

  it("completing a Medicaid call (case not resolved) schedules +4 days and the task counts as completed", () => {
    const plan = planAfterOutcome({
      outcome: "INSURANCE_CONTACTED",
      now: d(2026, 10, 2, 10),
      department: "Medicaid",
      rule,
      noAnswerPolicy: resolveNoAnswerPolicy(RULES, "Medicaid"),
      currentAttempts: 0,
    });
    expect(plan.taskCompleted).toBe(true);
    expect(plan.caseState).toBe("ACTIVE");
    expect(ymd(plan.nextTask!.dueDate)).toBe("2026-10-06");
  });
});

describe("MLTC: every 2 days", () => {
  it("next follow-up is 2 days after the last one", () => {
    const rule = resolveStatusRule(RULES, "MLTC RN Assessment");
    expect(rule?.followUpIntervalDays).toBe(2);
    const next = computeNextFollowUp({ baseDate: d(2026, 10, 2, 15), rule });
    expect(ymd(next.dueDate)).toBe("2026-10-04");
  });
});

describe("MLTC no answer: retry 4 hours later the same day", () => {
  const rule = resolveStatusRule(RULES, "MLTC RN Assessment");
  const policy = resolveNoAnswerPolicy(RULES, "MLTC");

  it("merges the MLTC retry rule with the global phone-not-answered rule", () => {
    expect(policy).toEqual({ sameDayRetryHours: 4, maximumAttempts: 6, escalateAfterAttempts: 6 });
  });

  it("10:00 AM attempt #1 no answer -> 2:00 PM attempt #2 MLTC Phone Retry", () => {
    const plan = planAfterOutcome({ outcome: "NO_ANSWER", now: d(2026, 10, 2, 10), department: "MLTC", rule, noAnswerPolicy: policy, currentAttempts: 0 });
    expect(plan.attemptNumber).toBe(1);
    expect(plan.nextTask?.taskType).toBe("PHONE_RETRY");
    expect(ymdhm(plan.nextTask!.dueDate)).toBe("2026-10-02 14:00");
    expect(plan.nextTask?.hasTime).toBe(true);
    expect(plan.nextTask?.attemptNumber).toBe(2);
    expect(plan.nextTask?.reason).toContain("MLTC Phone Retry");
    expect(plan.nextTask?.reason).toContain("Attempt 2 of 6");
  });

  it("a retry scheduled for 2:00 PM is DUE LATER TODAY at noon and DUE TODAY at 2:05 PM", () => {
    const task = { status: "OPEN", dueDate: d(2026, 10, 2, 14), hasDueTime: true };
    expect(categorizeTask(task, d(2026, 10, 2, 12))).toBe("DUE_LATER_TODAY");
    expect(categorizeTask(task, d(2026, 10, 2, 14, 5))).toBe("DUE_TODAY");
  });

  it("an unanswered call at 4 PM rolls the retry to the next business morning", () => {
    const plan = planAfterOutcome({ outcome: "NO_ANSWER", now: d(2026, 10, 2, 16), department: "MLTC", rule, noAnswerPolicy: policy, currentAttempts: 1 });
    // Oct 2 2026 is a Friday -> Monday Oct 5, 9:00 AM
    expect(ymdhm(plan.nextTask!.dueDate)).toBe("2026-10-05 09:00");
  });

  it("Medicaid no-answer does not get a same-day retry (uses the 4-day rule)", () => {
    const mrule = resolveStatusRule(RULES, "Medicaid Application");
    const plan = planAfterOutcome({ outcome: "NO_ANSWER", now: d(2026, 10, 2, 10), department: "Medicaid", rule: mrule, noAnswerPolicy: resolveNoAnswerPolicy(RULES, "Medicaid"), currentAttempts: 0 });
    expect(plan.nextTask?.taskType).toBe("FOLLOW_UP");
    expect(ymd(plan.nextTask!.dueDate)).toBe("2026-10-06");
  });
});

describe("Phone not answered: six attempts -> supervisor escalation", () => {
  const rule = resolveStatusRule(RULES, "MLTC RN Assessment");
  const policy = resolveNoAnswerPolicy(RULES, "MLTC");

  it("attempts 1-5 schedule another attempt, attempt 6 escalates without closing the case", () => {
    let attempts = 0;
    for (let i = 1; i <= 5; i++) {
      const plan = planAfterOutcome({ outcome: "NO_ANSWER", now: d(2026, 10, 2, 9), department: "MLTC", rule, noAnswerPolicy: policy, currentAttempts: attempts });
      expect(plan.escalate).toBe(false);
      expect(plan.nextTask).not.toBeNull();
      attempts = plan.newAttemptCount;
    }
    expect(attempts).toBe(5);
    const sixth = planAfterOutcome({ outcome: "NO_ANSWER", now: d(2026, 10, 2, 9), department: "MLTC", rule, noAnswerPolicy: policy, currentAttempts: attempts });
    expect(sixth.attemptNumber).toBe(6);
    expect(sixth.taskCompleted).toBe(true);
    expect(sixth.escalate).toBe(true);
    expect(sixth.caseState).toBe("SUPERVISOR_REVIEW");
    expect(sixth.caseState).not.toBe("CLOSED");
    expect(sixth.caseState).not.toBe("RESOLVED");
    expect(sixth.nextTask).toBeNull();
    expect(sixth.escalationReason).toMatch(/6 unsuccessful/);
  });

  it("a successful contact resets the attempt sequence", () => {
    const plan = planAfterOutcome({ outcome: "SPOKE_WITH_FAMILY", now: d(2026, 10, 2, 9), department: "MLTC", rule, noAnswerPolicy: policy, currentAttempts: 4 });
    expect(plan.newAttemptCount).toBe(0);
  });
});

describe("Explicit note date overrides the default follow-up", () => {
  it("MLTC every 2 days, but note says RN assessment scheduled 10/28 -> next follow-up 10/28", () => {
    const rule = resolveStatusRule(RULES, "MLTC RN Assessment (Scheduled)");
    const interp = interpretNote("RN assessment scheduled 10/28. Call after assessment.", d(2026, 10, 20, 11));
    expect(interp.explicitFollowUpDate).toBe("2026-10-28");
    const next = computeNextFollowUp({ baseDate: d(2026, 10, 20, 11), rule, interpretation: interp });
    expect(ymd(next.dueDate)).toBe("2026-10-28");
    expect(next.source).toBe("NOTE");
  });

  it("rule wins over a manual date unless the coordinator explicitly overrides", () => {
    const rule = resolveStatusRule(RULES, "Medicaid Application");
    const base = { baseDate: d(2026, 10, 2), rule, manualDate: d(2026, 10, 15) };
    expect(ymd(computeNextFollowUp(base).dueDate)).toBe("2026-10-06");
    expect(ymd(computeNextFollowUp({ ...base, manualOverride: true }).dueDate)).toBe("2026-10-15");
  });
});

describe("Code 54: no invented rule", () => {
  const rule = resolveStatusRule(RULES, "MLTC RN ASSESSMENT 54 CODE");

  it("rule exists but is not configured and requires supervisor review", () => {
    expect(rule).not.toBeNull();
    expect(rule!.isConfigured).toBe(false);
    expect(rule!.followUpIntervalDays).toBeNull();
    expect(rule!.requiresSupervisorReview).toBe(true);
  });

  it("no follow-up date is generated; reason says Rule not configured", () => {
    const next = computeNextFollowUp({ baseDate: d(2026, 10, 2), rule });
    expect(next.dueDate).toBeNull();
    expect(next.requiresManual).toBe(true);
    expect(next.ruleNotConfigured).toBe(true);
    expect(next.reason).toMatch(/Rule not configured/);
  });

  it("case is not auto-assigned and lands in Needs Review", () => {
    const ev = evaluateCase(
      { currentStatus: "MLTC RN ASSESSMENT 54 CODE", intakePerson: "Someone", lastNote: "Pt has code 54 on file.", lastNoteDate: d(2026, 10, 1) },
      { rules: RULES as never, departments: [], now: d(2026, 10, 2, 9) },
    );
    expect(ev.assignedCoordinator).toBeNull();
    expect(ev.issues).toContain("UNCONFIGURED_RULE");
    expect(ev.issues).toContain("MISSING_COORDINATOR");
    expect(ev.issues).toContain("NO_FUTURE_FOLLOWUP");
  });
});

describe("H-78: no invented processing duration", () => {
  const rule = resolveStatusRule(RULES, "MLTC RN ASSESSMENT H78 CODE");

  it("has no duration and produces no automatic date", () => {
    expect(rule!.isConfigured).toBe(false);
    expect(rule!.followUpIntervalDays).toBeNull();
    const next = computeNextFollowUp({ baseDate: d(2026, 10, 2), rule });
    expect(next.dueDate).toBeNull();
    expect(next.requiresManual).toBe(true);
  });

  it("allows a manual follow-up date", () => {
    const next = computeNextFollowUp({ baseDate: d(2026, 10, 2), rule, manualDate: d(2026, 10, 20) });
    expect(ymd(next.dueDate)).toBe("2026-10-20");
    expect(next.source).toBe("MANUAL");
  });

  it("completing an H-78 task without a date asks for a manual date instead of inventing one", () => {
    const plan = planAfterOutcome({ outcome: "SPOKE_WITH_PATIENT", now: d(2026, 10, 2, 10), department: "MLTC", rule, noAnswerPolicy: resolveNoAnswerPolicy(RULES, "MLTC"), currentAttempts: 0 });
    expect(plan.nextTask).toBeNull();
    expect(plan.requiresManual).toBe(true);
  });
});

describe("Other rules", () => {
  it("HMO is inactive and never resolves as an active rule", () => {
    expect(resolveStatusRule(RULES, "HMO")).toBeNull();
  });

  it("closed statuses get no follow-up", () => {
    const next = computeNextFollowUp({ baseDate: d(2026, 10, 2), rule: resolveStatusRule(RULES, "Lost") });
    expect(next.dueDate).toBeNull();
    expect(next.requiresManual).toBe(false);
  });

  it("waiting tasks in the future are WAITING, completed tasks are COMPLETED", () => {
    expect(categorizeTask({ status: "OPEN", dueDate: d(2026, 10, 9), hasDueTime: false, waitingOn: "Insurance" }, d(2026, 10, 2))).toBe("WAITING");
    expect(categorizeTask({ status: "COMPLETED", dueDate: d(2026, 9, 1), hasDueTime: false }, d(2026, 10, 2))).toBe("COMPLETED");
    expect(categorizeTask({ status: "OPEN", dueDate: d(2026, 9, 1), hasDueTime: false, taskType: "SUPERVISOR_REVIEW" }, d(2026, 10, 2))).toBe("SUPERVISOR_REVIEW");
  });

  it("Resolved outcome marks the case resolved with no next task", () => {
    const plan = planAfterOutcome({ outcome: "RESOLVED", now: d(2026, 10, 2), department: "Medicaid", rule: resolveStatusRule(RULES, "Medicaid Application"), noAnswerPolicy: resolveNoAnswerPolicy(RULES, "Medicaid"), currentAttempts: 2 });
    expect(plan.caseState).toBe("RESOLVED");
    expect(plan.nextTask).toBeNull();
  });
});
