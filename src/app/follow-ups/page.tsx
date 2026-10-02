import { getCurrentUser, isSupervisorLike } from "@/lib/session";
import { filterOptions, getWorkItems } from "@/services/queries";
import { Card, PageHeader } from "@/components/ui";
import { FilterBar } from "@/components/FilterBar";
import { WorkTable } from "@/components/WorkTable";
import { TASK_STATE_LABEL, type TaskState } from "@/lib/constants";

export const dynamic = "force-dynamic";

type SP = Promise<Record<string, string | undefined>>;

export default async function FollowUps({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const user = await getCurrentUser();
  // Coordinators default to their own list; supervisors default to everyone.
  const coordinatorParam = sp.coordinator ?? (isSupervisorLike(user) ? "__all" : user.name);
  const coordinator = coordinatorParam === "__all" ? undefined : coordinatorParam;
  const filters = { department: sp.department, status: sp.status, state: sp.state, coordinator, date: sp.date, q: sp.q, includeSupervisorTasks: sp.state === "SUPERVISOR_REVIEW" };
  const [items, options] = await Promise.all([getWorkItems(filters), filterOptions()]);
  const stateLabel = sp.state === "REMAINING" ? "Remaining today" : sp.state === "TODAY" ? "Due today (incl. later today)" : sp.state ? TASK_STATE_LABEL[sp.state as TaskState] : "All open";
  return (
    <div>
      <PageHeader
        title={coordinator === user.name ? "My Follow-Ups" : "Follow-Ups"}
        subtitle={`${stateLabel} - ${coordinator ?? "all coordinators"} - ${items.length} task${items.length === 1 ? "" : "s"}`}
      />
      <FilterBar action="/follow-ups" values={{ ...sp, coordinator: coordinatorParam }} options={options} />
      <Card>
        <WorkTable items={items} showCoordinator={!coordinator} completedMode={sp.state === "COMPLETED"} />
      </Card>
    </div>
  );
}
