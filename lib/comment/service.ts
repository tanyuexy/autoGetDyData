import type { CommentItem } from "@/types";
import { getDb } from "@/lib/db/mongo";

function normalizeItem(item: any): CommentItem | null {
  if (!item || typeof item.id !== "string") return null;
  return item as CommentItem;
}

export async function readCommentItems(accountName?: string): Promise<CommentItem[]> {
  const db = await getDb();
  const filter: any = {};
  if (accountName) filter.accountName = accountName;
  const docs = await db
    .collection("creator_comment_items")
    .find(filter)
    .sort({ fetchedAt: -1 })
    .toArray();
  return docs.map(normalizeItem).filter(Boolean) as CommentItem[];
}

export async function deleteCommentItem(id: string): Promise<boolean> {
  const db = await getDb();
  const result = await db.collection("creator_comment_items").deleteOne({ _id: id as any });
  return result.deletedCount > 0;
}

export async function upsertCommentItems(items: CommentItem[]): Promise<void> {
  if (items.length === 0) return;
  const db = await getDb();
  const collection = db.collection("creator_comment_items");
  await collection.bulkWrite(
    items.map((item) => ({
      replaceOne: {
        filter: { id: item.id },
        replacement: { ...item, _id: item.id },
        upsert: true,
      },
    }))
  );
}

export async function pruneCommentItemsForAccount(
  accountName: string,
  keepIds: string[]
): Promise<void> {
  if (!accountName) return;
  const db = await getDb();
  await db.collection("creator_comment_items").deleteMany({
    accountName,
    id: { $nin: keepIds },
  });
}
