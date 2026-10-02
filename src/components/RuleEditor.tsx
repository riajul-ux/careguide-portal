"use client";
import { useActionState, useTransition, useState } from "react";
import type { StatusRule } from "@prisma/client";
import { reapplyAllRulesAction, saveRuleAction, type ActionResult } from "@/app/actions";

export function RuleEditor({ rule, departments }: { rule: StatusRule | null; departments: string[] }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(saveRuleAction, null);
  const v = (x: unknown) => (x === null || x === undefined ? "" : String(x));
  const check = (name: string, label: string, def: boolean, hint?: string) => (
    <label className="flex items-center gap-2 text-sm" title={hint}>
      <input type="checkbox" name={name} defaultChecked={def} className="h-4 w-4" /> {label}
    </label>
  );
  return (
    <form action={action} className="space-y-4">
      {rule && <input type="hidden" name="id" value={rule.id} />}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <div><label className="label">Status (from referral export)</label><input name="status" defaultValue={v(rule?.status)} className="input w-full" placeholder="blank = department default" /></div>
        <div>
          <label className="label">Department</label>
          <select name="department" defaultValue={v(rule?.department)} className="input w-full"><option value="">(none)</option>{departments.map((d) => <option key={d}>{d}</option>)}</select>
        </div>
        <div><label className="label">Process</label><input name="process" defaultValue={v(rule?.process)} className="input w-full" /></div>
        <div><label className="label">Stage</label><input name="stage" defaultValue={v(rule?.stage)} className="input w-full" /></div>
        <div>
          <label className="label">Outcome (outcome rules only)</label>
          <select name="outcome" defaultValue={v(rule?.outcome)} className="input w-full"><option value="">(status rule)</option><option value="NO_ANSWER">No Answer / Phone Not Answered</option></select>
        </div>
        <div><label className="label">Follow-up interval (days)</label><input name="followUpIntervalDays" type="number" min={0} defaultValue={v(rule?.followUpIntervalDays)} className="input w-full" /></div>
        <div><label className="label">Same-day retry (hours)</label><input name="sameDayRetryHours" type="number" min={0} step="0.5" defaultValue={v(rule?.sameDayRetryHours)} className="input w-full" /></div>
        <div className="grid grid-cols-2 gap-2">
          <div><label className="label">Max attempts</label><input name="maximumAttempts" type="number" min={0} defaultValue={v(rule?.maximumAttempts)} className="input w-full" /></div>
          <div><label className="label">Escalate after</label><input name="escalateAfterAttempts" type="number" min={0} defaultValue={v(rule?.escalateAfterAttempts)} className="input w-full" /></div>
        </div>
      </div>
      <div><label className="label">Instructions</label><textarea name="instructions" rows={2} defaultValue={v(rule?.instructions)} className="input w-full" /></div>
      <div className="flex flex-wrap gap-x-6 gap-y-2">
        {check("isActive", "Active", rule?.isActive ?? true)}
        {check("isConfigured", "Configured (untick = 'Rule not configured', no dates invented)", rule?.isConfigured ?? true)}
        {check("isHold", "Hold (no automatic follow-up)", rule?.isHold ?? false)}
        {check("isTerminal", "Closed status (no follow-up)", rule?.isTerminal ?? false)}
        {check("requiresSupervisorReview", "Requires manual assignment / supervisor review", rule?.requiresSupervisorReview ?? false)}
        {check("needsConfirmation", "Placeholder - needs manager confirmation", rule?.needsConfirmation ?? false)}
      </div>
      <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 pt-3">
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="reapply" defaultChecked className="h-4 w-4" /> Re-apply to open cases with this status</label>
        <button className="btn-primary" disabled={pending}>{pending ? "Saving..." : "Save rule"}</button>
        <a className="btn" href="/rules">Cancel</a>
        {state && <span className={`text-sm ${state.ok ? "text-green-700" : "text-red-700"}`}>{state.message}</span>}
      </div>
    </form>
  );
}

export function ReapplyButton() {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <span className="flex items-center gap-2">
      {msg && <span className="text-sm text-green-700">{msg}</span>}
      <button className="btn" disabled={pending} onClick={() => start(async () => setMsg((await reapplyAllRulesAction()).message))}>
        {pending ? "Re-applying..." : "Re-apply all rules"}
      </button>
    </span>
  );
}
