/**
 * Default follow-up rules loaded into the StatusRule table on first run.
 * After seeding, the database is the source of truth - managers edit rules on
 * the Admin > Follow-Up Rules page, no code changes required.
 *
 * Statuses come from the referral export ("Status" column).
 *
 * Confirmed by operations:      Medicaid every 4 days, MLTC every 2 days,
 *                               MLTC no-answer retry after 4 hours,
 *                               Phone Not Answered max 6 / escalate after 6,
 *                               HMO inactive, Code 54 / H-78 NOT configured.
 * Everything else marked `needsConfirmation: true` is a placeholder a
 * manager must confirm (shown with a "Confirm" badge in the Rules page).
 */
export interface DefaultRule {
  status: string | null;
  department: string | null;
  process?: string;
  stage?: string;
  outcome?: string;
  followUpIntervalDays?: number | null;
  sameDayRetryHours?: number | null;
  maximumAttempts?: number | null;
  escalateAfterAttempts?: number | null;
  isActive?: boolean;
  isConfigured?: boolean;
  isTerminal?: boolean;
  isHold?: boolean;
  requiresSupervisorReview?: boolean;
  needsConfirmation?: boolean;
  instructions?: string;
}

const medicaid = (status: string, stage: string, extra: Partial<DefaultRule> = {}): DefaultRule => ({
  status,
  department: "Medicaid",
  process: "Medicaid Application",
  stage,
  followUpIntervalDays: 4,
  instructions: "Call Medicaid / HRA for application status every 4 days.",
  ...extra,
});

const mltc = (status: string, stage: string, extra: Partial<DefaultRule> = {}): DefaultRule => ({
  status,
  department: "MLTC",
  process: "MLTC Enrollment",
  stage,
  followUpIntervalDays: 2,
  instructions: "Follow up every 2 days. If the phone is not answered, retry 4 hours later the same day.",
  ...extra,
});

const placeholder = (status: string | null, department: string, days: number, process: string, stage: string, instructions: string): DefaultRule => ({
  status,
  department,
  process,
  stage,
  followUpIntervalDays: days,
  needsConfirmation: true,
  instructions: `${instructions} (Placeholder interval - please confirm.)`,
});

