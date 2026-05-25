import { Button, Input, Modal, Radio, Space, Typography } from "antd";

const { Text } = Typography;

export type CommentReplyTarget = {
  awemeId: string;
  accountName: string;
  workTitle: string;
  cid?: string;
  userName?: string;
  commentText?: string;
};

type CommentReplyModalProps = {
  open: boolean;
  replyTarget: CommentReplyTarget | null;
  replyMode: "comment" | "reply";
  replyText: string;
  replySending: boolean;
  onCancel: () => void;
  onReplyModeChange: (mode: "comment" | "reply") => void;
  onReplyTextChange: (text: string) => void;
  onSubmit: () => void;
};

export function CommentReplyModal({
  open,
  replyTarget,
  replyMode,
  replyText,
  replySending,
  onCancel,
  onReplyModeChange,
  onReplyTextChange,
  onSubmit,
}: CommentReplyModalProps) {
  return (
    <Modal
      title="店铺回复"
      open={open}
      onCancel={onCancel}
      destroyOnHidden
      footer={
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 12,
          }}
        >
          <Text type="secondary" style={{ fontSize: 12 }}>
            {replyText.length} / 500
          </Text>
          <Space>
            <Button onClick={onCancel}>取消</Button>
            <Button type="primary" loading={replySending} onClick={onSubmit}>
              发送回复
            </Button>
          </Space>
        </div>
      }
    >
      {replyTarget && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ marginBottom: 4, color: "rgba(0,0,0,0.45)", fontSize: 12 }}>
            账号：{replyTarget.accountName}
          </div>
          <div style={{ color: "rgba(0,0,0,0.45)", fontSize: 12, lineHeight: 1.4 }}>
            作品：{replyTarget.workTitle}
          </div>
        </div>
      )}
      {replyTarget && (
        <div style={{ marginBottom: 12 }}>
          <Radio.Group value={replyMode} onChange={(e) => onReplyModeChange(e.target.value)}>
            <Radio value="comment">店铺评论</Radio>
            <Radio value="reply">店铺回复用户</Radio>
          </Radio.Group>
        </div>
      )}
      {replyMode === "reply" && replyTarget?.cid && (
        <div
          style={{
            marginBottom: 12,
            padding: 8,
            background: "#f5f5f5",
            borderRadius: 4,
            fontSize: 12,
            lineHeight: 1.6,
          }}
        >
          <div style={{ color: "rgba(0,0,0,0.45)", marginBottom: 4 }}>
            回复用户：<strong>{replyTarget.userName || "未知用户"}</strong>
          </div>
          <div style={{ color: "rgba(0,0,0,0.65)" }}>{replyTarget.commentText || ""}</div>
        </div>
      )}
      <Input.TextArea
        rows={4}
        maxLength={500}
        placeholder={replyMode === "reply" ? "输入回复内容..." : "输入评论内容..."}
        value={replyText}
        onChange={(e) => onReplyTextChange(e.target.value)}
      />
    </Modal>
  );
}
