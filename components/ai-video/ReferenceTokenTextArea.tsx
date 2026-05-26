"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Input, Space, Typography } from "antd";
import type { TextAreaRef } from "antd/es/input/TextArea";
import { PaperClipOutlined } from "@ant-design/icons";
import { VideoFrameThumbnail } from "@/components/ai-video/ClipVideoThumbnail";
import { getReferenceLabel } from "@/lib/ai-video/clipUtils";
import type { ReferenceResource } from "@/lib/ai-video/types";

export interface ReferenceTokenTextAreaProps {
  value: string;
  onChange: (value: string) => void;
  referenceResources: ReferenceResource[];
  placeholder?: string;
  autoSize?: { minRows: number; maxRows: number };
  maxLength?: number;
  idPrefix?: string;
  textareaRef?: React.RefObject<HTMLTextAreaElement | null>;
  showQuickInsert?: boolean;
}

function bindTextAreaRef(node: TextAreaRef | null, externalRef?: React.RefObject<HTMLTextAreaElement | null>) {
  const textArea = node?.resizableTextArea?.textArea || null;
  if (externalRef && "current" in externalRef) {
    externalRef.current = textArea;
  }
  return textArea;
}

export function ReferenceTokenTextArea({
  value,
  onChange,
  referenceResources,
  placeholder,
  autoSize = { minRows: 4, maxRows: 8 },
  maxLength = 1800,
  idPrefix = "resource-picker",
  textareaRef,
  showQuickInsert = true,
}: ReferenceTokenTextAreaProps) {
  const localTextAreaRef = useRef<HTMLTextAreaElement | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [atIndex, setAtIndex] = useState<number | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const getTextArea = useCallback(() => textareaRef?.current || localTextAreaRef.current, [textareaRef]);

  useEffect(() => {
    if (!pickerOpen) return;
    document.getElementById(`${idPrefix}-item-${activeIndex}`)?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, idPrefix, pickerOpen]);

  useEffect(() => {
    if (!pickerOpen) return;
    if (activeIndex >= referenceResources.length) {
      setActiveIndex(0);
    }
  }, [activeIndex, pickerOpen, referenceResources.length]);

  const insertTokenAt = useCallback(
    (resource: ReferenceResource, replaceFrom?: number | null) => {
      const token = `@${getReferenceLabel(referenceResources, resource)}`;
      const textarea = getTextArea();
      const selectionStart = textarea?.selectionStart ?? value.length;
      const fromIndex = replaceFrom ?? selectionStart;
      const before = value.slice(0, fromIndex);
      const afterRaw = value.slice(selectionStart);
      const after = afterRaw.startsWith(" ") || !afterRaw ? afterRaw : ` ${afterRaw}`;
      const nextValue = `${before}${token}${after}`;
      onChange(nextValue);
      setPickerOpen(false);
      setAtIndex(null);
      setActiveIndex(0);

      window.requestAnimationFrame(() => {
        const caret = before.length + token.length;
        textarea?.focus();
        textarea?.setSelectionRange(caret, caret);
      });
    },
    [getTextArea, onChange, referenceResources, value]
  );

  const handleChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const nextValue = event.target.value;
    const cursor = event.target.selectionStart ?? nextValue.length;
    onChange(nextValue);

    const charBeforeCursor = nextValue[cursor - 1];
    if (charBeforeCursor === "@" && referenceResources.length) {
      setAtIndex(cursor - 1);
      setPickerOpen(true);
      setActiveIndex(0);
      return;
    }

    if (pickerOpen && atIndex != null) {
      const activeToken = nextValue.slice(atIndex, cursor);
      if (!activeToken.startsWith("@") || /\s/.test(activeToken.slice(1))) {
        setPickerOpen(false);
        setAtIndex(null);
        setActiveIndex(0);
      }
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!pickerOpen || !referenceResources.length) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((prev) => (prev + 1) % referenceResources.length);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((prev) => (prev - 1 + referenceResources.length) % referenceResources.length);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const resource = referenceResources[activeIndex];
      if (resource) insertTokenAt(resource, atIndex);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setPickerOpen(false);
      setAtIndex(null);
      setActiveIndex(0);
    }
  };

  const handleBlur = () => {
    window.setTimeout(() => {
      setPickerOpen(false);
      setActiveIndex(0);
    }, 160);
  };

  return (
    <Space orientation="vertical" size={6} style={{ width: "100%" }}>
      <div style={{ position: "relative", width: "100%" }}>
        <Input.TextArea
          ref={(node) => {
            localTextAreaRef.current = bindTextAreaRef(node, textareaRef);
          }}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          placeholder={placeholder}
          autoSize={autoSize}
          maxLength={maxLength}
        />
        {pickerOpen && referenceResources.length ? (
          <div
            style={{
              position: "absolute",
              left: 0,
              top: "100%",
              zIndex: 30,
              width: 360,
              maxWidth: "min(360px, 100%)",
              marginTop: 6,
              padding: 6,
              border: "1px solid var(--vol-hairline)",
              borderRadius: 8,
              background: "var(--vol-canvas-soft)",
              boxShadow: "0 10px 30px rgba(17, 17, 17, 0.12)",
              maxHeight: 240,
              overflowY: "auto",
            }}
            role="listbox"
            aria-label="选择参考资源"
          >
            <Space orientation="vertical" size={4} style={{ width: "100%" }}>
              {referenceResources.map((resource, index) => {
                const label = getReferenceLabel(referenceResources, resource);
                const active = index === activeIndex;
                return (
                  <button
                    key={resource.id}
                    id={`${idPrefix}-item-${index}`}
                    type="button"
                    role="option"
                    aria-selected={active}
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => insertTokenAt(resource, atIndex)}
                    style={{
                      width: "100%",
                      border: 0,
                      borderRadius: 6,
                      padding: "7px 8px",
                      background: active ? "rgba(22, 119, 255, 0.12)" : "transparent",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      textAlign: "left",
                    }}
                  >
                    {resource.kind === "image" ? (
                      <img
                        src={resource.url}
                        alt={resource.name}
                        style={{
                          width: 28,
                          height: 28,
                          objectFit: "cover",
                          borderRadius: 4,
                          flexShrink: 0,
                        }}
                      />
                    ) : resource.kind === "video" ? (
                      <VideoFrameThumbnail
                        videoUrl={resource.url}
                        width={28}
                        height={28}
                        borderRadius={4}
                        showPlayIcon={false}
                      />
                    ) : (
                      <span
                        style={{
                          width: 28,
                          height: 28,
                          borderRadius: 4,
                          background: "#111",
                          color: "#fff",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          flexShrink: 0,
                        }}
                      >
                        <PaperClipOutlined />
                      </span>
                    )}
                    <Typography.Text strong style={{ width: 58, flexShrink: 0 }}>
                      @{label}
                    </Typography.Text>
                    <Typography.Text type="secondary" ellipsis style={{ flex: 1, minWidth: 0 }}>
                      {resource.name}
                    </Typography.Text>
                  </button>
                );
              })}
            </Space>
          </div>
        ) : null}
      </div>

      {showQuickInsert && referenceResources.length ? (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            columnGap: 4,
            rowGap: 4,
            fontSize: 12,
            lineHeight: "20px",
          }}
        >
          <Typography.Text type="secondary" style={{ fontSize: 12, lineHeight: "20px", margin: 0 }}>
            输入 @ 或点击插入：
          </Typography.Text>
          {referenceResources.map((resource) => {
            const label = getReferenceLabel(referenceResources, resource);
            return (
              <Typography.Link
                key={resource.id}
                onClick={() => insertTokenAt(resource)}
                style={{ fontSize: 12, lineHeight: "20px", padding: 0, margin: 0 }}
              >
                @{label}
              </Typography.Link>
            );
          })}
        </div>
      ) : null}
    </Space>
  );
}
