"use client";

import { AutoComplete, Modal, Space, Tag, Typography } from "antd";
import { COMPOSE_GROUP_PRESETS, COMPOSE_GROUP_QUICK_PICKS } from "@/lib/ai-video/constants";
import type { ClipItem } from "@/lib/ai-video/types";

export interface GroupAssignModalProps {
  open: boolean;
  assigningGroup: boolean;
  selectedClips: ClipItem[];
  groupAssignName: string;
  composeGroupOptions: Array<{ value: string; label: string }>;
  onCancel: () => void;
  onGroupAssignNameChange: (value: string) => void;
  onConfirm: () => Promise<void>;
}

export function GroupAssignModal({
  open,
  assigningGroup,
  selectedClips,
  groupAssignName,
  composeGroupOptions,
  onCancel,
  onGroupAssignNameChange,
  onConfirm,
}: GroupAssignModalProps) {
  return (
    <Modal
      title="设为一组"
      open={open}
      centered
      destroyOnHidden
      confirmLoading={assigningGroup}
      okText="确定"
      cancelText="取消"
      onCancel={onCancel}
      onOk={() => void onConfirm()}
    >
      <Space orientation="vertical" size={12} style={{ width: "100%" }}>
        <Typography.Text type="secondary">
          将已选的 {selectedClips.length} 个片段设为同一混剪分组。
        </Typography.Text>
        <AutoComplete
          value={groupAssignName}
          options={composeGroupOptions}
          placeholder="选择已有分组或输入新名称"
          style={{ width: "100%" }}
          allowClear
          filterOption={(inputValue, option) =>
            String(option?.value ?? "")
              .toLowerCase()
              .includes(inputValue.trim().toLowerCase())
          }
          onChange={(value) => onGroupAssignNameChange(value)}
          onSelect={(value) => onGroupAssignNameChange(value)}
          onKeyDown={async (e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            await onConfirm();
          }}
        />
        <Space size={[8, 8]} wrap>
          {[...COMPOSE_GROUP_PRESETS, ...COMPOSE_GROUP_QUICK_PICKS].map((name) => (
            <Tag
              key={name}
              variant="filled"
              color={groupAssignName === name ? "blue" : "default"}
              style={{
                cursor: "pointer",
                margin: 0,
                ...(COMPOSE_GROUP_QUICK_PICKS.includes(name)
                  ? { minWidth: 28, textAlign: "center" as const }
                  : {}),
              }}
              onClick={() => onGroupAssignNameChange(name)}
            >
              {name}
            </Tag>
          ))}
        </Space>
      </Space>
    </Modal>
  );
}
