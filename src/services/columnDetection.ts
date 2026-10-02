/** Header-name based column detection (browser-safe, no server deps). */

export type ReferralField =
  | "referralId"
  | "firstName"
  | "lastName"
  | "patientName"
  | "referralSource"
  | "lastNote"
  | "lastNoteDate"
  | "status"
  | "intakePerson"
  | "receivedDate"
  | "homePhone"
  | "phone2"
  | "medicaidNumber";

const ALIASES: Record<ReferralField, string[]> = {
  referralId: ["referral id", "referralid", "referral #", "referral number", "referral no", "ref id"],
  firstName: ["first name", "firstname", "patient first name", "member first name"],
  lastName: ["last name", "lastname", "patient last name", "member last name"],
  patientName: ["patient name", "patient", "member name", "client name", "name"],
  referralSource: ["referral source name", "referral source", "source"],
  lastNote: ["last note", "latest note", "note", "notes", "last comment"],
  lastNoteDate: ["last note date", "latest note date", "note date", "last note datetime"],
  status: ["status", "referral status", "current status"],
  intakePerson: ["intake person", "intake coordinator", "coordinator", "assigned to", "intake"],
  receivedDate: ["received date", "date received", "referral date", "received"],
  homePhone: ["home phone", "phone", "phone 1", "primary phone"],
  phone2: ["phone 2", "phone2", "secondary phone", "mobile phone", "cell phone"],
  medicaidNumber: ["medicaid number", "medicaid #", "medicaid id", "cin"],
};

export const REQUIRED_FIELDS: ReferralField[] = ["referralId"];
export const IMPORTANT_FIELDS: ReferralField[] = ["referralId", "lastNote", "lastNoteDate", "status", "intakePerson", "receivedDate"];

const normHeader = (h: string) => h.replace(/^﻿/, "").replace(/[_\s]+/g, " ").trim().toLowerCase();

export interface ColumnMapping {
  mapping: Partial<Record<ReferralField, string>>;
  unmapped: string[];
  missingRequired: ReferralField[];
  missingImportant: ReferralField[];
}

export function detectColumns(headers: string[]): ColumnMapping {
  const mapping: Partial<Record<ReferralField, string>> = {};
  const used = new Set<string>();
  // exact alias match first, in alias priority order
  for (const field of Object.keys(ALIASES) as ReferralField[]) {
    for (const alias of ALIASES[field]) {
      const h = headers.find((x) => !used.has(x) && normHeader(x) === alias);
      if (h) {
        mapping[field] = h;
        used.add(h);
        break;
      }
    }
  }
  return {
    mapping,
    unmapped: headers.filter((h) => !used.has(h)),
    missingRequired: REQUIRED_FIELDS.filter((f) => !mapping[f]),
    missingImportant: IMPORTANT_FIELDS.filter((f) => !mapping[f]),
  };
}

