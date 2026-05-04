import { NextResponse } from "next/server";
import { listRecentTaskLogs } from "@/lib/sseManager";

export async function GET() {
  const files = listRecentTaskLogs(10);
  return NextResponse.json({ files });
}
