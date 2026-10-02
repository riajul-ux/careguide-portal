import { TASK_STATE_LABEL, TASK_STATES } from "@/lib/constants";

export interface FilterValues {
  department?: string;
  status?: string;
  state?: string;
  coordinator?: string;
  date?: string;
  q?: string;
}

export function FilterBar({ action, values, options, showState = true }: { action: string; values: FilterValues; options: { departments: string[]; statuses: string[]; coordinators: string[] }; showState?: boolean }) {
  return (
    <form action={action} method="get" className="card mb-4 flex flex-wrap items-end gap-3 p-3">
      <div className="min-w-56 flex-1">
        <label className="label" htmlFor="q">Search</label>
        <input id="q" name="q" defaultValue={values.q} placeholder="Patient name, referral ID or note text" className="input w-full" />
      </div>
      <div>
        <label className="label" htmlFor="department">Department</label>
        <select id="department" name="department" defaultValue={values.department ?? ""} className="input">
          <option value="">All</option>
          {options.departments.map((d) => <option key={d}>{d}</option>)}
        </select>
      </div>
      <div>
        <label className="label" htmlFor="status">Status</label>
        <select id="status" name="status" defaultValue={values.status ?? ""} className="input max-w-52">
          <option value="">All</option>
          {options.statuses.map((d) => <option key={d}>{d}</option>)}
        </select>
      </div>
      {showState && (
        <div>
          <label className="label" htmlFor="state">Due state</label>
          <select id="state" name="state" defaultValue={values.state ?? ""} className="input">
            <option value="">All open</option>
            <option value="REMAINING">Remaining today (overdue + due)</option>
            {TASK_STATES.map((s) => <option key={s} value={s}>{TASK_STATE_LABEL[s]}{s === "COMPLETED" ? " (today)" : ""}</option>)}
          </select>
        </div>
      )}
      <div>
        <label className="label" htmlFor="coordinator">Coordinator</label>
        <select id="coordinator" name="coordinator" defaultValue={values.coordinator ?? ""} className="input">
          <option value="__all">All coordinators</option>
          {options.coordinators.map((d) => <option key={d}>{d}</option>)}
        </select>
      </div>
      <div>
        <label className="label" htmlFor="date">Due date</label>
        <input id="date" type="date" name="date" defaultValue={values.date} className="input" />
      </div>
      <div className="flex gap-2">
        <button className="btn-primary" type="submit">Apply</button>
        <a href={action} className="btn">Reset</a>
      </div>
    </form>
  );
}
