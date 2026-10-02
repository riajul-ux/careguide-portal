/**
 * Fake demo data. No real patient information - names are generated from
 * generic lists, phone numbers use the 555-01xx fictional range, and
 * Referral IDs are prefixed with "DEMO-".
 */
import { addDays, format, subDays } from "date-fns";
import type { NormalizedReferral } from "../services/csvImporter";

export const DEMO_USERS = [
  { name: "Maya Torres", role: "COORDINATOR", department: "Medicaid", label: "Coordinator - Medicaid" },
  { name: "Daniel Brooks", role: "COORDINATOR", department: "MLTC", label: "Coordinator - MLTC" },
  { name: "Jordan Ellis", role: "COORDINATOR", department: "Intake", label: "Coordinator - Intake" },
  { name: "Sam Whitfield", role: "SUPERVISOR", department: null, label: "Supervisor" },
  { name: "Alex Morgan", role: "ADMIN", department: null, label: "Admin" },
] as const;

/** Extra (non-switcher) coordinators so the supervisor view has a realistic team. */
export const EXTRA_COORDINATORS = [
  { name: "Taylor Reed", department: "In Communication" },
  { name: "Casey Park", department: "Authorization / Start of Care" },
];

export const SUPERVISOR_NAME = "Sam Whitfield";

const FIRST = ["Ava", "Liam", "Olivia", "Noah", "Emma", "Mason", "Sophia", "Lucas", "Isabella", "Ethan", "Mia", "Logan", "Amelia", "James", "Harper", "Benjamin", "Evelyn", "Elijah", "Abigail", "Henry", "Ella", "Samuel", "Grace", "Jack", "Chloe", "Owen", "Nora", "Leo", "Lily", "Caleb", "Zoe", "Isaac", "Hannah", "Wyatt", "Aria", "Julian", "Layla", "Levi", "Ruby", "Miles"];
const LAST = ["Sample", "Testwell", "Demoreal", "Fakeson", "Placeman", "Mockley", "Examplar", "Notreal", "Synthel", "Fictor", "Dummond", "Prototon", "Trialsen", "Seedwell", "Pretendo", "Specimen", "Modelsky", "Draftley", "Stubbins", "Fixtura"];
const SOURCES = ["Community Outreach", "Hospital Discharge Planner", "Self Referred", "Family Referral", "Rehab Facility A", "Physician Office B"];

let seq = 0;
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

export interface DemoReferral extends NormalizedReferral {
  /** Post-import scripted actions for the seed */
  script?: DemoScript;
}

export type DemoScript =
  | { kind: "completedToday"; outcome: string; note: string }
  | { kind: "noAnswer"; attempts: number; department: "MLTC" | "Intake" | "Medicaid"; spreadDays?: number }
  | { kind: "escalate" }
  | { kind: "laterToday"; hoursFromNow: number };

