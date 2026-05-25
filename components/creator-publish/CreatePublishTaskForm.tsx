import {
  Button,
  Card,
  DatePicker,
  Form,
  Input,
  Radio,
  Select,
  Space,
  Switch,
  Typography,
  Upload,
} from "antd";
import { MultiSelectWithTooltip } from "@/components/MultiSelectWithTooltip";
import dayjs from "dayjs";
import {
  SCHEDULE_SHOW_TIME,
  scheduleDisabledDate,
  scheduleDisabledTime,
} from "@/lib/creator-publish/scheduleUtils";
import type { TaskType } from "@/lib/creator-publish/types";

const { Text } = Typography;

type CreatePublishTaskFormProps = {
  type: TaskType;
  setType: (v: TaskType) => void;
  accountNames: string[];
  setAccountNames: (v: string[]) => void;
  accountOptions: { label: string; value: string }[];
  loadingAccounts: boolean;
  videoUploadProps: Record<string, unknown>;
  videoFileKey: string;
  imageUploadProps: Record<string, unknown>;
  imageKeys: string[];
  coverImageKey: string | undefined;
  setCoverImageKey: (v: string | undefined) => void;
  coverOptions: { label: string; value: string }[];
  productLink: string;
  setProductLink: (v: string) => void;
  title: string;
  setTitle: (v: string) => void;
  description: string;
  setDescription: (v: string) => void;
  productTitle: string;
  setProductTitle: (v: string) => void;
  approvalNumber: string;
  setApprovalNumber: (v: string) => void;
  isAiContent: boolean;
  setIsAiContent: (v: boolean) => void;
  scheduleAt: string | null;
  setScheduleAt: (v: string | null) => void;
  schedulePresets: { label: string; value: dayjs.Dayjs }[];
  creating: boolean;
  onCreateTasks: () => void;
};

