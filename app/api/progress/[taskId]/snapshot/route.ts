import { NextRequest } from "next/server";
import { loadTaskSnapshotFromDisk } from "@/lib/sseManager";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const { taskId } = await params;
  const snap = loadTaskSnapshotFromDisk(taskId);
  return Response.json(snap);
}
