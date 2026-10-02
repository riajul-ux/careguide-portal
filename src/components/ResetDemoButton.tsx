"use client";
import { useState, useTransition } from "react";
import { resetDemoAction } from "@/app/actions";

export function ResetDemoButton() {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="space-y-2">
      <button
        className="btn"
        disabled={pending}
        onClick={() => {
          if (confirm("Reset all data to the demo seed? Imported data will be removed.")) start(async () => setMsg((await resetDemoAction()).message));
        }}
      >
        {pending ? "Resetting..." : "Reset demo data"}
      </button>
      {msg && <p className="text-sm text-green-700">{msg}</p>}
    </div>
  );
}
