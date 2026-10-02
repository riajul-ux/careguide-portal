"use client";
import { useCallback, useRef, useState } from "react";
import Papa from "papaparse";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { UploadCloud, FileText, CheckCircle2, AlertCircle } from "lucide-react";
import { detectColumns, type ColumnMapping } from "@/services/columnDetection";

interface Preview {
  file: File;
  headers: string[];
  rowCount: number;
  rows: Record<string, string>[];
  columns: ColumnMapping;
}

interface Result {
  fileName: string;
  rowCount: number;
  newCount: number;
  updatedCount: number;
  unchangedCount: number;
  errorCount: number;
  duplicatesInFile: number;
  errors: { rowNumber: number; referralId?: string; message: string }[];
  storedPath: string | null;
  newCoordinators: string[];
  error?: string;
}

const FIELD_LABEL: Record<string, string> = {
  referralId: "Referral ID", lastNote: "Last Note", lastNoteDate: "Last Note Date", status: "Status", intakePerson: "Intake Person", receivedDate: "Received Date",
  firstName: "First Name", lastName: "Last Name", patientName: "Patient Name", referralSource: "Referral Source", homePhone: "Home Phone", phone2: "Phone 2", medicaidNumber: "Medicaid Number",
};

export function ImportClient() {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const load = useCallback((file: File) => {
    setResult(null);
    setParseError(null);
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: "greedy",
      transformHeader: (h) => h.replace(/^﻿/, "").trim(),
      complete: (res) => {
        const headers = res.meta.fields ?? [];
        setPreview({ file, headers, rowCount: res.data.length, rows: res.data.slice(0, 20), columns: detectColumns(headers) });
      },
      error: (err) => setParseError(err.message),
    });
  }, []);

  const doImport = async () => {
    if (!preview) return;
    setBusy(true);
    setResult(null);
    const fd = new FormData();
    fd.append("file", preview.file);
    try {
      const res = await fetch("/api/import", { method: "POST", body: fd });
      const json = await res.json();
      setResult(res.ok ? json : { error: json.error ?? "Import failed" } as Result);
      router.refresh();
    } catch (e) {
      setResult({ error: e instanceof Error ? e.message : "Import failed" } as Result);
    } finally {
      setBusy(false);
    }
  };

  const mapped = preview ? Object.entries(preview.columns.mapping) : [];

  return (
    <div className="space-y-5">
      <div
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) load(f); }}
        onClick={() => input.current?.click()}
        className={`card flex cursor-pointer flex-col items-center justify-center gap-2 border-2 border-dashed p-10 text-center ${drag ? "border-brand-600 bg-brand-50" : "border-slate-300"}`}
      >
        <UploadCloud className="h-8 w-8 text-slate-400" />
        <div className="text-sm font-medium text-slate-700">Drag &amp; drop the referral CSV here, or click to choose a file</div>
        <div className="text-xs text-slate-500">e.g. the &quot;Refferal Management&quot; export. Nothing is imported until you click Import Referrals.</div>
        <input ref={input} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) load(f); e.target.value = ""; }} />
      </div>
      {parseError && <p className="text-sm text-red-700">{parseError}</p>}

      {preview && (
        <section className="card">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
            <div className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-slate-400" />
              <div>
                <div className="text-sm font-semibold">{preview.file.name}</div>
                <div className="text-xs text-slate-500">{preview.rowCount.toLocaleString()} rows - {preview.headers.length} columns - {(preview.file.size / 1024).toFixed(0)} KB</div>
              </div>
            </div>
            <button className="btn-primary" onClick={doImport} disabled={busy || preview.columns.missingRequired.length > 0}>
              {busy ? `Importing ${preview.rowCount.toLocaleString()} rows...` : "Import Referrals"}
            </button>
          </div>
          <div className="space-y-3 p-4">
            <div>
              <div className="label">Detected columns</div>
              <div className="flex flex-wrap gap-1.5">
                {mapped.map(([field, header]) => (
                  <span key={field} className="rounded-full bg-green-50 px-2 py-0.5 text-xs text-green-800 ring-1 ring-green-200">{FIELD_LABEL[field] ?? field} &larr; &quot;{header}&quot;</span>
                ))}
                {preview.columns.unmapped.map((h) => <span key={h} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600 ring-1 ring-slate-200">{h} (not used)</span>)}
              </div>
              {preview.columns.missingRequired.length > 0 && <p className="mt-2 text-sm text-red-700">Required column missing: {preview.columns.missingRequired.map((f) => FIELD_LABEL[f]).join(", ")}</p>}
              {preview.columns.missingImportant.filter((f) => !preview.columns.missingRequired.includes(f)).length > 0 && (
                <p className="mt-2 text-sm text-amber-700">Not found (cases will be flagged for review): {preview.columns.missingImportant.filter((f) => !preview.columns.missingRequired.includes(f)).map((f) => FIELD_LABEL[f]).join(", ")}</p>
              )}
            </div>
            <div>
              <div className="label">Preview - first {preview.rows.length} rows</div>
              <div className="max-h-96 overflow-auto rounded border border-slate-200">
                <table className="table-base text-xs">
                  <thead className="sticky top-0"><tr><th>#</th>{preview.headers.map((h) => <th key={h} className="whitespace-nowrap">{h}</th>)}</tr></thead>
                  <tbody>
                    {preview.rows.map((r, i) => (
                      <tr key={i}><td className="text-slate-400">{i + 1}</td>{preview.headers.map((h) => <td key={h} className="max-w-64 truncate" title={r[h]}>{r[h]}</td>)}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </section>
      )}

      {result && (
        <section className="card p-4">
          {result.error ? (
            <p className="flex items-center gap-2 text-sm text-red-700"><AlertCircle className="h-4 w-4" /> {result.error}</p>
          ) : (
            <div className="space-y-3">
              <p className="flex items-center gap-2 text-sm font-medium text-green-700"><CheckCircle2 className="h-4 w-4" /> Import complete - {result.fileName}</p>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
                {[["Rows", result.rowCount], ["New cases", result.newCount], ["Updated cases", result.updatedCount], ["Unchanged", result.unchangedCount], ["Errors / warnings", result.errorCount]].map(([l, v]) => (
                  <div key={l as string} className="rounded-md bg-slate-50 p-3"><div className="text-xs uppercase text-slate-500">{l}</div><div className="text-xl font-semibold tabular-nums">{(v as number).toLocaleString()}</div></div>
                ))}
              </div>
              {result.duplicatesInFile > 0 && <p className="text-sm text-slate-600">{result.duplicatesInFile} duplicate Referral ID row(s) in the file - the row with the newest Last Note Date was used.</p>}
              {result.newCoordinators.length > 0 && <p className="text-sm text-slate-600">New coordinators found in Intake Person: {result.newCoordinators.join(", ")}</p>}
              {result.storedPath && <p className="text-xs text-slate-500">Original file copy stored at {result.storedPath} (never modified).</p>}
              <div className="flex gap-2"><Link className="btn" href="/review">Open Needs Review queue</Link><Link className="btn" href="/">Go to dashboard</Link></div>
              {result.errors.length > 0 && (
                <div className="max-h-64 overflow-auto rounded border border-slate-200">
                  <table className="table-base text-xs">
                    <thead><tr><th>Row</th><th>Referral ID</th><th>Message</th></tr></thead>
                    <tbody>{result.errors.map((e, i) => <tr key={i}><td>{e.rowNumber}</td><td>{e.referralId ?? "—"}</td><td>{e.message}</td></tr>)}</tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
