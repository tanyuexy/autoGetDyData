import { NextRequest, NextResponse } from "next/server";
import { upsertCommentItems, pruneCommentItemsForAccount } from "@/lib/comment/service";
import type { CommentItem } from "@/types";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const results = body?.results;

    if (!Array.isArray(results)) {
      return NextResponse.json({ error: "results array required" }, { status: 400 });
    }

    const now = new Date().toISOString();
    const items: CommentItem[] = [];
    const pruneScopes = new Map<string, string[]>();

    for (const result of results) {
      const accountName = result.accountName || "";
      const workItems = result.works || [];

      const keepIds: string[] = [];
      for (const work of workItems) {
        const comments = work.comments || [];
        for (const comment of comments) {
          const id = `${accountName}-${comment.cid}`;
          keepIds.push(id);
          items.push({
            id,
            accountName,
            awemeId: String(work.aweme_id || ""),
            cid: String(comment.cid || ""),
            text: comment.text || "",
            user: comment.user || "",
            userId: comment.user_id || "",
            likeCount: comment.like_count || 0,
            replyCount: comment.reply_count || 0,
            createTime: comment.create_time || "",
            status: comment.status ?? 1,
            workTitle: work.title || "",
            workCreateTime: work.create_time || "",
            fetchedAt: now,
          });
        }
      }
      if (accountName) {
        pruneScopes.set(accountName, keepIds);
      }
    }

    await upsertCommentItems(items);
    for (const [accountName, keepIds] of pruneScopes) {
      await pruneCommentItemsForAccount(accountName, keepIds);
    }

    return NextResponse.json({ saved: items.length });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
