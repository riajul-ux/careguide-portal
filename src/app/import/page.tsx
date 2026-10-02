import { prisma } from "@/lib/db";
import { fmtDateTime } from "@/lib/time";
import { Card, PageHeader } from "@/components/ui";
import { ImportClient } from "@/components/ImportClient";

export const dynamic = "force-dynamic";

export default async function ImportPage() {
  const batches = await prisma.importBatch.findMany({ where: { fileName: { not: "demo-seed" } }, orderBy: { createdAt: "desc" }, take: 10 });
  return (
    <div className="space-y-5">
      <PageHeader
        title="Import referrals (CSV)"
        subtitle="Columns are detected by header name. Cases are matched by Referral ID. The uploaded file is stored as a separate copy and never modified."
        actions={<a className="btn" href="/api/sample-csv">Download fake sample CSV</a>}
      />
      <ImportClient demoMode={process.env.DEMO_MODE === "true"} />
      <Card title="Import history">
        {batches.length === 0 ? (
          <p className="text-sm text-slate-500">No imports yet.</p>
        ) : (
          <table className="table-base">
            <thead><tr><th>When</th><th>File</th><th>By</th><th className="text-right">Rows</th><th className="text-right">New</th><th className="text-right">Updated</th><th className="text-right">Unchanged</th><th className="text-right">Errors / warnings</th><th>Stored copy</th></tr></thead>
            <tbody>
              {batches.map((b) => (
                <tr key={b.id}>
                  <td className="whitespace-nowrap">{fmtDateTime(b.createdAt)}</td>
                  <td>{b.fileName}</td>
                  <td>{b.importedBy}</td>
                  <td className="text-right tabular-nums">{b.rowCount.toLocaleString()}</td>
                  <td className="text-right tabular-nums">{b.newCount.toLocaleString()}</td>
                  <td className="text-right tabular-nums">{b.updatedCount.toLocaleString()}</td>
                  <td className="text-right tabular-nums">{b.unchangedCount.toLocaleString()}</td>
                  <td className="text-right tabular-nums">{b.errorCount.toLocaleString()}</td>
                  <td className="text-xs text-slate-500">{b.storedPath ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
