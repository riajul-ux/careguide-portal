// Central vocabulary for the portal. Strings are stored in SQLite as-is.

export const DEPARTMENTS = [
  "Intake",
  "Medicaid",
  "MLTC",
  "In Communication",
  "Authorization / Start of Care",
  "Agency / Plan Transfer",
  "CHHA",
  "OPWDD",
  "NHTD",
  "Private Pay",
  "Hold / Exception",
  "Closed",
] as const;
export type Department = (typeof DEPARTMENTS)[number];

export const ROLES = ["COORDINATOR", "SUPERVISOR", "ADMIN"] as const;
export type Role = (typeof ROLES)[number];

export const CASE_STATES = ["ACTIVE", "SUPERVISOR_REVIEW", "HOLD", "RESOLVED", "CLOSED"] as const;
export type CaseState = (typeof CASE_STATES)[number];
/** Case states that represent live workload. */
export const OPEN_CASE_STATES: CaseState[] = ["ACTIVE", "SUPERVISOR_REVIEW"];

export const TASK_STATES = [
  "OVERDUE",
  "DUE_TODAY",
  "DUE_LATER_TODAY",
  "UPCOMING",
  "WAITING",
  "COMPLETED",
  "SUPERVISOR_REVIEW",
] as const;
export type TaskState = (typeof TASK_STATES)[number];

export const TASK_STATE_LABEL: Record<TaskState, string> = {
  OVERDUE: "Overdue",
  DUE_TODAY: "Due Today",
  DUE_LATER_TODAY: "Due Later Today",
  UPCOMING: "Upcoming",
  WAITING: "Waiting",
  COMPLETED: "Completed",
  SUPERVISOR_REVIEW: "Supervisor Review",
};

/** Sort order for the prioritized work list. */
export const TASK_STATE_PRIORITY: Record<TaskState, number> = {
  OVERDUE: 1,
  DUE_TODAY: 2,
  DUE_LATER_TODAY: 3,
  UPCOMING: 4,
  WAITING: 5,
  SUPERVISOR_REVIEW: 6,
  COMPLETED: 7,
};

export const OUTCOMES = [
  { value: "SPOKE_WITH_PATIENT", label: "Spoke With Patient" },
  { value: "SPOKE_WITH_FAMILY", label: "Spoke With Family" },
  { value: "NO_ANSWER", label: "No Answer" },
  { value: "LEFT_VOICEMAIL", label: "Left Voicemail" },
  { value: "INSURANCE_CONTACTED", label: "Insurance Contacted" },
  { value: "WAITING_FOR_INSURANCE", label: "Waiting for Insurance" },
  { value: "DOCUMENTS_REQUESTED", label: "Documents Requested" },
  { value: "DOCUMENTS_RECEIVED", label: "Documents Received" },
  { value: "APPOINTMENT_SCHEDULED", label: "Appointment Scheduled" },
  { value: "ASSESSMENT_SCHEDULED", label: "Assessment Scheduled" },
  { value: "AUTHORIZATION_PENDING", label: "Authorization Pending" },
  { value: "RESOLVED", label: "Resolved" },
  { value: "OTHER", label: "Other" },
] as const;
export type Outcome = (typeof OUTCOMES)[number]["value"];

export function outcomeLabel(v: string | null | undefined): string {
  if (!v) return "";
  return OUTCOMES.find((o) => o.value === v)?.label ?? v.replace(/_/g, " ").toLowerCase();
}

/**
 * Outcomes that count as an unsuccessful phone attempt (increments the
 * attempt counter toward the "Phone Not Answered" maximum).
 * A voicemail means the phone was not answered.
 */
export const UNSUCCESSFUL_CONTACT_OUTCOMES: string[] = ["NO_ANSWER", "LEFT_VOICEMAIL"];

/** Outcomes that mean contact was made (resets the attempt sequence). */
export const SUCCESSFUL_CONTACT_OUTCOMES: string[] = [
  "SPOKE_WITH_PATIENT",
  "SPOKE_WITH_FAMILY",
  "INSURANCE_CONTACTED",
  "DOCUMENTS_RECEIVED",
  "APPOINTMENT_SCHEDULED",
  "ASSESSMENT_SCHEDULED",
  "RESOLVED",
];

/** Outcomes where the next task is "waiting on" an outside party. */
export const WAITING_OUTCOMES: Record<string, string> = {
  WAITING_FOR_INSURANCE: "Insurance",
  AUTHORIZATION_PENDING: "Authorization",
  DOCUMENTS_REQUESTED: "Documents",
};

export const ESCALATION_STATUSES = ["OPEN", "REVIEWED", "RETURNED", "CLOSED"] as const;

export const REVIEW_TYPES = [
  { value: "MISSING_COORDINATOR", label: "Missing coordinator" },
  { value: "MISSING_DEPARTMENT", label: "Missing department" },
  { value: "UNKNOWN_STATUS", label: "Unknown status" },
  { value: "NO_FUTURE_FOLLOWUP", label: "No future follow-up" },
  { value: "UNCONFIGURED_RULE", label: "Unconfigured rule" },
  { value: "INVALID_DATE", label: "Invalid date" },
  { value: "AMBIGUOUS_NOTE", label: "Ambiguous note interpretation" },
] as const;
export type ReviewType = (typeof REVIEW_TYPES)[number]["value"];