export function CreatePublishTaskForm(props: CreatePublishTaskFormProps) {
  const {
    type,
    setType,
    accountNames,
    setAccountNames,
    accountOptions,
    loadingAccounts,
    videoUploadProps,
    videoFileKey,
    imageUploadProps,
    imageKeys,
    coverImageKey,
    setCoverImageKey,
    coverOptions,
    productLink,
    setProductLink,
    title,
    setTitle,
    description,
    setDescription,
    productTitle,
    setProductTitle,
    approvalNumber,
    setApprovalNumber,
    isAiContent,
    setIsAiContent,
    scheduleAt,
    setScheduleAt,
    schedulePresets,
    creating,
    onCreateTasks,
  } = props;

  return (
    <div style={{ width: "100%" }}>
      <Space orientation="vertical" size={6} style={{ width: "100%" }}>
        <Card size="small" styles={{ body: { paddingTop: 8 } }}>
          <Space orientation="vertical" size={6} style={{ width: "100%" }}>
            <Form layout="vertical" colon={false} requiredMark={false}>
              <Form.Item label="发布类型" style={{ marginBottom: 8 }}>
                <Radio.Group
                  value={type}
                  onChange={(e) => setType(e.target.value)}
                  optionType="button"
                  buttonStyle="solid"
                  options={[
                    { label: "发布视频", value: "video" },
                    { label: "发布图文", value: "article" },
                  ]}
                />
              </Form.Item>

              <Form.Item
                label="选择账号"
                style={{ marginBottom: 8 }}
                help={
                  <span style={{ fontSize: 11, color: "var(--vol-mute)" }}>
                    {loadingAccounts ? "加载中..." : "多选会为每个账号创建一条任务"}
                  </span>
                }
              >
                <MultiSelectWithTooltip
                  allowClear
                  value={accountNames}
                  onChange={setAccountNames}
                  options={accountOptions}
                  loading={loadingAccounts}
                  placeholder="请选择抖创账号"
                />
              </Form.Item>

              {type === "video" && (
                <Form.Item label="上传视频" style={{ marginBottom: 8 }}>
                  <Upload {...videoUploadProps} accept="video/*" showUploadList={false}>
                    <Button>选择视频文件</Button>
                  </Upload>
                  {videoFileKey && (
                    <div style={{ marginTop: 6 }}>
                      <Text type="secondary">已上传: </Text>
                      <Text code>{videoFileKey}</Text>
                    </div>
                  )}
                </Form.Item>
              )}

              {type === "article" && (
                <>
                  <Form.Item label="上传图片（多张）" style={{ marginBottom: 8 }}>
                    <Upload {...imageUploadProps} accept="image/*" showUploadList={false}>
                      <Button>选择图片文件</Button>
                    </Upload>
                    {imageKeys.length > 0 && (
                      <div style={{ marginTop: 6 }}>
                        <Text type="secondary">已上传 {imageKeys.length} 张</Text>
                      </div>
                    )}
                  </Form.Item>

                  <Form.Item label="封面（可选）" style={{ marginBottom: 8 }}>
                    <Select
                      allowClear
                      placeholder="不选则默认第一张"
                      value={coverImageKey}
                      onChange={(v) => setCoverImageKey(v)}
                      options={coverOptions}
                      disabled={imageKeys.length === 0}
                    />
                  </Form.Item>
                </>
              )}

              <Form.Item label="商品链接" style={{ marginBottom: 8 }}>
                <Input
                  value={productLink}
                  onChange={(e) => setProductLink(e.target.value)}
                  placeholder="用于自动切换为购物车并粘贴商品链接"
                />
              </Form.Item>

              <Form.Item label="标题" style={{ marginBottom: 8 }}>
                <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="标题" />
              </Form.Item>

              <Form.Item label="描述" style={{ marginBottom: 8 }}>
                <Input.TextArea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="描述"
                  autoSize={{ minRows: 2, maxRows: 6 }}
                />
              </Form.Item>

              <Form.Item label="商品标题" style={{ marginBottom: 8 }}>
                <Input
                  value={productTitle}
                  onChange={(e) => setProductTitle(e.target.value)}
                  placeholder="商品短标题，用于商品编辑弹窗自动填写"
                />
              </Form.Item>

              <Form.Item label="广审批文号" style={{ marginBottom: 8 }}>
                <Input
                  value={approvalNumber}
                  onChange={(e) => setApprovalNumber(e.target.value)}
                  placeholder="不包含广审内容"
                />
              </Form.Item>

              <Form.Item
                label="AI内容"
                style={{ marginBottom: 8 }}
                help={
                  <span style={{ fontSize: 11, color: "var(--vol-mute)" }}>
                    开启后自主声明选"内容由AI生成"，关闭则选"无需添加自主声明"
                  </span>
                }
              >
                <Switch
                  checked={isAiContent}
                  onChange={setIsAiContent}
                  checkedChildren="是"
                  unCheckedChildren="否"
                />
              </Form.Item>

              <Form.Item
                label="定时发布时间（可选）"
                style={{ marginBottom: 8 }}
                help={
                  <span style={{ fontSize: 11, color: "var(--vol-mute)" }}>
                    不填则立即发布 | 不可选择过去时间
                  </span>
                }
              >
                <DatePicker
                  showTime={SCHEDULE_SHOW_TIME}
                  format="YYYY-MM-DD HH:mm"
                  allowClear
                  placeholder="选择定时发布时间"
                  value={scheduleAt ? dayjs(scheduleAt) : null}
                  onChange={(v) => setScheduleAt(v ? v.toISOString() : null)}
                  disabledDate={scheduleDisabledDate}
                  disabledTime={scheduleDisabledTime}
                  presets={schedulePresets}
                  style={{ width: "100%" }}
                />
              </Form.Item>

              <Space>
                <Button type="primary" onClick={onCreateTasks} loading={creating}>
                  创建任务
                </Button>
              </Space>
            </Form>
          </Space>
        </Card>
      </Space>
    </div>
  );
}
