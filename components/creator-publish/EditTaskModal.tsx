import {
  Button,
  DatePicker,
  Form,
  Input,
  Modal,
  Segmented,
  Select,
  Space,
  Switch,
  Typography,
} from "antd";
import dayjs from "dayjs";
import {
  buildScheduleTimeOptionsForDay,
  defaultFutureScheduleIso,
  scheduleDisabledDate,
} from "@/lib/creator-publish/scheduleUtils";
import type { EditTaskState, PublishTask } from "@/lib/creator-publish/types";

const { Text } = Typography;

type EditTaskModalProps = {
  editingTask: PublishTask | null;
  editState: EditTaskState;
  setEditState: React.Dispatch<React.SetStateAction<EditTaskState>>;
  editAccountSelectOptions: { label: string; value: string }[];
  loadingAccounts: boolean;
  editScheduleTimeOptions: { label: string; value: string }[];
  schedulePresets: { label: string; value: dayjs.Dayjs }[];
  savingEdit: boolean;
  onClose: () => void;
  onSave: () => void;
};

export function EditTaskModal({
  editingTask,
  editState,
  setEditState,
  editAccountSelectOptions,
  loadingAccounts,
  editScheduleTimeOptions,
  schedulePresets,
  savingEdit,
  onClose,
  onSave,
}: EditTaskModalProps) {
  return (
    <Modal
      title="编辑任务"
      open={Boolean(editingTask && editState)}
      onCancel={onClose}
      onOk={onSave}
      confirmLoading={savingEdit}
      okText="保存"
      cancelText="取消"
      destroyOnHidden
      centered
      width={560}
      styles={{
        body: {
          paddingTop: 12,
          paddingBottom: 12,
          maxHeight: "calc(100vh - 180px)",
          overflowY: "auto",
          overflowX: "hidden",
        },
      }}
      style={{ top: 24 }}
    >
      {editingTask && editState ? (
        <Form layout="vertical" colon={false} requiredMark={false} style={{ marginBottom: 0 }}>
          <Form.Item
            label="店铺/账号"
            style={{ marginBottom: 10 }}
            help={
              <span style={{ fontSize: 11, color: "var(--vol-mute)" }}>
                切换到其它账号后，任务将以新账号的登录态执行（须已在全局配置中添加该抖创账号）
              </span>
            }
          >
            <Select
              showSearch
              optionFilterProp="label"
              value={editState.accountName || undefined}
              onChange={(v) => setEditState((prev) => (prev ? { ...prev, accountName: v } : prev))}
              options={editAccountSelectOptions}
              loading={loadingAccounts}
              placeholder="选择店铺/抖创账号"
              popupMatchSelectWidth={false}
            />
          </Form.Item>
          <Form.Item label="类型" style={{ marginBottom: 10 }}>
            <Input value={editingTask.payload.type === "video" ? "视频" : "图文"} disabled />
          </Form.Item>
          <Form.Item label="标题" style={{ marginBottom: 10 }}>
            <Input
              value={editState.title}
              onChange={(e) => setEditState((prev) => (prev ? { ...prev, title: e.target.value } : prev))}
            />
          </Form.Item>
          <Form.Item label="正文" style={{ marginBottom: 10 }}>
            <Input.TextArea
              value={editState.description}
              onChange={(e) =>
                setEditState((prev) => (prev ? { ...prev, description: e.target.value } : prev))
              }
              autoSize={{ minRows: 4, maxRows: 8 }}
            />
          </Form.Item>
          <Form.Item label="挂车链接" style={{ marginBottom: 10 }}>
            <Input
              value={editState.productLink}
              onChange={(e) =>
                setEditState((prev) => (prev ? { ...prev, productLink: e.target.value } : prev))
              }
            />
          </Form.Item>
          <Form.Item label="商品标题" style={{ marginBottom: 10 }}>
            <Input
              value={editState.productTitle}
              onChange={(e) =>
                setEditState((prev) => (prev ? { ...prev, productTitle: e.target.value } : prev))
              }
            />
          </Form.Item>
          <Form.Item label="广审批文号" style={{ marginBottom: 10 }}>
            <Input
              value={editState.approvalNumber}
              onChange={(e) =>
                setEditState((prev) => (prev ? { ...prev, approvalNumber: e.target.value } : prev))
              }
            />
          </Form.Item>
          <Form.Item label="AI内容" style={{ marginBottom: 10 }}>
            <Switch
              checked={editState.isAiContent}
              onChange={(checked) =>
                setEditState((prev) => (prev ? { ...prev, isAiContent: checked } : prev))
              }
              checkedChildren="是"
              unCheckedChildren="否"
            />
          </Form.Item>
          <Form.Item
            label="定时发布时间"
            style={{ marginBottom: 0 }}
            help={
              <span style={{ fontSize: 11, color: "var(--vol-mute)" }}>
                选「立即执行」尽快跑任务；定时时先选日期，时间用下拉（可搜索、无滚轮跳动）；亦可点下方快捷时间
              </span>
            }
          >
            <Space orientation="vertical" size={10} style={{ width: "100%" }}>
              <Segmented
                block
                value={editState.scheduleAt ? "scheduled" : "immediate"}
                onChange={(v) => {
                  if (v === "immediate") {
                    setEditState((prev) => (prev ? { ...prev, scheduleAt: null } : prev));
                  } else {
                    setEditState((prev) => {
                      if (!prev) return prev;
                      if (prev.scheduleAt) return prev;
                      return { ...prev, scheduleAt: defaultFutureScheduleIso() };
                    });
                  }
                }}
                options={[
                  { label: "立即执行", value: "immediate" },
                  { label: "定时发布", value: "scheduled" },
                ]}
              />
              {editState.scheduleAt ? (
                <>
                  <Space.Compact block>
                    <DatePicker
                      style={{ width: "52%" }}
                      format="YYYY-MM-DD"
                      allowClear={false}
                      placeholder="日期"
                      value={dayjs(editState.scheduleAt).isValid() ? dayjs(editState.scheduleAt) : null}
                      onChange={(d) => {
                        setEditState((prev) => {
                          if (!prev?.scheduleAt || !d) return prev;
                          const cur = dayjs(prev.scheduleAt);
                          if (!cur.isValid()) return { ...prev, scheduleAt: defaultFutureScheduleIso() };
                          let merged = d.hour(cur.hour()).minute(cur.minute()).second(0).millisecond(0);
                          if (merged.isBefore(dayjs())) {
                            const opts = buildScheduleTimeOptionsForDay(merged);
                            if (opts.length > 0) {
                              const [hs, ms] = opts[0].value.split(":");
                              merged = d
                                .hour(parseInt(hs, 10))
                                .minute(parseInt(ms, 10))
                                .second(0)
                                .millisecond(0);
                            } else {
                              merged = dayjs(defaultFutureScheduleIso());
                            }
                          }
                          return { ...prev, scheduleAt: merged.toISOString() };
                        });
                      }}
                      disabledDate={scheduleDisabledDate}
                      getPopupContainer={() => document.body}
                      styles={{ popup: { root: { zIndex: 1100 } } }}
                    />
                    <Select
                      style={{ width: "48%" }}
                      placeholder="时间"
                      allowClear={false}
                      showSearch={{ optionFilterProp: "label" }}
                      getPopupContainer={() => document.body}
                      popupMatchSelectWidth={false}
                      listHeight={280}
                      options={editScheduleTimeOptions}
                      notFoundContent="所选日期暂无可选时刻，请换一天"
                      value={
                        dayjs(editState.scheduleAt).isValid()
                          ? dayjs(editState.scheduleAt).format("HH:mm")
                          : undefined
                      }
                      onChange={(hm) => {
                        if (!hm) return;
                        const parts = hm.split(":");
                        const hh = parseInt(parts[0], 10);
                        const mm = parseInt(parts[1], 10);
                        if (!Number.isFinite(hh) || !Number.isFinite(mm)) return;
                        setEditState((prev) => {
                          if (!prev?.scheduleAt) return prev;
                          const cur = dayjs(prev.scheduleAt);
                          if (!cur.isValid()) return { ...prev, scheduleAt: defaultFutureScheduleIso() };
                          const merged = cur.hour(hh).minute(mm).second(0).millisecond(0);
                          if (merged.isBefore(dayjs())) return prev;
                          return { ...prev, scheduleAt: merged.toISOString() };
                        });
                      }}
                      styles={{ popup: { root: { zIndex: 1100 } } }}
                    />
                  </Space.Compact>
                  <div>
                    <Text type="secondary" style={{ fontSize: 11, marginBottom: 4, display: "block" }}>
                      快捷时间
                    </Text>
                    <Space size={[6, 6]} wrap>
                      {schedulePresets.map((p) => (
                        <Button
                          key={p.label}
                          size="small"
                          type="default"
                          onClick={() =>
                            setEditState((prev) =>
                              prev ? { ...prev, scheduleAt: p.value.toISOString() } : prev
                            )
                          }
                        >
                          {p.label}
                        </Button>
                      ))}
                    </Space>
                  </div>
                </>
              ) : null}
            </Space>
          </Form.Item>
        </Form>
      ) : null}
    </Modal>
  );
}
