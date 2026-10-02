/**
 * importRunner
 * -------------
 * Persists a referral import. The uploaded file is stored as a separate,
 * timestamped copy under data/imports/ and is never modified.
 *
 * Matching is by Referral ID:
 *   - new ID       -> create case (+ first follow-up task when a date can be determined)
 *   - existing ID  -> update Last Note, Last Note Date, Status, Intake Person;
 *                     every old value is kept in AuditLog + FollowUpHistory
 *   - no change    -> unchanged
 */
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "../lib/db";
import { toHHmm } from "../lib/time";
import { computeIssues, evaluateCase, type CaseEvaluation } from "./caseEvaluator";
import {
  detectColumns,
  normalizeRow,
  parseCsvText,
  planImport,
  type ColumnMapping,
  type ExistingCaseSnapshot,
  type NormalizedReferral,
  type RowError,
} from "./csvImporter";
import { loadRuleContext, type RuleContext } from "./workflowService";

export interface ImportSummary {
  batchId: string;
  fileName: string;
  rowCount: number;
  newCount: number;
  updatedCount: number;
  unchangedCount: number;
  errorCount: number;
  duplicatesInFile: number;
  errors: RowError[];
  columns: ColumnMapping;
  storedPath: string | null;
  newCoordinators: string[];
}

const CHUNK = 400;

