/**
 * assignmentEngine
 * -----------------
 * Decides department, coordinator and supervisor for a case.
 * Never guesses: when information is missing the field stays empty and the
 * case is surfaced in the Needs Review queue.
 */
import type { RuleConfig } from "./followUpEngine";

export interface DepartmentInfo {
  name: string;
  isActive: boolean;
  defaultSupervisor?: string | null;
}

/** Department comes from the configured status rule only. */
export function departmentForRule(rule: Pick<RuleConfig, "department"> | null): string | null {
  return rule?.department?.trim() || null;
}

export interface AssignmentInput {
  intakePerson?: string | null;
  existingCoordinator?: string | null;
  existingSupervisor?: string | null;
  department: string | null;
  departments: DepartmentInfo[];
  defaultSupervisor?: string | null;
  /** Rule requires a person to decide routing (e.g. Code 54). */
  requiresManualAssignment?: boolean;
}

export interface Assignment {
  assignedCoordinator: string | null;
  assignedSupervisor: string | null;
  source: "EXISTING" | "INTAKE_PERSON" | "NONE";
}

export function assignCase(input: AssignmentInput): Assignment {
  const dept = input.departments.find((d) => d.name === input.department);
  const assignedSupervisor = input.existingSupervisor || dept?.defaultSupervisor || input.defaultSupervisor || null;
  if (input.existingCoordinator) {
    return { assignedCoordinator: input.existingCoordinator, assignedSupervisor, source: "EXISTING" };
  }
  const intake = input.intakePerson?.replace(/\s+/g, " ").trim();
  if (intake && !input.requiresManualAssignment) {
    return { assignedCoordinator: intake, assignedSupervisor, source: "INTAKE_PERSON" };
  }
  return { assignedCoordinator: null, assignedSupervisor, source: "NONE" };
}