export const DEFAULT_RULES: DefaultRule[] = [
  // ---- Outcome rules -------------------------------------------------------
  {
    status: null,
    department: null,
    outcome: "NO_ANSWER",
    process: "Phone Not Answered",
    stage: "Contact attempts",
    maximumAttempts: 6,
    escalateAfterAttempts: 6,
    instructions:
      "Track unsuccessful phone attempts per case. After the 6th unanswered attempt the coordinator task is completed, the case stays open and a supervisor escalation is created. Voicemail counts as not answered.",
  },
  {
    status: null,
    department: "MLTC",
    outcome: "NO_ANSWER",
    process: "MLTC Phone Retry",
    stage: "Contact attempts",
    sameDayRetryHours: 4,
    instructions: "MLTC + No Answer: create another attempt 4 hours later the same day (next business morning if after hours).",
  },

  // ---- Department defaults (used when a status has no specific rule) -------
  { ...medicaid("", "Medicaid Follow-up"), status: null },
  { ...mltc("", "MLTC Follow-up"), status: null },

  // ---- Medicaid ------------------------------------------------------------
  medicaid("Medicaid Application", "Application in progress"),
  medicaid("Medicaid Application Sent", "Application submitted"),
  medicaid("Medicaid Application EMC", "Application in progress (EMC)"),
  medicaid("Medicaid Application EP", "Application in progress (EP)"),
  medicaid("Medicaid application_County transfer", "County transfer"),
  medicaid("Admitted_medicaid application/recertification", "Recertification"),
  medicaid("Medicare Coinsurance", "Needs Community Medicaid with LTC", {
    needsConfirmation: true,
    instructions: "Medicare co-insurance only - client must apply for Community Medicaid with LTC. Department mapping is a placeholder - please confirm.",
  }),

  // ---- MLTC ----------------------------------------------------------------
  mltc("MLTC RN Assessment", "RN assessment"),
  mltc("MLTC RN Assessment (Scheduled)", "RN assessment scheduled"),
  mltc("Maximus Scheduled", "NYIA / Maximus scheduled"),
  mltc("Maximus Scheduled_CODE", "NYIA / Maximus scheduled (code)"),
  mltc("NYIA_Reschedule", "NYIA reschedule"),
  mltc("NYIA_Unreachable", "NYIA unreachable"),
  mltc("CFEEC Failed", "CFEEC failed"),
  {
    status: "MLTC RN ASSESSMENT 54 CODE",
    department: "MLTC",
    process: "MLTC Enrollment",
    stage: "Code 54 restriction",
    isConfigured: false,
    requiresSupervisorReview: true,
    instructions:
      "Rule not configured. Code 54 routing is currently unknown - manual assignment / supervisor review required. (Training guide reference only: removal typically needs Supplement A + bank statements; not used for scheduling.)",
  },
  {
    status: "MLTC RN ASSESSMENT H78 CODE",
    department: "MLTC",
    process: "MLTC Enrollment",
    stage: "H-78 restriction",
    isConfigured: false,
    instructions:
      "Duration not configured. Expected H-78 processing duration is unknown - coordinators set follow-up dates manually until this rule is configured.",
  },
  {
    status: "MLTC RN ASSESSMENT 48 CODE",
    department: "MLTC",
    process: "MLTC Enrollment",
    stage: "Code 48",
    isConfigured: false,
    instructions: "Rule not configured for Code 48. Manual follow-up date required.",
  },

  // ---- In Communication ----------------------------------------------------
  placeholder("In Communication", "In Communication", 2, "Intake Communication", "In communication", "Keep in touch with patient/family until next step is clear."),
  placeholder("In Progress", "In Communication", 2, "Intake Communication", "In progress", "Work the referral to the next step."),
  placeholder("Rehab Case_In Progress", "In Communication", 2, "Rehab Referral", "Rehab case in progress", "Coordinate with rehab facility."),

  // ---- Intake --------------------------------------------------------------
  placeholder(null, "Intake", 1, "Intake", "New referral", "First contact with new referral."),
  placeholder("New Referral", "Intake", 1, "Intake", "New referral", "First contact with new referral."),
  placeholder("Phone not answered", "Intake", 1, "Intake", "Phone not answered", "Retry contact. Attempts are tracked toward the Phone Not Answered maximum."),
  placeholder("STATE EXCHANGE REFERRALS", "Intake", 2, "Intake", "State exchange referral", "Review state exchange referral."),

  // ---- Authorization / Start of Care ---------------------------------------
  placeholder("Potential Start Date", "Authorization / Start of Care", 2, "Start of Care", "Potential start date", "Confirm authorization and start date with insurance."),
  placeholder("Rehab Case_Potential Start Date", "Authorization / Start of Care", 2, "Start of Care", "Potential start date (rehab)", "Confirm discharge, authorization and start date."),
  placeholder("Admitted_Needs More Hours", "Authorization / Start of Care", 4, "Authorization", "Increase in hours", "Follow up on request for more hours."),

  // ---- Agency / Plan Transfer ----------------------------------------------
  placeholder("Plan to Plan Transfer", "Agency / Plan Transfer", 3, "Plan-to-Plan Transfer", "Transfer in progress", "Follow the 10-step plan-to-plan transfer process."),
  placeholder("Agency Transfer", "Agency / Plan Transfer", 3, "Agency Transfer", "Transfer in progress", "Confirm caregiver certification before requesting authorization."),
  placeholder("VNS/Anthem CASES_P2P", "Agency / Plan Transfer", 3, "Plan-to-Plan Transfer", "VNS/Anthem P2P", "Plan-to-plan transfer for VNS/Anthem members."),

  // ---- CHHA / OPWDD / NHTD / Private Pay -----------------------------------
  placeholder(null, "CHHA", 3, "CHHA", "CHHA referral", "Confirm insurance approval and RN start-of-care visit."),
  placeholder("OPWDD_CHHA_REFERRAL SENT", "OPWDD", 7, "OPWDD", "Referral sent", "Follow up with Front Door / CCO."),
  placeholder("OPWDD_CHHA_IN PROGRESS", "OPWDD", 7, "OPWDD", "In progress", "Follow up on evaluations and authorization."),
  placeholder("NHTD PROGRAM REFERRAL", "NHTD", 7, "NHTD Waiver", "RRDC referral", "Follow up with RRDC."),
  placeholder("NHTD PROGRAM REFERRAL SC FORM SENT", "NHTD", 7, "NHTD Waiver", "SC form sent", "Follow up with service coordination agency."),
  placeholder("Private Pay", "Private Pay", 3, "Private Pay", "Private pay inquiry", "Confirm hours, location and rate understanding."),

  // ---- Hold / Exception (no automatic follow-ups) --------------------------
  { status: "Hold", department: "Hold / Exception", process: "Hold", stage: "On hold", isHold: true, instructions: "On hold - no automatic follow-up. Set a manual date if needed." },
  { status: "Rehab Case_HOLD/PNA/LOST", department: "Hold / Exception", process: "Hold", stage: "Rehab hold", isHold: true, instructions: "On hold - no automatic follow-up." },
  { status: "NHTD_HOLD/PNA/LOST", department: "Hold / Exception", process: "Hold", stage: "NHTD hold", isHold: true, instructions: "On hold - no automatic follow-up." },
  { status: "Private Pay_HOLD/PNA/LOST", department: "Hold / Exception", process: "Hold", stage: "Private pay hold", isHold: true, instructions: "On hold - no automatic follow-up." },
  { status: "Rehab Case_Safe Discharge", department: "Hold / Exception", process: "Hold", stage: "Safe discharge", isHold: true, needsConfirmation: true, instructions: "Treated as hold (no automatic follow-up). Please confirm." },

  // ---- Closed --------------------------------------------------------------
  { status: "Lost", department: "Closed", process: "Closed", stage: "Lost", isTerminal: true, instructions: "Closed - no follow-up." },
  { status: "Admitted", department: "Closed", process: "Closed", stage: "Admitted", isTerminal: true, instructions: "Admitted - intake complete, no intake follow-up." },

  // ---- Statuses seen in data with no confirmed routing ---------------------
  { status: "Public Assistance", department: null, isConfigured: false, instructions: "Rule not configured - department unknown." },
  { status: "Cash Assistance", department: null, isConfigured: false, instructions: "Rule not configured - department unknown." },
  { status: "CA_Interview Completed", department: null, isConfigured: false, instructions: "Rule not configured - department unknown." },

  // ---- Retired -------------------------------------------------------------
  { status: "HMO", department: null, process: "HMO", stage: "Retired", isActive: false, isConfigured: false, instructions: "HMO is no longer used. Inactive." },
];
