import { DEFAULT_RULES } from "../src/lib/defaultRules";
import type { RuleConfig } from "../src/services/followUpEngine";

export const RULES: RuleConfig[] = DEFAULT_RULES.map((r, i) => ({
  id: `r${i}`,
  status: r.status,
  department: r.department,
  process: r.process ?? null,
  stage: r.stage ?? null,
  outcome: r.outcome ?? null,
  followUpIntervalDays: r.followUpIntervalDays ?? null,
  sameDayRetryHours: r.sameDayRetryHours ?? null,
  maximumAttempts: r.maximumAttempts ?? null,
  escalateAfterAttempts: r.escalateAfterAttempts ?? null,
  isActive: r.isActive ?? true,
  isConfigured: r.isConfigured ?? true,
  isTerminal: r.isTerminal ?? false,
  isHold: r.isHold ?? false,
  requiresSupervisorReview: r.requiresSupervisorReview ?? false,
  needsConfirmation: r.needsConfirmation ?? false,
}));

/** Local-time date helper: d(2026, 10, 2, 10) = Oct 2 2026 10:00 */
export const d = (y: number, m: number, day: number, h = 0, min = 0) => new Date(y, m - 1, day, h, min);
