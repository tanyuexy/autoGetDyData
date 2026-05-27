"use client";

import {
  Alert,
  Button,
  Empty,
  Select,
  Space,
  Spin,
  Table,
  Tabs,
  Tag,
  Typography,
  Upload,
} from "antd";
import type { TableProps, UploadProps } from "antd";
import { GroupOutlined, ScissorOutlined, UploadOutlined } from "@ant-design/icons";
import { ComposeFilmModal, type ComposeFilmModalResult } from "@/components/ComposeFilmModal";
import type { AiVideoComposedFilm } from "@/types";
import { sectionStyle } from "@/lib/ai-video/styles";
import type { ClipItem } from "@/lib/ai-video/types";

export interface AiVideoListTabsProps {
  listTab: "clips" | "films";
  setListTab: (tab: "clips" | "films") => void;
  clips: ClipItem[];
  visibleClips: ClipItem[];
  clipTagFilter: string | null;
  clipTagFilterOptions: Array<{ value: string; label: string }>;
  onClipTagFilterChange: (value: string | null) => void;
  clipsHydrated: boolean;
  clipColumns: NonNullable<TableProps<ClipItem>["columns"]>;
  selectedClipIds: React.Key[];
  onClipSelectionChange: (keys: React.Key[]) => void;
  selectedClips: ClipItem[];
  selectedDuration: number;
  assigningGroup: boolean;
  onOpenGroupAssignModal: () => void;
  onClearSelectedComposeGroups: () => void;
  clipUploadProps: UploadProps;
  uploadingClip: boolean;
  onOpenComposeModal: () => void;
  composedFilms: AiVideoComposedFilm[];
  filmsHydrated: boolean;
  filmColumns: NonNullable<TableProps<AiVideoComposedFilm>["columns"]>;
  composeModalOpen: boolean;
  onCloseComposeModal: () => void;
  composing: boolean;
  onComposeSubmit: (payload: {
    mode: "sequential" | "random";
    segments?: Array<{ id: string; name: string; videoUrl: string }>;
    groups?: Array<{ name: string; segments: Array<{ id: string; name: string; videoUrl: string }> }>;
    outputCount?: number;
    orderRule?: string;
    addBackgroundMusic?: boolean;
  }) => Promise<ComposeFilmModalResult | null>;
}

export function AiVideoListTabs({
  listTab,
  setListTab,
  clips,
  visibleClips,
  clipTagFilter,
  clipTagFilterOptions,
  onClipTagFilterChange,
  clipsHydrated,
  clipColumns,
  selectedClipIds,
  onClipSelectionChange,
  selectedClips,
  selectedDuration,
  assigningGroup,
  onOpenGroupAssignModal,
  onClearSelectedComposeGroups,
  clipUploadProps,
  uploadingClip,
  onOpenComposeModal,
  composedFilms,
  filmsHydrated,
  filmColumns,
  composeModalOpen,
  onCloseComposeModal,
  composing,
  onComposeSubmit,
}: AiVideoListTabsProps) {
  return (
    <>
      <section style={sectionStyle}>
        <Tabs
          activeKey={listTab}
          onChange={(key) => setListTab(key as "clips" | "films")}
          items={[
            {
              key: "clips",
              label: (
                <Space size={6}>
                  <span>片段列表</span>
                  {clipsHydrated ? (
                    <Tag variant="filled" color="default">
                      {clipTagFilter ? `${visibleClips.length}/${clips.length}` : clips.length}
                    </Tag>
                  ) : (
                    <Spin size="small" />
                  )}
                </Space>
              ),
              children: (
                <Space orientation="vertical" size={8} style={{ width: "100%" }}>
                  <Space align="center" style={{ width: "100%", justifyContent: "space-between" }} wrap>
                    <Space wrap size={8} align="center">
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        勾选片段后可「设为一组」批量分组；随机混剪时先选标签再选分组
                      </Typography.Text>
                      <Select
                        allowClear
                        showSearch
                        placeholder="筛选标签"
                        value={clipTagFilter ?? undefined}
                        options={clipTagFilterOptions}
                        style={{ minWidth: 180 }}
                        filterOption={(input, option) =>
                          String(option?.label ?? option?.value ?? "")
                            .toLowerCase()
                            .includes(input.trim().toLowerCase())
                        }
                        onChange={(value) => onClipTagFilterChange(value ? String(value) : null)}
                      />
                    </Space>
                    <Space wrap>
                      <Button
                        icon={<GroupOutlined />}
                        disabled={!selectedClips.length}
                        loading={assigningGroup}
                        onClick={onOpenGroupAssignModal}
                      >
                        设为一组
                      </Button>
                      <Button
                        disabled={!selectedClips.length}
                        loading={assigningGroup}
                        onClick={() => void onClearSelectedComposeGroups()}
                      >
                        清除分组
                      </Button>
                      <Upload {...clipUploadProps}>
                        <Button icon={<UploadOutlined />} loading={uploadingClip}>
                          上传片段
                        </Button>
                      </Upload>
                      <Button type="primary" icon={<ScissorOutlined />} onClick={onOpenComposeModal}>
                        合成成片
                      </Button>
                    </Space>
                  </Space>

                  <Alert
                    type="info"
                    showIcon
                    banner
                    style={{ padding: "4px 12px", marginBottom: 0 }}
                    title={`已选 ${selectedClips.length} 个片段，预计 ${selectedDuration || 0} 秒`}
                  />

                  {visibleClips.length ? (
                    <Table
                      rowKey="id"
                      size="small"
                      className="ai-video-clips-table"
                      pagination={{ pageSize: 8 }}
                      dataSource={visibleClips}
                      columns={clipColumns}
                      rowSelection={{
                        selectedRowKeys: selectedClipIds,
                        onChange: onClipSelectionChange,
                        getCheckboxProps: (record) => ({ disabled: !record.videoUrl }),
                        align: "center",
                      }}
                    />
                  ) : (
                    <Empty description={clipTagFilter ? "当前标签下暂无片段" : "还没有片段"} />
                  )}
                </Space>
              ),
            },
            {
              key: "films",
              label: (
                <Space size={6}>
                  <span>成片列表</span>
                  {filmsHydrated ? (
                    <Tag variant="filled" color="default">
                      {composedFilms.length}
                    </Tag>
                  ) : (
                    <Spin size="small" />
                  )}
                </Space>
              ),
              children: (
                <Space orientation="vertical" size={12} style={{ width: "100%" }}>
                  {composedFilms.length ? (
                    <Table
                      rowKey="id"
                      size="small"
                      className="ai-video-films-table"
                      tableLayout="fixed"
                      scroll={{ x: 988 }}
                      pagination={{ pageSize: 8 }}
                      dataSource={composedFilms}
                      columns={filmColumns}
                    />
                  ) : filmsHydrated ? (
                    <Empty description="还没有成片，合成后会自动出现在这里" />
                  ) : (
                    <Spin />
                  )}
                </Space>
              ),
            },
          ]}
        />
      </section>

      <ComposeFilmModal
        open={composeModalOpen}
        clips={clips}
        selectedClips={selectedClips}
        composing={composing}
        onCancel={onCloseComposeModal}
        onSubmit={onComposeSubmit}
      />
    </>
  );
}
