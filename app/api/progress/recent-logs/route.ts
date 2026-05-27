import { NextResponse } from "next/server";
import { listRecentTaskLogs } from "@/lib/tasks/taskLogStore";

export async function GET() {
  const files = listRecentTaskLogs(20);
  return NextResponse.json({ files });
}
