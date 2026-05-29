import { useCallback, useEffect, useRef, useState } from "react";

/** 片段表列宽合计（含勾选列 52px），与 clipTableColumns 保持一致 */
export const AI_VIDEO_CLIPS_TABLE_MIN_WIDTH =
  88 + 88 + 132 + 220 + 100 + 120 + 148 + 204 + 110 + 88 + 168 + 148 + 52;

/** 宽于该视口时使用 fluid 表格，避免 1920 等桌面分辨率出现多余横向滚动条 */
const AI_VIDEO_TABLE_FLUID_MIN_VIEWPORT = 1680;

/** 成片表列宽合计（含勾选列 52px），与 filmTableColumns 保持一致 */
export const AI_VIDEO_FILMS_TABLE_MIN_WIDTH = 108 + 88 + 360 + 200 + 168 + 152 + 52;

export function useAdaptiveTableScroll(minWidth: number) {
  const observerRef = useRef<ResizeObserver | null>(null);
  const [scrollX, setScrollX] = useState<number | undefined>(undefined);

  const wrapRef = useCallback(
    (node: HTMLDivElement | null) => {
      observerRef.current?.disconnect();
      observerRef.current = null;

      if (!node) {
        setScrollX(undefined);
        return;
      }

      const update = () => {
        const available = Math.round(node.getBoundingClientRect().width);
        if (available <= 0) return;
        const wideViewport = window.innerWidth >= AI_VIDEO_TABLE_FLUID_MIN_VIEWPORT;
        const needScroll = !wideViewport && available < minWidth;
        setScrollX(needScroll ? minWidth : undefined);
      };

      update();
      requestAnimationFrame(update);

      const observer = new ResizeObserver(() => {
        update();
        requestAnimationFrame(update);
      });
      observer.observe(node);
      observerRef.current = observer;
    },
    [minWidth]
  );

  useEffect(() => () => observerRef.current?.disconnect(), []);

  return { wrapRef, scrollX };
}
