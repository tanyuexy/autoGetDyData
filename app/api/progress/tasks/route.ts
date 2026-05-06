import { NextResponse } from "next/server";
import { getRunningTaskList } from "@/lib/taskManager";

export async function GET() {
  const running = getRunningTaskList();
  return NextResponse.json({ running });
}
