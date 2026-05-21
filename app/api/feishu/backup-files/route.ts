import { NextResponse } from "next/server";
import path from "path";
import fse from "fs-extra";

export const maxDuration = 0;

const EXPORTS_DIR = path.resolve(process.cwd(), "storage/exports");

const FILES = {
  creator: "抖创-飞书表备份.xlsx",
  shop: "抖店-飞书表备份.xlsx",
} as const;

export async function GET() {
  try {
    const results = (Object.keys(FILES) as Array<keyof typeof FILES>).map(
      (key) => {
        const filename = FILES[key];
        const fullPath = path.join(EXPORTS_DIR, filename);
        const exists = fse.existsSync(fullPath);
        const stat = exists ? fse.statSync(fullPath) : null;
        return {
          key,
          filename,
          exists,
          size: stat?.size ?? 0,
          mtime: stat?.mtime?.toISOString?.() ?? null,
        };
      }
    );

    return NextResponse.json({ dir: EXPORTS_DIR, files: results });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
