"use client";

import { useEffect, useRef, useState } from "react";
import { Tooltip } from "antd";
import { PlayCircleOutlined } from "@ant-design/icons";
import { isLocalMediaUrl, resolveMediaUrl } from "@/lib/ai-video/media";

export function ClipVideoThumbnail({
  videoUrl,
  coverUrl,
  onClick,
  tooltipTitle = "点击预览视频",
  width = 72,
  height = 48,
  showPlayIcon = true,
  orderBadge,
}: {
  videoUrl: string;
  coverUrl?: string | null;
  onClick: () => void;
  tooltipTitle?: React.ReactNode;
  width?: number;
  height?: number;
  showPlayIcon?: boolean;
  orderBadge?: number;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [thumbUrl, setThumbUrl] = useState<string | null>(coverUrl ? resolveMediaUrl(coverUrl) : null);

  useEffect(() => {
    if (thumbUrl || !isLocalMediaUrl(videoUrl)) return;
    const video = videoRef.current;
    if (!video) return;

    const captureFrame = () => {
      if (!video.videoWidth || !video.videoHeight) return;
      try {
        const canvas = document.createElement("canvas");
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        setThumbUrl(canvas.toDataURL("image/jpeg", 0.82));
      } catch {
        // 跨域或未开启 CORS 的视频无法导出 canvas，保留 video 元素作为预览
      }
    };

    const handleLoadedData = () => {
      try {
        video.currentTime = Math.min(0.12, Math.max(0, (video.duration || 0.12) - 0.01));
      } catch {
        captureFrame();
      }
    };

    video.addEventListener("loadeddata", handleLoadedData);
    video.addEventListener("seeked", captureFrame);
    return () => {
      video.removeEventListener("loadeddata", handleLoadedData);
      video.removeEventListener("seeked", captureFrame);
    };
  }, [thumbUrl, videoUrl]);

  const button = (
    <button
      type="button"
      aria-label="预览视频"
      onClick={onClick}
      style={{
        position: "relative",
        width,
        height,
        padding: 0,
        border: "1px solid var(--vol-hairline)",
        borderRadius: 6,
        overflow: "hidden",
        cursor: "pointer",
        background: "#111",
      }}
    >
      {thumbUrl ? (
        <img src={thumbUrl} alt="视频首帧" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      ) : (
        <video
          ref={videoRef}
          src={resolveMediaUrl(videoUrl)}
          preload="metadata"
          muted
          playsInline
          style={{ width: "100%", height: "100%", objectFit: "cover", pointerEvents: "none" }}
        />
      )}
      {typeof orderBadge === "number" ? (
        <span
          style={{
            position: "absolute",
            top: 4,
            left: 4,
            minWidth: 18,
            height: 18,
            paddingInline: 4,
            borderRadius: 999,
            background: "rgba(0, 0, 0, 0.55)",
            color: "#fff",
            fontSize: 11,
            lineHeight: "18px",
            textAlign: "center",
            fontWeight: 600,
            boxShadow: "0 1px 4px rgba(0,0,0,0.25)",
            zIndex: 2,
          }}
        >
          {orderBadge}
        </span>
      ) : null}
      {showPlayIcon ? (
        <span
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(0, 0, 0, 0.28)",
            color: "#fff",
            fontSize: Math.max(14, Math.round(width * 0.25)),
          }}
        >
          <PlayCircleOutlined />
        </span>
      ) : null}
    </button>
  );

  if (tooltipTitle === null || tooltipTitle === false || tooltipTitle === "") return button;
  return <Tooltip title={tooltipTitle}>{button}</Tooltip>;
}
