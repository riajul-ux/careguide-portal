# CareGuide Portal — Intake / Follow-Up Management (MVP)

A working web portal for Intake, MLTC, Medicaid and supervisors to manage referral
follow-ups from referral status, latest notes, department rules, follow-up dates and
coordinator workload.

Data comes from **CSV imports** of the referral export. **HHAeXchange is not connected yet.**

## Run it

Requires Node.js 20+.

```bash
npm install
npm run dev
```

Open http://localhost:3000.

On first start `npm run dev` creates the local SQLite database (`prisma/dev.db`), applies
the migrations and loads **fake** demo data (136 cases, no real patient information).

| Command | What it does |
|---|---|
| `npm run dev` | Start the portal (creates/migrates/seeds the DB if needed) |
| `npm test` | Business-rule tests (Vitest) |
| `npm run db:seed` | Wipe and reload demo data (also: Settings > Reset demo data) |
| `npm run build && npm start` | Production build |

The business timezone is `APP_TIMEZONE` in `.env` (default `America/New_York`); "today",
"due today" and "overdue" are computed with it.

## Put it online (public showcase)

The repo includes a `Dockerfile` and a Render blueprint (`render.yaml`). Hosted copies run
in **demo mode** (`DEMO_MODE=true`): a "fake data" banner is shown, demo data reloads once per
day so due dates stay realistic, and uploaded CSV files are not stored.

**GitHub Codespaces (free, no credit card - recommended):**
1. On GitHub open this repository, switch to the branch with this code, click **Code > Codespaces > Create codespace on ...**.
2. Wait ~3-5 minutes. The portal installs, builds and starts by itself (port 3000, demo mode).
3. Open the **PORTS** tab, right-click port 3000 > **Port Visibility > Public**, then copy the
   forwarded address (`https://<name>-3000.app.github.dev`) and share it.

Free personal accounts include 120 core-hours/month (~60 hours on the default 2-core machine). The codespace
stops after 30 minutes of inactivity (raise it to 4 hours under GitHub Settings > Codespaces); open it
again from Code > Codespaces and the same link works once it restarts. Stop it when you are done.

**Render (may ask for a credit card even on the free plan):**
1. Sign in at https://render.com with GitHub and allow access to this repository.
2. **New > Blueprint**, pick `careguide-portal`, branch with this code, then **Apply**.
3. Wait for the build (~5 min). Render gives you a URL like `https://careguide-portal-demo.onrender.com`.

On the free plan the service sleeps after ~15 min idle (first visit then takes ~1 minute) and
data resets on each restart. Any Docker host (Railway, Fly.io, Azure App Service, a VM) also works:
`docker build -t careguide . && docker run -p 3000:3000 careguide`.

**Never upload the real referral export to a public demo** - it contains PHI and there is no login.
A real deployment needs authentication, a BAA-covered host and a managed database first.

## Demo walkthrough (Phase 1 workflow)

Use the **Demo role** switcher at the top right (no real authentication in the MVP).

1. **Import** — Import page → drag & drop the referral CSV (or click "Download fake
   sample CSV" and drop that). Review file name, row count, detected columns and the
   first 20 rows → **Import Referrals** → see new / updated / unchanged / errors.
2. **Coordinator dashboard** — role "Coordinator - MLTC (Daniel Brooks)". KPI cards and
   the prioritized list: Overdue → Due Today → Due Later Today → Upcoming.
3. **See what needs follow-up today** — click the Due Today / Overdue cards.
4. **Open a referral** — click **Work** on a row.
5. **Read the last note** — "Latest note" card.
6. **System interpretation** — what happened, recommended action, detected date, reason, confidence.
7. **Perform the follow-up / 8. record the outcome** — choose e.g. **No Answer**, add a note, **Complete follow-up**.
9. **Next follow-up is created automatically** — for MLTC a no-answer at 10:00 AM creates a
   2:00 PM "MLTC Phone Retry — Attempt 2 of 6" (Due Later Today). Medicaid gets +4 days.
   Try a note like `RN assessment scheduled 10/28. Call after assessment.` — the next
   follow-up becomes 10/28 instead of the 2-day rule.
10. **Workload updates** — back on the dashboard, Completed Today goes up.
11. **Switch to Supervisor (Sam Whitfield)**.
12. **Who completed today's work** — coordinator table (Worked Today / Remaining Today). Every number links to the underlying list.
13. **Overdue cases** — Overdue card or the per-coordinator Overdue column.
14. **Six-attempt escalations** — Escalations page: Return to Coordinator, Reassign, Add Instruction, Mark Reviewed, Close Escalation.
15. **Modify rules** — Rules page (Supervisor or Admin): e.g. change Medicaid Application from 4 to 5 days; "Re-apply to open cases" recalculates open rule-generated tasks.

Also: **Needs Review** queue (missing coordinator/department, unknown status, no future
follow-up, unconfigured rule, invalid date, ambiguous note) with bulk assignment.

## Where the rule configuration lives

- **Live rules: the `StatusRule` table**, edited in the UI at **Rules** (Admin > Follow-Up Rules).
  No code change needed; every edit is written to `AuditLog`.
- Initial values: `src/lib/defaultRules.ts` (only used when seeding).
- Rule logic: `src/services/followUpEngine.ts`.

Confirmed rules seeded as given: Medicaid every 4 days; MLTC every 2 days; MLTC + No
Answer → retry after 4 hours same day; Phone Not Answered → max 6 attempts, escalate after 6;
HMO inactive; **Code 54 — "Rule not configured"** (manual assignment / supervisor review);
**H-78 — "Duration not configured"** (manual dates allowed).
Intervals for the other departments (Intake, In Communication, Authorization, transfers,
CHHA, OPWDD, NHTD, Private Pay) are **placeholders** flagged "Placeholder - confirm" on the
Rules page. Statuses with no known routing (Public Assistance, Cash Assistance,
CA_Interview Completed, Code 48) are "Rule not configured".

### Business rules implemented

- **Case ≠ task.** Completing a task (even "No Answer") credits the coordinator; the case stays open.
- **Next follow-up priority:** 1) explicit date in the latest note, 2) department/status rule,
  3) manual coordinator date. A coordinator can tick "use my date" to override (audit-logged).
