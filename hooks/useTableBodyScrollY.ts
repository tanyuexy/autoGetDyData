import { useEffect, useRef, useState } from "react";

/** Ant Design small Table 表头 + 分页的大致占用高度 */
const TABLE_CHROME_HEIGHT = 96;

/**
 * 在 flex 布局容器内测量可用高度，供 Table scroll.y 使用。
 * 容器需 flex:1; min-height:0，且外层链路不能有 overflow:auto 与表格内滚动并存。
 */
export function useTableBodyScrollY(minHeight = 200) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollY, setScrollY] = useState<number | undefined>(undefined);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const update = () => {
      const next = Math.max(minHeight, el.clientHeight - TABLE_CHROME_HEIGHT);
      setScrollY((prev) => (prev === next ? prev : next));
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [minHeight]);

  return { containerRef, scrollY };
}
