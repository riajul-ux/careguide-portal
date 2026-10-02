import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { runImportText } from "@/services/importRunner";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: Request) {
  const user = await getCurrentUser();
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
  if (!/\.csv$/i.test(file.name)) return NextResponse.json({ error: "Please upload a .csv file" }, { status: 400 });
  try {
    const text = await file.text();
    const summary = await runImportText(file.name, text, user.name);
    return NextResponse.json({ ...summary, errors: summary.errors.slice(0, 200) });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Import failed" }, { status: 400 });
  }
}
