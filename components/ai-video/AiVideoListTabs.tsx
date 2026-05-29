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
import { DownloadOutlined, GroupOutlined, ScissorOutlined, UploadOutlined } from "@ant-design/icons";
import { ComposeFilmModal, type ComposeFilmModalResult } from "@/components/ComposeFilmModal";
import type { AiVideoComposedFilm } from "@/types";
import { antdTagPresetStyle } from "@/lib/semanticTagStyles";
import { sectionStyle } from "@/lib/ai-video/styles";
import type { ClipItem } from "@/lib/ai-video/types";
import {
  AI_VIDEO_CLIPS_TABLE_MIN_WIDTH,
  AI_VIDEO_FILMS_TABLE_MIN_WIDTH,
  useAdaptiveTableScroll,
} from "@/lib/ai-video/tableLayout";

export interface AiVideoListTabsProps {
  listTab: "clips" | "films";
  setListTab: (tab: "clips" | "films") => void;
  clips: ClipItem[];
  visibleClips: ClipItem[];
  clipTagFilter: string | null;
  clipTagFilterOptions: Array<{ value: string; label: string }>;
  onClipTagFilterChange: (value: string | null) => void;
  clipComposeGroupFilter: string | null;
  clipComposeGroupFilterOptions: Array<{ value: string; label: string }>;
  onClipComposeGroupFilterChange: (value: string | null) => void;
  clipsHydrated: boolean;
  clipColumns: NonNullable<TableProps<ClipItem>["columns"]>;
  composeOrderMap: Map<string, number>;
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
  selectedFilmIds: React.Key[];
  selectedFilms: AiVideoComposedFilm[];
  downloadingFilms: boolean;
  onFilmSelectionChange: (keys: React.Key[]) => void;
  onDownloadSelectedFilms: () => void | Promise<void>;
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
  clipComposeGroupFilter,
  clipComposeGroupFilterOptions,
  onClipComposeGroupFilterChange,
  clipsHydrated,
  clipColumns,
  composeOrderMap,
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
  selectedFilmIds,
  selectedFilms,
  downloadingFilms,
  onFilmSelectionChange,
  onDownloadSelectedFilms,
  filmColumns,
  composeModalOpen,
  onCloseComposeModal,
  composing,
  onComposeSubmit,
}: AiVideoListTabsProps) {
  const clipsTableScroll = useAdaptiveTableScroll(AI_VIDEO_CLIPS_TABLE_MIN_WIDTH);
  const filmsTableScroll = useAdaptiveTableScroll(AI_VIDEO_FILMS_TABLE_MIN_WIDTH);

  return (
    <>
      <section style={sectionStyle}>
        <Tabs
          className={`ai-video-list-tabs${listTab === "films" ? " ai-video-list-tabs--films" : ""}`}
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
                      {clipTagFilter || clipComposeGroupFilter ? `${visibleClips.length}/${clips.length}` : clips.length}
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
                      <Select
                        allowClear
                        showSearch
                        placeholder="筛选混剪分组"
                        value={clipComposeGroupFilter ?? undefined}
                        options={clipComposeGroupFilterOptions}
                        style={{ minWidth: 180 }}
                        filterOption={(input, option) =>
                          String(option?.label ?? option?.value ?? "")
                            .toLowerCase()
                            .includes(input.trim().toLowerCase())
                        }
                        onChange={(value) => onClipComposeGroupFilterChange(value ? String(value) : null)}
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
                    <div
                      ref={clipsTableScroll.wrapRef}
                      className={`ai-video-table-wrap${clipsTableScroll.scrollX ? " ai-video-table-wrap--scroll" : " ai-video-table-wrap--fluid"}`}
                    >
                      <Table
                        rowKey="id"
                        size="small"
                        className="ai-video-clips-table"
                        tableLayout={clipsTableScroll.scrollX ? "fixed" : "auto"}
                        scroll={clipsTableScroll.scrollX ? { x: clipsTableScroll.scrollX } : undefined}
                        pagination={{ pageSize: 8 }}
                        dataSource={visibleClips}
                        columns={clipColumns}
                        rowSelection={{
                          selectedRowKeys: selectedClipIds,
                          onChange: onClipSelectionChange,
                          getCheckboxProps: (record) => ({ disabled: !record.videoUrl }),
                          align: "center",
                          columnWidth: 52,
                          renderCell: (_checked, record, _index, originNode) => {
                            const order = composeOrderMap.get(record.id);
                            if (!order) return originNode;
                            return (
                              <div
                                style={{
                                  display: "flex",
                                  flexDirection: "column",
                                  alignItems: "center",
                                  gap: 2,
                                }}
                              >
                                <Tag
                                  style={{
                                    ...antdTagPresetStyle("blue"),
                                    margin: 0,
                                    minWidth: 22,
                                    textAlign: "center",
                                  }}
                                >
                                  {order}
                                </Tag>
                                {originNode}
                              </div>
                            );
                          },
                        }}
                      />
                    </div>
                  ) : (
                    <Empty description={clipTagFilter || clipComposeGroupFilter ? "当前筛选条件下暂无片段" : "还没有片段"} />
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
                <Space orientation="vertical" size={8} style={{ width: "100%" }}>
                  {composedFilms.length ? (
                    <>
                      <Space align="center" style={{ width: "100%", justifyContent: "space-between" }} wrap>
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                          勾选成片后可批量下载
                        </Typography.Text>
                        <Button
                          icon={<DownloadOutlined />}
                          disabled={!selectedFilms.length}
                          loading={downloadingFilms}
                          onClick={() => void onDownloadSelectedFilms()}
                        >
                          下载选中
                        </Button>
                      </Space>
                      {selectedFilms.length ? (
                        <Alert
                          type="info"
                          showIcon
                          banner
                          style={{ padding: "4px 12px", marginBottom: 0 }}
                          title={`已选 ${selectedFilms.length} 个成片`}
                        />
                      ) : null}
                      <div
                        ref={filmsTableScroll.wrapRef}
                        className={`ai-video-table-wrap${filmsTableScroll.scrollX ? " ai-video-table-wrap--scroll" : " ai-video-table-wrap--fluid"}`}
                      >
                        <Table
                          rowKey="id"
                          size="small"
                          className="ai-video-films-table"
                          tableLayout={filmsTableScroll.scrollX ? "fixed" : "auto"}
                          scroll={filmsTableScroll.scrollX ? { x: filmsTableScroll.scrollX } : undefined}
                          pagination={{ pageSize: 8 }}
                          dataSource={composedFilms}
                          columns={filmColumns}
                          rowSelection={{
                            selectedRowKeys: selectedFilmIds,
                            onChange: onFilmSelectionChange,
                            getCheckboxProps: (record) => ({ disabled: !record.videoUrl }),
                            align: "center",
                          }}
                        />
                      </div>
                    </>
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
