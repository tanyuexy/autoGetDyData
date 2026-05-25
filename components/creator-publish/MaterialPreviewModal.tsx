import { Image, Modal, Tag } from "antd";
import type { PublishTask } from "@/lib/creator-publish/types";

type MaterialPreviewModalProps = {
  task: PublishTask | null;
  onClose: () => void;
  materialPreviewUrl: (fileKey: string) => string;
};

export function MaterialPreviewModal({ task, onClose, materialPreviewUrl }: MaterialPreviewModalProps) {
  return (
    <Modal
      title={task ? `素材预览 · ${task.payload.type === "video" ? "视频" : "图文"}` : "素材预览"}
      open={Boolean(task)}
      onCancel={onClose}
      footer={null}
      destroyOnHidden
      centered
      width={760}
      styles={{
        body: {
          paddingTop: 12,
          paddingBottom: 12,
          maxHeight: "calc(100vh - 160px)",
          overflow: "auto",
        },
      }}
    >
      {task?.payload.type === "video" && task.payload.videoFileKey ? (
        <video
          controls
          preload="metadata"
          style={{
            width: "100%",
            maxHeight: "70vh",
            background: "#000",
            borderRadius: 8,
          }}
          src={materialPreviewUrl(task.payload.videoFileKey)}
        />
      ) : null}
      {task?.payload.type === "article" &&
      Array.isArray(task.payload.imagesFileKeys) &&
      task.payload.imagesFileKeys.length > 0 ? (
        <Image.PreviewGroup>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
              gap: 10,
            }}
          >
            {task.payload.imagesFileKeys.map((key, index) => {
              const isCover =
                task.payload.type === "article" &&
                (task.payload.coverImageKey === key || (!task.payload.coverImageKey && index === 0));
              return (
                <div key={key} style={{ position: "relative" }}>
                  {isCover ? (
                    <Tag
                      color="blue"
                      style={{ position: "absolute", top: 6, left: 6, zIndex: 1, margin: 0 }}
                    >
                      封面
                    </Tag>
                  ) : null}
                  <Image
                    src={materialPreviewUrl(key)}
                    alt={key}
                    style={{
                      width: "100%",
                      aspectRatio: "1 / 1",
                      objectFit: "cover",
                      borderRadius: 8,
                      background: "#f5f5f5",
                    }}
                  />
                </div>
              );
            })}
          </div>
        </Image.PreviewGroup>
      ) : null}
    </Modal>
  );
}