function chunks<T>(arr: T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function storeCopy(fileName: string, text: string): Promise<string | null> {
  try {
    const dir = path.join(process.cwd(), "data", "imports");
    await mkdir(dir, { recursive: true });
    const safe = fileName.replace(/[^a-zA-Z0-9._ ()-]/g, "_");
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const p = path.join(dir, `${stamp}__${safe}`);
    await writeFile(p, text, { flag: "wx" }); // wx: never overwrite
    return path.relative(process.cwd(), p);
  } catch {
    return null;
  }
}

function caseCreateData(id: string, row: NormalizedReferral, ev: CaseEvaluation, source: string, now: Date) {
  return {
    id,
    referralId: row.referralId,
    patientName: row.patientName,
    referralSource: row.referralSource,
    homePhone: row.homePhone,
    phone2: row.phone2,
    medicaidNumber: row.medicaidNumber,
    currentStatus: row.status,
    department: ev.department,
    intakePerson: row.intakePerson,
    assignedCoordinator: ev.assignedCoordinator,
    assignedSupervisor: ev.assignedSupervisor,
    receivedDate: row.receivedDate,
    lastNote: row.lastNote,
    lastNoteDate: row.lastNoteDate,
    currentStage: ev.stage,
    process: ev.process,
    caseState: ev.caseState,
    statusRuleId: ev.rule?.id ?? null,
    noAnswerAttempts: 0,
    interpretationJson: JSON.stringify(ev.interpretation),
    interpretationConfidence: ev.interpretation.confidence,
    dataIssuesJson: JSON.stringify(ev.issues),
    source,
    createdAt: now,
  };
}

function firstTaskData(caseId: string, ev: CaseEvaluation, attemptNumber: number) {
  const n = ev.nextFollowUp;
  if (!n.dueDate || ev.caseState !== "ACTIVE") return null;
  return {
    id: randomUUID(),
    caseId,
    assignedCoordinator: ev.assignedCoordinator,
    department: ev.department,
    taskType: n.source === "NOTE" ? "NOTE_DATE" : "FOLLOW_UP",
    reason: n.reason,
    dueDate: n.dueDate,
    hasDueTime: n.hasTime,
    dueTime: n.hasTime ? toHHmm(n.dueDate) : null,
    priority: 3,
    status: "OPEN",
    waitingOn: ev.interpretation.waitingOn,
    attemptNumber,
    generatedBy: n.source === "NOTE" ? "NOTE" : "RULE",
  };
}

export async function runImportText(fileName: string, text: string, user: string, opts: { source?: string; storeFile?: boolean; now?: Date } = {}): Promise<ImportSummary> {
  const parsed = parseCsvText(text);
  const columns = detectColumns(parsed.headers);
  if (columns.missingRequired.length) {
    throw new Error(`Required column missing: ${columns.missingRequired.join(", ")}. Detected columns: ${parsed.headers.join(", ")}`);
  }
  const storedPath = opts.storeFile === false || process.env.DEMO_MODE === "true" ? null : await storeCopy(fileName, text);
  const rows: NormalizedReferral[] = [];
  const errors: RowError[] = [...parsed.parseErrors];
  parsed.rows.forEach((r, i) => {
    const res = normalizeRow(r, columns.mapping, i + 1);
    if (res.row) rows.push(res.row);
    else if (res.error) errors.push(res.error);
  });
  return runImportRows(fileName, rows, user, { ...opts, columns, storedPath, preErrors: errors, rowCount: parsed.rows.length });
}

export async function runImportRows(
  fileName: string,
  rows: NormalizedReferral[],
  user: string,
  opts: { source?: string; now?: Date; columns?: ColumnMapping; storedPath?: string | null; preErrors?: RowError[]; rowCount?: number; ctx?: RuleContext } = {},
): Promise<ImportSummary> {
  const now = opts.now ?? new Date();
  const source = opts.source ?? "IMPORT";
  const ctx = opts.ctx ?? (await loadRuleContext());
  const evalOpts = { rules: ctx.rules, departments: ctx.departments, defaultSupervisor: ctx.settings.defaultSupervisor, now };

  const existingRows = await prisma.case.findMany({
    where: { referralId: { in: rows.map((r) => r.referralId) } },
  });
  const existingFull = new Map(existingRows.map((c) => [c.referralId, c]));
  const snapshots = new Map<string, ExistingCaseSnapshot>(
    existingRows.map((c) => [c.referralId, { id: c.id, referralId: c.referralId, lastNote: c.lastNote, lastNoteDate: c.lastNoteDate, currentStatus: c.currentStatus, intakePerson: c.intakePerson }]),
  );
  const plan = planImport(rows, snapshots, opts.preErrors ?? []);
  for (const r of rows) if (r.invalidDates.length) plan.errors.push({ rowNumber: r.rowNumber, referralId: r.referralId, message: `Invalid date - ${r.invalidDates.join("; ")} (imported without it, flagged for review)` });

  // ---- creates ---------------------------------------------------------------
  const caseRows: ReturnType<typeof caseCreateData>[] = [];
  const taskRows: NonNullable<ReturnType<typeof firstTaskData>>[] = [];
  const historyRows: { id: string; caseId: string; coordinator: string; actionDate: Date; actionType: string; note: string; nextFollowUpDate: Date | null }[] = [];
  const auditRows: { id: string; user: string; action: string; entityType: string; entityId: string; details: string; timestamp: Date }[] = [];

  for (const row of plan.creates) {
    const ev = evaluateCase(
      { currentStatus: row.status, intakePerson: row.intakePerson, lastNote: row.lastNote, lastNoteDate: row.lastNoteDate, receivedDate: row.receivedDate, invalidDates: row.invalidDates },
      evalOpts,
    );
    const id = randomUUID();
    caseRows.push(caseCreateData(id, row, ev, source, now));
    const t = firstTaskData(id, ev, 1);
    if (t) taskRows.push(t);
    historyRows.push({
      id: randomUUID(),
      caseId: id,
      coordinator: user,
      actionDate: now,
      actionType: "IMPORT",
      note: `Imported from ${fileName}. Status: ${row.status ?? "—"}.${t ? ` Next follow-up: ${t.reason}` : ev.caseState === "ACTIVE" ? ` ${ev.nextFollowUp.reason}.` : ""}`,
      nextFollowUpDate: t?.dueDate ?? null,
    });
    auditRows.push({ id: randomUUID(), user, action: "CASE_CREATED_FROM_IMPORT", entityType: "Case", entityId: id, details: JSON.stringify({ fileName, referralId: row.referralId }), timestamp: now });
  }

  await prisma.$transaction(
    async (db) => {
      for (const c of chunks(caseRows)) await db.case.createMany({ data: c });
      for (const c of chunks(taskRows)) await db.followUpTask.createMany({ data: c });
      for (const c of chunks(historyRows)) await db.followUpHistory.createMany({ data: c });
      for (const c of chunks(auditRows)) await db.auditLog.createMany({ data: c });

      // ---- updates -----------------------------------------------------------
      for (const u of plan.updates) {
        const c = existingFull.get(u.row.referralId)!;
        const statusChanged = u.changes.some((x) => x.field === "status");
        const noteChanged = u.changes.some((x) => x.field === "lastNote" || x.field === "lastNoteDate");
        const newerThanApp = !c.lastActionAt || (u.row.lastNoteDate && u.row.lastNoteDate > c.lastActionAt);

        const ev = evaluateCase(
          { currentStatus: u.row.status, intakePerson: u.row.intakePerson, assignedCoordinator: c.assignedCoordinator, assignedSupervisor: c.assignedSupervisor, lastNote: u.row.lastNote, lastNoteDate: u.row.lastNoteDate, receivedDate: c.receivedDate, invalidDates: u.row.invalidDates },
          evalOpts,
        );

        const data: Record<string, unknown> = {
          lastNote: u.row.lastNote,
          lastNoteDate: u.row.lastNoteDate,
          currentStatus: u.row.status,
          intakePerson: u.row.intakePerson,
        };
        if (statusChanged) {
          data.department = ev.department;
          data.statusRuleId = ev.rule?.id ?? null;
          data.process = ev.process;
          data.currentStage = ev.stage;
          if (c.caseState !== "SUPERVISOR_REVIEW") data.caseState = ev.caseState;
          if (!c.assignedCoordinator && ev.assignedCoordinator) data.assignedCoordinator = ev.assignedCoordinator;
        }
        if (noteChanged) {
          data.interpretationJson = JSON.stringify(ev.interpretation);
          data.interpretationConfidence = ev.interpretation.confidence;
          if (ev.interpretation.suggestedStage) data.currentStage = ev.interpretation.suggestedStage;
        }

        let newTaskDue: Date | null = null;
        if ((statusChanged || noteChanged) && newerThanApp && c.caseState !== "SUPERVISOR_REVIEW") {
          await db.followUpTask.updateMany({
            where: { caseId: c.id, status: "OPEN", taskType: { not: "SUPERVISOR_REVIEW" } },
            data: { status: "CANCELLED", completedAt: now, outcome: "SUPERSEDED_BY_IMPORT" },
          });
          const t = firstTaskData(c.id, { ...ev, assignedCoordinator: (data.assignedCoordinator as string) ?? c.assignedCoordinator }, c.noAnswerAttempts + 1);
          if (t) {
            await db.followUpTask.create({ data: t });
            newTaskDue = t.dueDate;
          }
        }
        await db.case.update({ where: { id: c.id }, data });

        for (const ch of u.changes) {
          await db.auditLog.create({ data: { user, action: "IMPORT_UPDATE", entityType: "Case", entityId: c.id, field: ch.field, oldValue: ch.oldValue, newValue: ch.newValue, details: JSON.stringify({ fileName }), timestamp: now } });
        }
        if (statusChanged) {
          const ch = u.changes.find((x) => x.field === "status")!;
          await db.followUpHistory.create({ data: { caseId: c.id, coordinator: user, actionDate: now, actionType: "STATUS_CHANGE", previousValue: ch.oldValue, newValue: ch.newValue, note: `Status changed by import (${fileName}): "${ch.oldValue ?? "—"}" -> "${ch.newValue ?? "—"}"` } });
        }
        if (noteChanged) {
          const old = u.changes.find((x) => x.field === "lastNote");
          await db.followUpHistory.create({ data: { caseId: c.id, coordinator: u.row.intakePerson ?? user, actionDate: u.row.lastNoteDate ?? now, actionType: "NOTE", note: u.row.lastNote, previousValue: old?.oldValue ?? null, nextFollowUpDate: newTaskDue } });
        }
        if (u.changes.some((x) => x.field === "intakePerson")) {
          const ch = u.changes.find((x) => x.field === "intakePerson")!;
          await db.followUpHistory.create({ data: { caseId: c.id, coordinator: user, actionDate: now, actionType: "ASSIGNMENT", previousValue: ch.oldValue, newValue: ch.newValue, note: `Intake person changed by import: ${ch.oldValue ?? "—"} -> ${ch.newValue ?? "—"}` } });
        }

        // data-quality flags
        const openCount = await db.followUpTask.count({ where: { caseId: c.id, status: "OPEN" } });
        const issues = computeIssues({
          caseState: (data.caseState as string) ?? c.caseState,
          assignedCoordinator: (data.assignedCoordinator as string) ?? c.assignedCoordinator,
          department: (data.department as string) ?? c.department,
          status: u.row.status,
          rule: ev.rule,
          statusKnown: !ev.issues.includes("UNKNOWN_STATUS"),
          hasNextFollowUp: openCount > 0,
          interpretation: ev.interpretation,
          invalidDates: u.row.invalidDates,
        });
        await db.case.update({ where: { id: c.id }, data: { dataIssuesJson: JSON.stringify(issues) } });
      }
    },
    { timeout: 300_000, maxWait: 20_000 },
  );

  // ---- coordinators seen in the file ------------------------------------------
  const names = Array.from(new Set(rows.map((r) => r.intakePerson?.replace(/\s+/g, " ").trim()).filter(Boolean))) as string[];
  const known = new Set((await prisma.user.findMany({ select: { name: true } })).map((u) => u.name));
  const newCoordinators = names.filter((n) => !known.has(n));
  for (const c of chunks(newCoordinators)) {
    await prisma.user.createMany({ data: c.map((name) => ({ name, role: "COORDINATOR", source: "IMPORT" })) });
  }

  const batch = await prisma.importBatch.create({
    data: {
      fileName,
      storedPath: opts.storedPath ?? null,
      rowCount: opts.rowCount ?? rows.length,
      newCount: plan.creates.length,
      updatedCount: plan.updates.length,
      unchangedCount: plan.unchanged.length,
      errorCount: plan.errors.length,
      errorsJson: JSON.stringify(plan.errors.slice(0, 500)),
      columnsJson: opts.columns ? JSON.stringify(opts.columns) : null,
      importedBy: user,
    },
  });
  await prisma.auditLog.create({ data: { user, action: "IMPORT", entityType: "ImportBatch", entityId: batch.id, details: JSON.stringify({ fileName, new: plan.creates.length, updated: plan.updates.length, unchanged: plan.unchanged.length, errors: plan.errors.length }) } });

  return {
    batchId: batch.id,
    fileName,
    rowCount: opts.rowCount ?? rows.length,
    newCount: plan.creates.length,
    updatedCount: plan.updates.length,
    unchangedCount: plan.unchanged.length,
    errorCount: plan.errors.length,
    duplicatesInFile: plan.duplicatesInFile,
    errors: plan.errors,
    columns: opts.columns ?? { mapping: {}, unmapped: [], missingRequired: [], missingImportant: [] },
    storedPath: opts.storedPath ?? null,
    newCoordinators,
  };
}
