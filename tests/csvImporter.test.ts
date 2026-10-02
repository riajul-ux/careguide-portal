import { describe, it, expect } from "vitest";
import { detectColumns, normalizeRow, parseCsvText, planImport } from "../src/services/csvImporter";

const CSV = `Last Note,Status,Referral ID,First Name,Last Name,Intake Person,Last Note Date,Received Date
"Called, no answer",Medicaid Application,1001,JANE,DOE,Test Person,10/1/2026 2:22:38 PM,9/1/2026 12:00:00 AM
Spoke with pt,In Communication,1002,John,Roe,,10/1/2026 9:00:00 AM,not a date
Older note,In Communication,1002,John,Roe,,9/1/2026 9:00:00 AM,
,Hold,,No,Id,,,
`;

describe("csvImporter", () => {
  const parsed = parseCsvText(CSV);
  const cols = detectColumns(parsed.headers);

  it("detects columns by header name regardless of position", () => {
    expect(cols.mapping.referralId).toBe("Referral ID");
    expect(cols.mapping.lastNote).toBe("Last Note");
    expect(cols.mapping.lastNoteDate).toBe("Last Note Date");
    expect(cols.mapping.status).toBe("Status");
    expect(cols.mapping.intakePerson).toBe("Intake Person");
    expect(cols.missingRequired).toEqual([]);
  });

  it("normalizes rows, flags invalid dates and missing IDs", () => {
    const results = parsed.rows.map((r, i) => normalizeRow(r, cols.mapping, i + 1));
    expect(results[0].row?.patientName).toBe("Jane Doe");
    expect(results[0].row?.lastNoteDate?.getHours()).toBe(14);
    expect(results[1].row?.invalidDates.length).toBe(1);
    expect(results[3].error?.message).toMatch(/Missing Referral ID/);
  });

  it("plans new / updated / unchanged and de-duplicates by Referral ID", () => {
    const rows = parsed.rows.map((r, i) => normalizeRow(r, cols.mapping, i + 1)).filter((x) => x.row).map((x) => x.row!);
    const existing = new Map([
      ["1001", { id: "c1", referralId: "1001", lastNote: "Old note", lastNoteDate: null, currentStatus: "Medicaid Application", intakePerson: "Test Person" }],
    ]);
    const plan = planImport(rows, existing);
    expect(plan.creates.map((r) => r.referralId)).toEqual(["1002"]);
    expect(plan.creates[0].lastNote).toBe("Spoke with pt"); // newer duplicate kept
    expect(plan.duplicatesInFile).toBe(1);
    expect(plan.updates).toHaveLength(1);
    expect(plan.updates[0].changes.map((c) => c.field).sort()).toEqual(["lastNote", "lastNoteDate"]);

    const again = planImport([rows[0]], new Map([["1001", { id: "c1", referralId: "1001", lastNote: rows[0].lastNote, lastNoteDate: rows[0].lastNoteDate, currentStatus: rows[0].status, intakePerson: rows[0].intakePerson }]]));
    expect(again.unchanged).toHaveLength(1);
  });
});
