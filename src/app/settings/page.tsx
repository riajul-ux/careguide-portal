import { prisma } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { getCurrentUser } from "@/lib/session";
import { fmtDateTime } from "@/lib/time";
import { Badge, Card, PageHeader } from "@/components/ui";
import { saveSettingsAction, toggleDepartmentAction } from "@/app/actions";
import { ResetDemoButton } from "@/components/ResetDemoButton";
import { getNoteInterpreter } from "@/services/noteInterpreter";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await getCurrentUser();
  const [settings, departments, users, audit] = await Promise.all([
    getSettings(),
    prisma.department.findMany({ orderBy: { sortOrder: "asc" } }),
    prisma.user.findMany({ orderBy: [{ role: "asc" }, { name: "asc" }] }),
    prisma.auditLog.findMany({ orderBy: { timestamp: "desc" }, take: 40 }),
  ]);
  const canEdit = user.role === "ADMIN" || user.role === "SUPERVISOR";
  return (
    <div className="space-y-5">
      <PageHeader title="Settings" subtitle="Business hours, departments, users, integration status and audit log." />
      <div className="grid gap-5 xl:grid-cols-3">
        <Card title="Business hours (used for same-day retries)">
          <form action={saveSettingsAction} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div><label className="label">Day starts (hour)</label><input name="businessDayStartHour" type="number" min={0} max={23} defaultValue={settings.businessDayStartHour} className="input w-full" disabled={!canEdit} /></div>
              <div><label className="label">Day ends (hour)</label><input name="businessDayEndHour" type="number" min={1} max={24} defaultValue={settings.businessDayEndHour} className="input w-full" disabled={!canEdit} /></div>
            </div>
            <div><label className="label">Default supervisor</label><input name="defaultSupervisor" defaultValue={settings.defaultSupervisor ?? ""} className="input w-full" disabled={!canEdit} /></div>
            <p className="text-xs text-slate-500">A retry that would land after the end of the business day moves to the next business morning.</p>
            {canEdit && <button className="btn-primary">Save</button>}
          </form>
        </Card>
        <Card title="Integrations">
          <ul className="space-y-2 text-sm">
            <li className="flex justify-between"><span>Referral data source</span><Badge tone="blue">CSV import</Badge></li>
            <li className="flex justify-between"><span>HHAeXchange</span><Badge>Not connected</Badge></li>
            <li className="flex justify-between"><span>Note interpreter</span><Badge>{getNoteInterpreter().name}</Badge></li>
            <li className="flex justify-between"><span>External AI API</span><Badge>Not used</Badge></li>
          </ul>
        </Card>
        <Card title="Demo data">
          <p className="mb-3 text-sm text-slate-600">Wipes the database and reloads fake demo referrals (no real patient data). Imported CSV data will be removed.</p>
          {user.role === "ADMIN" ? <ResetDemoButton /> : <p className="text-xs text-slate-500">Admin role required.</p>}
        </Card>
      </div>
      <div className="grid gap-5 xl:grid-cols-2">
        <Card title="Departments">
          <table className="table-base">
            <thead><tr><th>Department</th><th>Default supervisor</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {departments.map((d) => (
                <tr key={d.id}>
                  <td>{d.name}</td><td>{d.defaultSupervisor ?? "—"}</td>
                  <td>{d.isActive ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>}</td>
                  <td>{canEdit && <form action={toggleDepartmentAction}><input type="hidden" name="id" value={d.id} /><button className="btn !px-2 !py-1 !text-xs">{d.isActive ? "Deactivate" : "Activate"}</button></form>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-slate-500">HMO is not a department - it is retired (inactive rule only).</p>
        </Card>
        <Card title={`Users (${users.length})`}>
          <div className="max-h-96 overflow-auto">
            <table className="table-base">
              <thead><tr><th>Name</th><th>Role</th><th>Department</th><th>Source</th></tr></thead>
              <tbody>{users.map((u) => <tr key={u.id}><td>{u.name}{u.isDemo && <span className="ml-1 text-xs text-slate-400">(demo)</span>}</td><td>{u.role.toLowerCase()}</td><td>{u.department ?? "—"}</td><td className="text-xs text-slate-500">{u.source.toLowerCase()}</td></tr>)}</tbody>
            </table>
          </div>
        </Card>
      </div>
      <Card title="Audit log (latest 40)">
        <div className="overflow-x-auto">
          <table className="table-base text-xs">
            <thead><tr><th>When</th><th>User</th><th>Action</th><th>Entity</th><th>Field</th><th>Old</th><th>New</th></tr></thead>
            <tbody>{audit.map((a) => <tr key={a.id}><td className="whitespace-nowrap">{fmtDateTime(a.timestamp)}</td><td>{a.user}</td><td>{a.action}</td><td>{a.entityType}</td><td>{a.field ?? ""}</td><td className="max-w-48 truncate" title={a.oldValue ?? ""}>{a.oldValue ?? ""}</td><td className="max-w-48 truncate" title={a.newValue ?? a.details ?? ""}>{a.newValue ?? a.details ?? ""}</td></tr>)}</tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
