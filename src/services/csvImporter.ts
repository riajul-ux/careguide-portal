/**
 * csvImporter
 * ------------
 * Pure CSV handling: column detection (by header name, never by position),
 * row normalization and import planning (new / updated / unchanged / errors).
 * Persistence is in importRunner.ts.
 *
 * This is the seam to replace with an approved HHAeXchange integration later:
 * anything producing `NormalizedReferral[]` can feed `planImport`.
 */
import Papa from "papaparse";
import { parseFlexibleDate } from "../lib/time";

import { detectColumns, type ColumnMapping, type ReferralField } from "./columnDetection";
export { detectColumns, IMPORTANT_FIELDS, REQUIRED_FIELDS } from "./columnDetection";
export type { ColumnMapping, ReferralField } from "./columnDetection";

export interface NormalizedReferral {
  rowNumber: number; // 1-based data row (header excluded)
  referralId: string;
  patientName: string | null;
  referralSource: string | null;
  lastNote: string | null;
  lastNoteDate: Date | null;
  status: string | null;
  intakePerson: string | null;
  receivedDate: Date | null;
  homePhone: string | null;
  phone2: string | null;
  medicaidNumber: string | null;
  invalidDates: string[];
}

export interface RowError {
  rowNumber: number;
  referralId?: string;
  message: string;
}

const clean = (v: unknown): string | null => {
  if (v === undefined || v === null) return null;
  const s = String(v).replace(/\s+/g, " ").trim();
  return s ? s : null;
};

function titleCaseIfUpper(s: string | null): string | null {
  if (!s) return s;
  return s === s.toUpperCase() ? s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) : s;
}

export function normalizeRow(raw: Record<string, unknown>, mapping: ColumnMapping["mapping"], rowNumber: number): { row?: NormalizedReferral; error?: RowError } {
  const get = (f: ReferralField) => (mapping[f] ? clean(raw[mapping[f]!]) : null);
  const referralId = get("referralId");
  if (!referralId) return { error: { rowNumber, message: "Missing Referral ID" } };

  const invalidDates: string[] = [];
  const dateField = (f: ReferralField, label: string): Date | null => {
    const v = parseFlexibleDate(get(f));
    if (v === "invalid") {
      invalidDates.push(`${label}: "${get(f)}"`);
      return null;
    }
    return v;
  };

  const first = get("firstName");
  const last = get("lastName");
  const patientName = get("patientName") ?? (titleCaseIfUpper([first, last].filter(Boolean).join(" ") || null));

  return {
    row: {
      rowNumber,
      referralId,
      patientName,
      referralSource: get("referralSource"),
      lastNote: get("lastNote"),
      lastNoteDate: dateField("lastNoteDate", "Last Note Date"),
      status: get("status"),
      intakePerson: get("intakePerson"),
      receivedDate: dateField("receivedDate", "Received Date"),
      homePhone: get("homePhone"),
      phone2: get("phone2"),
      medicaidNumber: get("medicaidNumber"),
      invalidDates,
    },
  };
}

export interface ParsedCsv {
  headers: string[];
  rows: Record<string, unknown>[];
  parseErrors: RowError[];
}

export function parseCsvText(text: string): ParsedCsv {
  const result = Papa.parse<Record<string, unknown>>(text.replace(/^﻿/, ""), {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim(),
  });
  return {
    headers: result.meta.fields ?? [],
    rows: result.data,
    parseErrors: result.errors.slice(0, 200).map((e) => ({ rowNumber: (e.row ?? 0) + 1, message: `CSV parse: ${e.message}` })),
  };
}

// ---------------------------------------------------------------------------
// Import planning
// ---------------------------------------------------------------------------

/** Fields the import is allowed to update on an existing case. */
export const UPDATABLE_FIELDS = ["lastNote", "lastNoteDate", "status", "intakePerson"] as const;
export type UpdatableField = (typeof UPDATABLE_FIELDS)[number];

export interface ExistingCaseSnapshot {
  id: string;
  referralId: string;
  lastNote: string | null;
  lastNoteDate: Date | null;
  currentStatus: string | null;
  intakePerson: string | null;
}

export interface FieldChange {
  field: UpdatableField;
  oldValue: string | null;
  newValue: string | null;
}

export interface ImportPlan {
  creates: NormalizedReferral[];
  updates: { existing: ExistingCaseSnapshot; row: NormalizedReferral; changes: FieldChange[] }[];
  unchanged: NormalizedReferral[];
  errors: RowError[];
  duplicatesInFile: number;
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

function diff(existing: ExistingCaseSnapshot, row: NormalizedReferral): FieldChange[] {
  const changes: FieldChange[] = [];
  const cmp = (field: UpdatableField, oldV: string | null, newV: string | null) => {
    if ((oldV ?? "") !== (newV ?? "")) changes.push({ field, oldValue: oldV, newValue: newV });
  };
  cmp("lastNote", existing.lastNote, row.lastNote);
  cmp("lastNoteDate", iso(existing.lastNoteDate), iso(row.lastNoteDate));
  cmp("status", existing.currentStatus, row.status);
  cmp("intakePerson", existing.intakePerson, row.intakePerson);
  return changes;
}

export function planImport(rows: NormalizedReferral[], existing: Map<string, ExistingCaseSnapshot>, preErrors: RowError[] = []): ImportPlan {
  const errors: RowError[] = [...preErrors];
  // De-duplicate Referral IDs within the file: keep the row with the newest Last Note Date.
  const byId = new Map<string, NormalizedReferral>();
  let duplicatesInFile = 0;
  for (const r of rows) {
    const prev = byId.get(r.referralId);
    if (!prev) {
      byId.set(r.referralId, r);
      continue;
    }
    duplicatesInFile++;
    const keep = (r.lastNoteDate?.getTime() ?? 0) >= (prev.lastNoteDate?.getTime() ?? 0) ? r : prev;
    const drop = keep === r ? prev : r;
    byId.set(r.referralId, keep);
    errors.push({ rowNumber: drop.rowNumber, referralId: r.referralId, message: `Duplicate Referral ID in file - kept row ${keep.rowNumber} (newer note)` });
  }

  const plan: ImportPlan = { creates: [], updates: [], unchanged: [], errors, duplicatesInFile };
  for (const row of byId.values()) {
    const ex = existing.get(row.referralId);
    if (!ex) {
      plan.creates.push(row);
      continue;
    }
    const changes = diff(ex, row);
    if (changes.length) plan.updates.push({ existing: ex, row, changes });
    else plan.unchanged.push(row);
  }
  return plan;
}
