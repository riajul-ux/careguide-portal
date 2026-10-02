import { buildSampleCsv } from "@/lib/demoData";

export const dynamic = "force-dynamic";

/** Fake referral export (same columns as the real one) for demoing the import. */
export async function GET() {
  return new Response(buildSampleCsv(new Date()), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="sample-referrals-demo.csv"' },
  });
}
