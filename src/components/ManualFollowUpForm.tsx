"use client";
import { useActionState } from "react";
import { manualFollowUpAction, type ActionResult } from "@/app/actions";

export function ManualFollowUpForm({ caseId, defaultReason }: { caseId: string; defaultReason?: string }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(manualFollowUpAction, null);
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="caseId" value={caseId} />
      <div>
        <label className="label">Date</label>
        <input type="date" name="date" required className="input" />
      </div>
      <div>
        <label className="label">Time</label>
        <input type="time" name="time" className="input" />
      </div>
      <div className="min-w-48 flex-1">
        <label className="label">Reason</label>
        <input name="reason" defaultValue={defaultReason} className="input w-full" />
      </div>
      <button className="btn" disabled={pending}>Schedule</button>
      {state && <span className={`text-sm ${state.ok ? "text-green-700" : "text-red-700"}`}>{state.message}</span>}
    </form>
  );
}
