import type { ReviewItem } from "@/types";
import { getDb } from "./db/mongo";

function normalizeItem(item: any): ReviewItem | null {
  if (!item || typeof item.id !== "string") return null;
  return item as ReviewItem;
}

export async function readReviewItems(accountName?: string): Promise<ReviewItem[]> {
  const db = await getDb();
  const filter: any = {};
  if (accountName) filter.accountName = accountName;
  const docs = await db
    .collection("creator_review_items")
    .find(filter)
    .sort({ checkedAt: -1 })
    .toArray();
  return docs.map(normalizeItem).filter(Boolean) as ReviewItem[];
}

export async function deleteReviewItem(id: string): Promise<boolean> {
  const db = await getDb();
  const result = await db.collection("creator_review_items").deleteOne({ _id: id as any });
  return result.deletedCount > 0;
}

export async function upsertReviewItems(items: ReviewItem[]): Promise<void> {
  if (items.length === 0) return;
  const db = await getDb();
  const collection = db.collection("creator_review_items");
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

export async function pruneReviewItemsForAccount(accountName: string, keepIds: string[]): Promise<void> {
  if (!accountName) return;
  const db = await getDb();
  await db.collection("creator_review_items").deleteMany({
    accountName,
    id: { $nin: keepIds },
  });
}
