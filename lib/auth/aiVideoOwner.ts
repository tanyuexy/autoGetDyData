/** AI 视频素材：全员可见；仅 admin 可删除 */
export const AI_VIDEO_ADMIN_USERNAME = "admin";

export function isAiVideoAdmin(username: string | null | undefined): boolean {
  return String(username || "").trim() === AI_VIDEO_ADMIN_USERNAME;
}

export function assertAiVideoAdminCanDelete(actorUsername: string | undefined): void {
  if (!isAiVideoAdmin(actorUsername)) {
    throw new Error("仅 admin 账号可删除素材");
  }
}
