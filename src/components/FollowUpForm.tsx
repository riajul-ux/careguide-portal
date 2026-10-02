"use client";
import { useActionState, useState } from "react";
import { completeTaskAction, type ActionResult } from "@/app/actions";
import { OUTCOMES } from "@/lib/constants";
import { CheckCircle2, AlertCircle } from "lucide-react";

export function FollowUpForm({ caseId, taskId, statuses, currentStatus, attemptInfo, ruleHint }: { caseId: string; taskId: string | null; statuses: string[]; currentStatus: string | null; attemptInfo: string; ruleHint: string }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(completeTaskAction, null);
  const [outcome, setOutcome] = useState<string>("");
  const [formKey, setFormKey] = useState(0);
  return (
    <form
      key={formKey}
      action={async (fd) => {
        await action(fd);
      }}
      className="space-y-4"
    >
      <input type="hidden" name="caseId" value={caseId} />
      {taskId && <input type="hidden" name="taskId" value={taskId} />}
      <div>
        <div className="label">Outcome</div>
        <div className="flex flex-wrap gap-2">
          {OUTCOMES.map((o) => (
            <label key={o.value} className={`cursor-pointer rounded-md border px-3 py-1.5 text-sm ${outcome === o.value ? "border-brand-600 bg-brand-50 font-medium text-brand-700" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`}>
              <input type="radio" name="outcome" value={o.value} className="sr-only" onChange={() => setOutcome(o.value)} required />
              {o.label}
            </label>
          ))}
        </div>
        {(outcome === "NO_ANSWER" || outcome === "LEFT_VOICEMAIL") && <p className="mt-2 text-xs text-slate-600">Counts as an unsuccessful attempt ({attemptInfo}). The task is still credited as completed.</p>}
      </div>
      <div>
        <label className="label" htmlFor="note">Note</label>
        <textarea id="note" name="note" rows={3} className="input w-full" placeholder='e.g. "RN assessment scheduled 10/28. Call after assessment." - dates in the note are detected automatically.' />
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div>
          <label className="label" htmlFor="nextDate">Next follow-up date (optional)</label>
          <input id="nextDate" type="date" name="nextDate" className="input w-full" />
        </div>
        <div>
          <label className="label" htmlFor="nextTime">Next follow-up time (optional)</label>
          <input id="nextTime" type="time" name="nextTime" className="input w-full" />
        </div>
        <div>
          <label className="label" htmlFor="newStatus">Status change (optional)</label>
          <select id="newStatus" name="newStatus" className="input w-full" defaultValue="">
            <option value="">Keep: {currentStatus ?? "—"}</option>
            {statuses.filter((s) => s !== currentStatus).map((s) => <option key={s}>{s}</option>)}
          </select>
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" name="manualOverride" className="h-4 w-4" /> Use my date instead of the system date (override is logged)
      </label>
      <p className="text-xs text-slate-500">
        Next follow-up priority: 1) explicit date in the note, 2) {ruleHint}, 3) the manual date above.
      </p>
      <div className="flex items-center gap-3">
        <button className="btn-primary" disabled={pending || !outcome}>{pending ? "Saving..." : "Complete follow-up"}</button>
        {state && (
          <span className={`flex items-center gap-1.5 text-sm ${state.ok ? "text-green-700" : "text-red-700"}`}>
            {state.ok ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />} {state.message}
          </span>
        )}
        {state?.ok && <button type="button" className="btn" onClick={() => { setOutcome(""); setFormKey((k) => k + 1); }}>Record another</button>}
      </div>
    </form>
  );
}
