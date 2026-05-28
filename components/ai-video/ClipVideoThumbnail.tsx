"use client";

import { useEffect, useRef, useState } from "react";
import { Spin, Tooltip } from "antd";
import { PlayCircleOutlined } from "@ant-design/icons";
import { isLocalMediaUrl, resolveMediaUrl } from "@/lib/ai-video/media";

function ThumbnailLoadingMask({ loading }: { loading: boolean }) {
  if (!loading) return null;
  return (
    <span
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--vol-canvas)",
        zIndex: 1,
      }}
    >
      <Spin size="small" />
    </span>
  );
}

export function VideoFrameThumbnail({
  videoUrl,
  coverUrl,
  width = 72,
  height = 48,
  showPlayIcon = true,
  orderBadge,
  borderRadius = 6,
}: {
  videoUrl: string;
  coverUrl?: string | null;
  width?: number;
  height?: number;
  showPlayIcon?: boolean;
  orderBadge?: number;
  borderRadius?: number;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const resolvedCover = coverUrl ? resolveMediaUrl(coverUrl) : null;
  const [thumbUrl, setThumbUrl] = useState<string | null>(resolvedCover);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    setThumbUrl(resolvedCover);
  }, [videoUrl, coverUrl, resolvedCover]);

  // 排序/翻页 remount 后，缓存图片可能不再触发 onLoad
  useEffect(() => {
    if (!thumbUrl) return;
    const img = imgRef.current;
    if (img?.complete && img.naturalWidth > 0) {
      setLoading(false);
    }
  }, [thumbUrl]);

  useEffect(() => {
    if (thumbUrl) return;
    const video = videoRef.current;
    if (video && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      setLoading(false);
    }
  }, [thumbUrl, videoUrl]);

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

  return (
    <span
      style={{
        position: "relative",
        display: "inline-flex",
        width,
        height,
        borderRadius,
        overflow: "hidden",
        background: "var(--vol-canvas)",
        flexShrink: 0,
      }}
    >
      <ThumbnailLoadingMask loading={loading} />
      {thumbUrl ? (
        <img
          ref={imgRef}
          src={thumbUrl}
          alt="视频首帧"
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
          onLoad={() => setLoading(false)}
          onError={() => setLoading(false)}
        />
      ) : (
        <video
          ref={videoRef}
          src={resolveMediaUrl(videoUrl)}
          preload="metadata"
          muted
          playsInline
          style={{ width: "100%", height: "100%", objectFit: "cover", pointerEvents: "none" }}
          onLoadedData={() => setLoading(false)}
          onError={() => setLoading(false)}
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
      {showPlayIcon && !loading ? (
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
            zIndex: 2,
          }}
        >
          <PlayCircleOutlined />
        </span>
      ) : null}
    </span>
  );
}

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
        background: "var(--vol-canvas)",
      }}
    >
      <VideoFrameThumbnail
        videoUrl={videoUrl}
        coverUrl={coverUrl}
        width={width}
        height={height}
        showPlayIcon={showPlayIcon}
        orderBadge={orderBadge}
        borderRadius={0}
      />
    </button>
  );

  if (tooltipTitle === null || tooltipTitle === false || tooltipTitle === "") return button;
  return <Tooltip title={tooltipTitle}>{button}</Tooltip>;
}