- **Unsuccessful contact** (No Answer, Left Voicemail) increments the attempt counter
  ("Attempt 2 of 6"); a successful contact resets it. The 6th unsuccessful attempt completes the
  task, keeps the case unresolved, creates an escalation, and sets the case to Supervisor Review.
- **Same-day retry** (MLTC, 4h): if the retry would land after business hours (Settings,
  default 6 PM) it moves to 9 AM the next business day.
- **Task states:** Overdue, Due Today, Due Later Today, Upcoming, Waiting, Completed, Supervisor Review —
  computed from the current date/time on every page load.
- **Never invents dates:** unconfigured rules produce no date. The note parser only
  returns a date that is written in the note or follows from an explicit phrase anchored to the
  note date ("call tomorrow", "follow up in 3 days", "call Monday", "next week" = Monday of next week).

## Architecture

```
src/services/          business logic (UI-independent)
  noteInterpreter.ts   NoteInterpreter interface + deterministic RuleBasedNoteInterpreter
                       (swap via setNoteInterpreter() for an LLM-backed implementation)
  followUpEngine.ts    rule resolution, next-date priority, outcomes, retries, task states (pure)
  escalationEngine.ts  escalation thresholds and supervisor action transitions (pure)
  assignmentEngine.ts  department / coordinator / supervisor assignment (pure, never guesses)
  caseEvaluator.ts     derives department, stage, state, first follow-up and data-quality flags (pure)
  columnDetection.ts   CSV header detection by name (not position)
  csvImporter.ts       CSV parsing, normalization, import planning (pure)
  importRunner.ts      persists an import (DB)
  workflowService.ts   complete task, escalations, assignment, manual dates, re-apply rules (DB)
  queries.ts           dashboard / worklist / report queries
src/app/               Next.js pages + server actions (actions.ts) + /api/import
tests/                 Vitest tests for the business rules
prisma/                schema, migrations, seed
```

## Database structure (SQLite via Prisma — `prisma/schema.prisma`)

| Model | Purpose |
|---|---|
| `Case` | One per Referral ID: patient, status, department, intake person, assigned coordinator/supervisor, received date, last note + date, process, stage, case state (ACTIVE / SUPERVISOR_REVIEW / HOLD / RESOLVED / CLOSED), no-answer attempt count, cached note interpretation, data-quality flags |
| `FollowUpTask` | A dated follow-up for a case: coordinator, department, type (FOLLOW_UP / PHONE_RETRY / NOTE_DATE / MANUAL / SUPERVISOR_REVIEW), reason, due date (+ optional time), status (OPEN / COMPLETED / CANCELLED), waiting-on, outcome, attempt n of max, generated by (RULE / NOTE / MANUAL / RETRY / ESCALATION / SUPERVISOR) |
| `FollowUpHistory` | Timeline: follow-ups, notes, outcomes, status changes, assignments, escalations, imports |
| `StatusRule` | Configurable rules (status, department, process, stage, outcome, interval days, same-day retry hours, max attempts, escalate after, active, configured, hold, closed, supervisor review, placeholder, instructions) |
| `Escalation` | Supervisor queue (reason, attempts, last attempt, status OPEN / REVIEWED / RETURNED / CLOSED, instructions) |
| `AuditLog` | Who changed what, with old/new values (imports, rule edits, assignments, overrides) |
| `ImportBatch` | Each CSV import: counts, errors, detected columns, path of the stored copy |
| `User`, `Department`, `AppSetting` | Demo users/roles, departments with default supervisor, business hours |

## CSV import notes

- Columns are matched by header name (aliases in `src/services/columnDetection.ts`); only
  Referral ID is required.
- Existing Referral IDs: Last Note, Last Note Date, Status and Intake Person are updated; old
  values are kept in `AuditLog` and the case history. Tasks are recalculated only when the
  imported note is newer than the last in-portal action.
- Duplicate Referral IDs in one file: the row with the newest Last Note Date wins (reported).
- The uploaded file is saved as a new timestamped copy under `data/imports/` (git-ignored,
  write-once) — the original is never modified.
- Tested against the real export: 16,779 rows → 16,007 cases in ~10 s; re-import = all unchanged.

**Privacy:** the real export contains PHI (names, phones, Medicaid numbers). `data/` and the
database are git-ignored; never commit them. Demo data is fake (`DEMO-` IDs, 555-01xx phones).

## What remains for HHAeXchange integration

1. Approved API access/credentials and a BAA; store secrets outside the repo.
2. An `HhaxReferralSource` that maps HHAeXchange referral/patient records to
   `NormalizedReferral` and feeds the existing `runImportRows()` (matching by Referral ID
   already works) — scheduled sync instead of manual upload, with incremental/changed-since pulls.
3. Field mapping confirmation (status codes, intake person → user, note history vs. last note only).
4. Optional write-back of follow-up notes/status to HHAeXchange, with conflict rules.
5. Production hardening: real authentication/SSO and role permissions, PostgreSQL instead of
   SQLite, PHI encryption at rest, access logging, backups, hosting.
6. Business decisions still open: Code 54 routing, H-78 duration, and confirmation of the
   placeholder intervals on the Rules page.
