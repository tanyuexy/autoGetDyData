import { NextRequest } from "next/server";
import fs from "fs";
import path from "path";

export const maxDuration = 0;

const EXPORTS_DIR = path.resolve(process.cwd(), "storage/exports");

const ALLOWED = new Map<string, string>([
  ["creator", "抖创-飞书表备份.xlsx"],
  ["shop", "抖店-飞书表备份.xlsx"],
]);

function contentTypeByExt(file: string): string {
  const ext = path.extname(file).toLowerCase();
  if (ext === ".xlsx") {
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  }
  return "application/octet-stream";
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  const { key } = await params;
  const filename = ALLOWED.get(String(key));
  if (!filename) {
    return new Response("Not found", { status: 404 });
  }

  const fullPath = path.join(EXPORTS_DIR, filename);
  if (!fs.existsSync(fullPath)) {
    return new Response("Not found", { status: 404 });
  }

  const stat = fs.statSync(fullPath);
  const fileBuf = fs.readFileSync(fullPath);

  return new Response(fileBuf, {
    headers: {
      "Content-Type": contentTypeByExt(filename),
      "Content-Length": String(stat.size),
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "no-store",
    },
  });
}
