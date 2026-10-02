import Link from "next/link";
import { fmtDate, fmtDue, fmtDateTime } from "@/lib/time";
import { attemptLabel } from "@/services/followUpEngine";
import { outcomeLabel } from "@/lib/constants";
import type { WorkItem } from "@/services/queries";
import { TaskStateBadge, Empty } from "./ui";

export function WorkTable({ items, showCoordinator = false, limit, completedMode = false }: { items: WorkItem[]; showCoordinator?: boolean; limit?: number; completedMode?: boolean }) {
  const rows = limit ? items.slice(0, limit) : items;
  if (!rows.length) return <Empty>No follow-ups match these filters.</Empty>;
  return (
    <div className="overflow-x-auto">
      <table className="table-base">
        <thead>
          <tr>
            <th>Patient / Referral</th>
            <th>Department</th>
            <th>Current Status</th>
            {showCoordinator && <th>Coordinator</th>}
            <th>Last Follow-up</th>
            <th>{completedMode ? "Completed" : "Next Follow-up"}</th>
            <th className="min-w-56">{completedMode ? "Outcome" : "Reason"}</th>
            <th>Attempt</th>
            <th>Task State</th>
            <th className="text-right">Action</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((i) => (
            <tr key={i.taskId}>
              <td>
                <Link href={`/cases/${i.caseId}`} className="font-medium text-brand-700 hover:underline">
                  {i.patientName ?? "(no name)"}
                </Link>
                <div className="text-xs text-slate-500">#{i.referralId}</div>
              </td>
              <td className="whitespace-nowrap">{i.department ?? <span className="text-amber-700">Missing</span>}</td>
              <td className="max-w-44 text-slate-700">{i.status ?? <span className="text-amber-700">Unknown</span>}</td>
              {showCoordinator && <td className="whitespace-nowrap">{(completedMode ? i.completedBy : i.coordinator) ?? <span className="text-amber-700">Unassigned</span>}</td>}
              <td className="whitespace-nowrap text-slate-600">{fmtDate(i.lastFollowUp)}</td>
              <td className="whitespace-nowrap font-medium">{completedMode ? fmtDateTime(i.completedAt) : fmtDue(i.dueDate, i.hasDueTime)}</td>
              <td className="text-slate-600">
                {completedMode ? outcomeLabel(i.outcome) : i.reason}
                {i.waitingOn && !completedMode && <div className="text-xs text-slate-500">Waiting on: {i.waitingOn}</div>}
              </td>
              <td className="whitespace-nowrap text-slate-600">{attemptLabel(i.attemptNumber, i.maxAttempts)}</td>
              <td>
                <TaskStateBadge state={i.state} />
              </td>
              <td className="text-right">
                <Link href={`/cases/${i.caseId}${completedMode ? "" : "#follow-up"}`} className={completedMode ? "btn" : "btn-primary"}>
                  {completedMode ? "View" : "Work"}
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {limit && items.length > limit && <div className="pt-3 text-center text-sm text-slate-500">Showing {limit} of {items.length}.</div>}
    </div>
  );
}
