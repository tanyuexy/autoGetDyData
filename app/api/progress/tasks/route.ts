import { NextResponse } from "next/server";
import { getTaskListWithHistory } from "@/lib/taskManager";

export async function GET() {
  const { running, recent } = getTaskListWithHistory();
  return NextResponse.json({ running, recent });
}