export function buildDemoReferrals(now: Date): DemoReferral[] {
  seq = 0;
  const rand = rng(42);
  const pick = <T,>(a: readonly T[]) => a[Math.floor(rand() * a.length)];
  const md = (d: Date) => format(d, "M/d");
  const out: DemoReferral[] = [];

  const add = (status: string | null, intakePerson: string | null, note: string | null, noteDaysAgo: number | null, extra: Partial<DemoReferral> = {}) => {
    seq++;
    const noteDate = noteDaysAgo === null ? null : subDays(now, noteDaysAgo);
    if (noteDate) noteDate.setHours(9 + Math.floor(rand() * 7), Math.floor(rand() * 60), 0, 0);
    // keep note timestamps in the past
    if (noteDate && noteDate > now) noteDate.setTime(now.getTime() - 60 * 60 * 1000);
    out.push({
      rowNumber: seq,
      referralId: `DEMO-${10000 + seq}`,
      patientName: `${pick(FIRST)} ${pick(LAST)}`,
      referralSource: pick(SOURCES),
      lastNote: note,
      lastNoteDate: noteDate,
      status,
      intakePerson,
      receivedDate: subDays(now, 10 + Math.floor(rand() * 60)),
      homePhone: `555-01${String(10 + (seq % 90)).padStart(2, "0")}`,
      phone2: null,
      medicaidNumber: null,
      invalidDates: [],
      ...extra,
    });
  };

  // ---------------- Medicaid (Maya Torres) ----------------
  const M = "Maya Torres";
  for (let i = 0; i < 8; i++) add("Medicaid Application", M, pick(["Called HRA - application still under review.", "Followed up with DSS, no decision yet.", "Called Medicaid helpline, pending review."]), 6 + i);
  for (let i = 0; i < 7; i++) add(pick(["Medicaid Application", "Medicaid Application Sent"]), M, pick(["Called HRA for status, still pending.", "Spoke with patient, Medicaid still pending."]), 4);
  for (let i = 0; i < 8; i++) add("Medicaid Application", M, pick(["Spoke with daughter, gathering bank statements.", "Called HRA, case under review."]), 1 + (i % 3));
  for (let i = 0; i < 4; i++) add("Medicaid Application Sent", M, "Medicaid application submitted to HRA, waiting for Medicaid decision.", 1);
  for (let i = 0; i < 3; i++) add("Medicaid Application", M, "Bank statements requested from family for Medicaid application.", 2);
  for (let i = 0; i < 4; i++) add("Medicaid Application", M, "Called HRA for status.", 4, { script: { kind: "completedToday", outcome: i % 2 ? "NO_ANSWER" : "INSURANCE_CONTACTED", note: i % 2 ? "Called HRA, no answer." : "Called Medicaid - application still pending, no decision yet." } });
  add("Medicaid application_County transfer", M, "Spoke with pt, he requested me to call his son tomorrow.", 0);

  // ---------------- MLTC (Daniel Brooks) ----------------
  const D = "Daniel Brooks";
  for (let i = 0; i < 4; i++) add("MLTC RN Assessment (Scheduled)", D, `RN assessment scheduled ${md(addDays(now, 3 + i * 2))}. Call after assessment.`, 1);
  for (let i = 0; i < 3; i++) add("Maximus Scheduled", D, `NYIA scheduled for ${md(addDays(now, 2 + i * 3))}. Prepared patient for the call.`, 2);
  add("Maximus Scheduled", D, `NYIA scheduled ${md(now)}. Call after assessment.`, 3);
  for (let i = 0; i < 5; i++) add("MLTC RN Assessment", D, pick(["Called plan to confirm RN visit date, waiting for callback.", "Spoke with member, waiting for plan to schedule RN."]), 4 + i);
  for (let i = 0; i < 5; i++) add("MLTC RN Assessment", D, pick(["Called plan, RN visit not yet scheduled.", "Spoke with family, waiting for plan outreach."]), 2);
  for (let i = 0; i < 3; i++) add("MLTC RN Assessment", D, "Spoke with patient, plan reviewing.", 1);
  add("MLTC RN Assessment", D, "Called member to confirm assessment time.", 0, { script: { kind: "noAnswer", attempts: 1, department: "MLTC" } });
  add("MLTC RN Assessment", D, "Called member to confirm assessment time.", 1, { script: { kind: "noAnswer", attempts: 3, department: "MLTC", spreadDays: 1 } });
  add("MLTC RN Assessment", D, "Called member for update.", 1, { script: { kind: "noAnswer", attempts: 5, department: "MLTC", spreadDays: 2 } });
  add("MLTC RN Assessment", D, "Called member for update.", 0, { script: { kind: "laterToday", hoursFromNow: 2 } });
  for (let i = 0; i < 2; i++) add("MLTC RN Assessment", D, "Trying to reach member for RN assessment.", 3, { script: { kind: "escalate" } });
  for (let i = 0; i < 3; i++) add("MLTC RN ASSESSMENT 54 CODE", D, "Member has Code 54 on Medicaid. Routing not decided.", 2 + i);
  for (let i = 0; i < 3; i++) add("MLTC RN ASSESSMENT H78 CODE", D, "H-78 code on Medicaid - Marketplace coverage, waiting for conversion.", 3 + i);
  for (let i = 0; i < 2; i++) add("MLTC RN Assessment", D, "Spoke with patient, she is ready for RN visit.", 0, { script: { kind: "completedToday", outcome: "SPOKE_WITH_PATIENT", note: "Spoke with patient - plan will call to schedule RN." } });

  // ---------------- Intake (Jordan Ellis) ----------------
  const J = "Jordan Ellis";
  for (let i = 0; i < 4; i++) add("New Referral", J, "New referral received from marketer.", 0);
  for (let i = 0; i < 4; i++) add("New Referral", J, "New referral received.", 2 + i);
  for (let i = 0; i < 4; i++) add("Phone not answered", J, "Called twice, no answer, left VM, sent text.", 1 + i);
  add("Phone not answered", J, "Called, no answer.", 1, { script: { kind: "noAnswer", attempts: 2, department: "Intake", spreadDays: 1 } });
  add("Phone not answered", J, "Called, no answer.", 2, { script: { kind: "noAnswer", attempts: 5, department: "Intake", spreadDays: 3 } });
  add("Phone not answered", J, "Called, no answer.", 3, { script: { kind: "escalate" } });
  add("STATE EXCHANGE REFERRALS", J, "State exchange referral received. Need to verify coverage.", 1);
  for (let i = 0; i < 2; i++) add("New Referral", J, "First outreach call.", 1, { script: { kind: "completedToday", outcome: i ? "LEFT_VOICEMAIL" : "SPOKE_WITH_FAMILY", note: i ? "No answer, left voicemail." : "Spoke with daughter, explained process. Call Monday." } });

  // ---------------- In Communication (Taylor Reed) ----------------
  const T = "Taylor Reed";
  for (let i = 0; i < 4; i++) add("In Communication", T, "Spoke with daughter, she will discuss with family. Call Monday.", 3 + i);
  for (let i = 0; i < 4; i++) add("In Communication", T, "Spoke with patient, interested in services. Follow up in 2 days.", i);
  for (let i = 0; i < 3; i++) add("In Progress", T, "Explained process to family, waiting for documents.", 4 + i);
  add("In Communication", T, "Spoke with pt, call tomorrow after 2 PM.", 0);
  for (let i = 0; i < 3; i++) add(pick(["Plan to Plan Transfer", "Agency Transfer"]), T, "Intro call completed, explained transfer process.", 2 + i);
  add("In Communication", T, "Followed up with family.", 2, { script: { kind: "completedToday", outcome: "SPOKE_WITH_FAMILY", note: "Spoke with son, he will send documents. Follow up in 3 days." } });

  // ---------------- Authorization / Start of Care (Casey Park) ----------------
  const C = "Casey Park";
  for (let i = 0; i < 4; i++) add("Potential Start Date", C, "Authorization pending with plan, called for update.", 1 + i);
  for (let i = 0; i < 3; i++) add("Potential Start Date", C, "Plan approved hours, waiting on start date.", 3 + i);
  add("Rehab Case_Potential Start Date", C, `Discharge scheduled ${md(addDays(now, 4))}. Call after discharge to confirm SOC.`, 1);
  add("Admitted_Needs More Hours", C, "Requested increase in hours from plan.", 5);
  add("Potential Start Date", C, "Called plan for authorization.", 2, { script: { kind: "completedToday", outcome: "AUTHORIZATION_PENDING", note: "Authorization still pending with plan." } });

  // ---------------- Data quality examples ----------------
  for (let i = 0; i < 3; i++) add("In Communication", null, "Referral received, coordinator not yet assigned.", 1 + i);
  add(null, J, "Referral entered without a status.", 2);
  add("Some Unknown Status", J, "Status from source system not recognized.", 1);
  add("MLTC RN Assessment", D, `NYIA scheduled ${md(addDays(now, 5))}, RN assessment scheduled ${md(addDays(now, 12))}.`, 1);
  add("In Communication", T, `Pt number changed ${md(addDays(now, 6))}`, 1);
  add("Medicaid Application", M, "Called HRA, application pending.", 3, { invalidDates: ['Received Date: "13/45/2026"'], receivedDate: null });
  add("Public Assistance", null, "Patient applying for public assistance.", 2);

  // ---------------- Hold / Closed ----------------
  for (let i = 0; i < 4; i++) add("Hold", pick([J, T]), "Patient asked to put the case on hold.", 10 + i);
  for (let i = 0; i < 4; i++) add("Lost", pick([J, M]), "Patient chose another agency. Case closed.", 20 + i);
  for (let i = 0; i < 4; i++) add("Admitted", pick([C, D]), "Services started. Intake complete.", 15 + i);
  add("HMO", J, "Legacy HMO case.", 40);

  return out;
}

