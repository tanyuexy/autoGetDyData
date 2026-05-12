import { NextRequest, NextResponse } from "next/server";
import { pruneReviewItemsForAccount, upsertReviewItems } from "@/lib/reviewService";
import type { ReviewItem } from "@/types";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const results = body?.results;

    if (!Array.isArray(results)) {
      return NextResponse.json({ error: "results array required" }, { status: 400 });
    }

    const now = new Date().toISOString();
    const items: ReviewItem[] = [];

    for (const result of results) {
      const accountName = result.accountName || "";
      const postItems = result.items || [];
      for (const item of postItems) {
        const postId = item.postId || `unknown-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        items.push({
          id: `${accountName}-${postId}`,
          accountName,
          postId: String(postId),
          title: item.title || "",
          coverUrl: item.coverUrl || undefined,
          publishDate: item.publishDate || now,
          reviewStatus: item.reviewStatus || "under_review",
          rejectionReason: item.rejectionReason || undefined,
          rejectionScreenshotPath: item.rejectionScreenshotPath || undefined,
          checkedAt: now,
          createdAt: now,
          updatedAt: now,
        });
      }
    }

    await upsertReviewItems(items);
    const idsByAccount = new Map<string, string[]>();
    for (const item of items) {
      const ids = idsByAccount.get(item.accountName) || [];
      ids.push(item.id);
      idsByAccount.set(item.accountName, ids);
    }
    for (const [accountName, ids] of idsByAccount) {
      await pruneReviewItemsForAccount(accountName, ids);
    }

    return NextResponse.json({ saved: items.length });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
