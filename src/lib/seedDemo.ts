/** Wipes the database and loads fake demo data. Used by prisma/seed.ts and Settings > Reset demo data. */
import { addHours, isSameDay, startOfDay, subHours, subMinutes } from "date-fns";
import { prisma } from "./db";
import { DEPARTMENTS } from "./constants";
import { DEFAULT_RULES } from "./defaultRules";
import { DEMO_USERS, EXTRA_COORDINATORS, SUPERVISOR_NAME, buildDemoReferrals } from "./demoData";
import { runImportRows } from "../services/importRunner";
import { completeTask, loadRuleContext } from "../services/workflowService";

export async function wipe() {
  await prisma.auditLog.deleteMany();
  await prisma.followUpHistory.deleteMany();
  await prisma.escalation.deleteMany();
  await prisma.followUpTask.deleteMany();
  await prisma.case.deleteMany();
  await prisma.statusRule.deleteMany();
  await prisma.importBatch.deleteMany();
  await prisma.department.deleteMany();
  await prisma.user.deleteMany();
  await prisma.appSetting.deleteMany();
}

export async function seedReferenceData() {
  await prisma.department.createMany({
    data: DEPARTMENTS.map((name, i) => ({ name, sortOrder: i, isActive: true, defaultSupervisor: SUPERVISOR_NAME })),
  });
  await prisma.user.createMany({
    data: [
      ...DEMO_USERS.map((u) => ({ name: u.name, role: u.role, department: u.department, isDemo: true, source: "SEED" })),
      ...EXTRA_COORDINATORS.map((u) => ({ name: u.name, role: "COORDINATOR", department: u.department, isDemo: false, source: "SEED" })),
    ],
  });
  await prisma.appSetting.createMany({
    data: [
      { key: "businessDayStartHour", value: "9" },
      { key: "businessDayEndHour", value: "18" },
      { key: "defaultSupervisor", value: SUPERVISOR_NAME },
    ],
  });
  for (const r of DEFAULT_RULES) {
    await prisma.statusRule.create({
      data: {
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
        instructions: r.instructions ?? null,
      },
    });
  }
}

export async function seedDemo(): Promise<string> {
  const now = new Date();
  console.log(`Seeding demo data (now = ${now.toString()})`);
  await wipe();
  await seedReferenceData();

  const referrals = buildDemoReferrals(now);
  const ctx = await loadRuleContext();
  const summary = await runImportRows("demo-seed", referrals, "System (seed)", { source: "SEED", now, ctx, rowCount: referrals.length });
  console.log(`  cases created: ${summary.newCount}`);

  const caseByRef = new Map((await prisma.case.findMany({ select: { id: true, referralId: true, assignedCoordinator: true } })).map((c) => [c.referralId, c]));
  const dayStart = startOfDay(now);
  const clampToday = (d: Date) => (d < dayStart ? new Date(Math.min(now.getTime() - 60_000, dayStart.getTime() + 60_000)) : d);

  let scripted = 0;
  for (const r of referrals) {
    if (!r.script) continue;
    const c = caseByRef.get(r.referralId);
    if (!c) continue;
    const user = c.assignedCoordinator ?? "Unassigned";
    const s = r.script;
    if (s.kind === "completedToday") {
      await completeTask({ caseId: c.id, outcome: s.outcome, note: s.note, user, now: clampToday(subMinutes(now, 20 + scripted * 7)) });
    } else if (s.kind === "noAnswer") {
      for (let i = 1; i <= s.attempts; i++) {
        const at = subHours(now, (s.attempts - i) * 5 + 1);
        await completeTask({ caseId: c.id, outcome: "NO_ANSWER", note: `Called, no answer (attempt ${i}).`, user, now: at });
      }
    } else if (s.kind === "escalate") {
      for (let i = 1; i <= 6; i++) {
        const at = subHours(now, (6 - i) * 6 + 2);
        await completeTask({ caseId: c.id, outcome: i % 2 ? "NO_ANSWER" : "LEFT_VOICEMAIL", note: i % 2 ? "Called, no answer." : "No answer, left voicemail.", user, now: at });
      }
    } else if (s.kind === "laterToday") {
      const res = await completeTask({ caseId: c.id, outcome: "NO_ANSWER", note: "Called member, no answer.", user, now: subHours(now, 2) });
      const due = addHours(now, s.hoursFromNow);
      if (res.nextTaskId && isSameDay(due, now)) {
        await prisma.followUpTask.update({ where: { id: res.nextTaskId }, data: { dueDate: due, hasDueTime: true, dueTime: `${String(due.getHours()).padStart(2, "0")}:${String(due.getMinutes()).padStart(2, "0")}` } });
      }
    }
    scripted++;
  }
  console.log(`  scripted follow-up sequences: ${scripted}`);
  const [cases, tasks, esc] = await Promise.all([prisma.case.count(), prisma.followUpTask.count({ where: { status: "OPEN" } }), prisma.escalation.count()]);
  const msg = `${cases} cases, ${tasks} open tasks, ${esc} escalations`;
  console.log(`  totals: ${msg}`);
  return msg;
}

