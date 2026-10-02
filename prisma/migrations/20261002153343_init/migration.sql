-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "department" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "source" TEXT NOT NULL DEFAULT 'SEED',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Department" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "defaultSupervisor" TEXT,
    "description" TEXT
);

-- CreateTable
CREATE TABLE "Case" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "referralId" TEXT NOT NULL,
    "patientName" TEXT,
    "referralSource" TEXT,
    "homePhone" TEXT,
    "phone2" TEXT,
    "medicaidNumber" TEXT,
    "currentStatus" TEXT,
    "department" TEXT,
    "intakePerson" TEXT,
    "assignedCoordinator" TEXT,
    "assignedSupervisor" TEXT,
    "receivedDate" DATETIME,
    "lastNote" TEXT,
    "lastNoteDate" DATETIME,
    "currentStage" TEXT,
    "process" TEXT,
    "caseState" TEXT NOT NULL DEFAULT 'ACTIVE',
    "statusRuleId" TEXT,
    "noAnswerAttempts" INTEGER NOT NULL DEFAULT 0,
    "lastActionAt" DATETIME,
    "interpretationJson" TEXT,
    "interpretationConfidence" TEXT,
    "dataIssuesJson" TEXT,
    "source" TEXT NOT NULL DEFAULT 'SEED',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Case_statusRuleId_fkey" FOREIGN KEY ("statusRuleId") REFERENCES "StatusRule" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FollowUpTask" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "caseId" TEXT NOT NULL,
    "assignedCoordinator" TEXT,
    "department" TEXT,
    "taskType" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "dueDate" DATETIME NOT NULL,
    "hasDueTime" BOOLEAN NOT NULL DEFAULT false,
    "dueTime" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 3,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "waitingOn" TEXT,
    "completedAt" DATETIME,
    "completedBy" TEXT,
    "outcome" TEXT,
    "attemptNumber" INTEGER NOT NULL DEFAULT 1,
    "maxAttempts" INTEGER,
    "generatedBy" TEXT NOT NULL,
    "escalationRequired" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FollowUpTask_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FollowUpHistory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "caseId" TEXT NOT NULL,
    "taskId" TEXT,
    "coordinator" TEXT,
    "actionDate" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actionType" TEXT NOT NULL,
    "outcome" TEXT,
    "note" TEXT,
    "nextFollowUpDate" DATETIME,
    "attemptNumber" INTEGER,
    "previousValue" TEXT,
    "newValue" TEXT,
    CONSTRAINT "FollowUpHistory_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "FollowUpHistory_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "FollowUpTask" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "StatusRule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "status" TEXT,
    "department" TEXT,
    "process" TEXT,
    "stage" TEXT,
    "outcome" TEXT,
    "followUpIntervalDays" INTEGER,
    "sameDayRetryHours" REAL,
    "maximumAttempts" INTEGER,
    "escalateAfterAttempts" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isConfigured" BOOLEAN NOT NULL DEFAULT true,
    "isTerminal" BOOLEAN NOT NULL DEFAULT false,
    "isHold" BOOLEAN NOT NULL DEFAULT false,
    "requiresSupervisorReview" BOOLEAN NOT NULL DEFAULT false,
    "needsConfirmation" BOOLEAN NOT NULL DEFAULT false,
    "instructions" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Escalation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "caseId" TEXT NOT NULL,
    "taskId" TEXT,
    "coordinator" TEXT,
    "department" TEXT,
    "reason" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "supervisorInstruction" TEXT,
    "resolvedBy" TEXT,
    "resolvedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Escalation_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "field" TEXT,
    "oldValue" TEXT,
    "newValue" TEXT,
    "details" TEXT,
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "ImportBatch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fileName" TEXT NOT NULL,
    "storedPath" TEXT,
    "rowCount" INTEGER NOT NULL,
    "newCount" INTEGER NOT NULL DEFAULT 0,
    "updatedCount" INTEGER NOT NULL DEFAULT 0,
    "unchangedCount" INTEGER NOT NULL DEFAULT 0,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "errorsJson" TEXT,
    "columnsJson" TEXT,
    "importedBy" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "AppSetting" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "User_name_key" ON "User"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Department_name_key" ON "Department"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Case_referralId_key" ON "Case"("referralId");

-- CreateIndex
CREATE INDEX "Case_department_idx" ON "Case"("department");

-- CreateIndex
CREATE INDEX "Case_assignedCoordinator_idx" ON "Case"("assignedCoordinator");

-- CreateIndex
CREATE INDEX "Case_caseState_idx" ON "Case"("caseState");

-- CreateIndex
CREATE INDEX "Case_currentStatus_idx" ON "Case"("currentStatus");

-- CreateIndex
CREATE INDEX "FollowUpTask_status_dueDate_idx" ON "FollowUpTask"("status", "dueDate");

-- CreateIndex
CREATE INDEX "FollowUpTask_assignedCoordinator_status_idx" ON "FollowUpTask"("assignedCoordinator", "status");

-- CreateIndex
CREATE INDEX "FollowUpTask_caseId_idx" ON "FollowUpTask"("caseId");

-- CreateIndex
CREATE INDEX "FollowUpHistory_caseId_actionDate_idx" ON "FollowUpHistory"("caseId", "actionDate");

-- CreateIndex
CREATE INDEX "FollowUpHistory_actionDate_idx" ON "FollowUpHistory"("actionDate");

-- CreateIndex
CREATE INDEX "StatusRule_status_idx" ON "StatusRule"("status");

-- CreateIndex
CREATE INDEX "Escalation_status_idx" ON "Escalation"("status");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_timestamp_idx" ON "AuditLog"("timestamp");