/** A small fake CSV (same columns as the referral export) for demoing the import. */
export function buildSampleCsv(now: Date): string {
  const headers = ["Referral ID", "First Name", "Last Name", "Referral Source Name", "Address Line 1", "Last Note", "Home Phone", "Phone 2", "Medicaid Number", "Last Note Date", "Status", "Intake Person", "Received Date"];
  const dt = (d: Date) => format(d, "M/d/yyyy h:mm:ss a");
  const day = (d: Date) => format(d, "M/d/yyyy") + " 12:00:00 AM";
  const md = (d: Date) => format(d, "M/d");
  const r = (id: string, first: string, last: string, note: string, noteDate: Date, status: string, intake: string, received: Date) =>
    [id, first, last, "Community Outreach", "100 Example St", note, "555-0199", "", "", dt(noteDate), status, intake, day(received)];
  const rows: string[][] = [
    // updates to seeded demo cases
    r("DEMO-10001", "Ava", "Sample", "Spoke with HRA - application approved pending final letter.", subDays(now, 0), "Medicaid Application Sent", "Maya Torres", subDays(now, 40)),
    r("DEMO-10040", "Liam", "Testwell", `RN assessment scheduled ${md(addDays(now, 6))}. Call after assessment.`, subDays(now, 0), "MLTC RN Assessment (Scheduled)", "Daniel Brooks", subDays(now, 30)),
    // new referrals
    r("DEMO-20001", "Nora", "Fixtura", "New referral from hospital discharge planner.", subDays(now, 0), "New Referral", "Jordan Ellis", now),
    r("DEMO-20002", "Owen", "Draftley", "Called twice, no answer, left VM.", subDays(now, 1), "Phone not answered", "Jordan Ellis", subDays(now, 3)),
    r("DEMO-20003", "Ruby", "Stubbins", "Medicaid application submitted, waiting for Medicaid.", subDays(now, 2), "Medicaid Application", "Maya Torres", subDays(now, 9)),
    r("DEMO-20004", "Miles", "Modelsky", `NYIA scheduled ${md(addDays(now, 3))}.`, subDays(now, 1), "Maximus Scheduled", "Daniel Brooks", subDays(now, 12)),
    r("DEMO-20005", "Leo", "Specimen", "Member has code 54.", subDays(now, 1), "MLTC RN ASSESSMENT 54 CODE", "Daniel Brooks", subDays(now, 20)),
    r("DEMO-20006", "Zoe", "Pretendo", "H-78 on file.", subDays(now, 2), "MLTC RN ASSESSMENT H78 CODE", "Daniel Brooks", subDays(now, 25)),
    r("DEMO-20007", "Isaac", "Seedwell", "Spoke with daughter. Call Monday.", subDays(now, 1), "In Communication", "", subDays(now, 4)),
    r("DEMO-20008", "Layla", "Trialsen", "Authorization pending.", subDays(now, 3), "Potential Start Date", "Casey Park", subDays(now, 30)),
    r("DEMO-20008", "Layla", "Trialsen", "Older duplicate row.", subDays(now, 9), "Potential Start Date", "Casey Park", subDays(now, 30)),
    ["", "No", "Id", "", "", "Row without a Referral ID", "", "", "", dt(now), "Hold", "", day(now)],
  ];
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return [headers, ...rows].map((row) => row.map(esc).join(",")).join("\n") + "\n";
}
