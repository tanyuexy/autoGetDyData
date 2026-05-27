import { NextRequest } from "next/server";
import { loadTaskSnapshot } from "@/lib/tasks/taskLogStore";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const { taskId } = await params;
  const snap = loadTaskSnapshot(taskId);
  return Response.json(snap);
}
