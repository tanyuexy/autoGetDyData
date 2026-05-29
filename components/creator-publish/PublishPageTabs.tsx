import { Badge, Tabs } from "antd";
import { CreatePublishTaskForm } from "@/components/creator-publish/CreatePublishTaskForm";
import { PublishTaskListSection } from "@/components/creator-publish/PublishTaskListSection";
import type { useCreatorPublishPage } from "@/lib/creator-publish/hooks/useCreatorPublishPage";

type PublishPageTabsProps = {
  vm: ReturnType<typeof useCreatorPublishPage>;
};

export function PublishPageTabs({ vm }: PublishPageTabsProps) {
  const tabItems = [
    {
      key: "create",
      label: "创建任务",
      children: (
        <CreatePublishTaskForm
          type={vm.type}
          setType={vm.setType}
          accountNames={vm.accountNames}
          setAccountNames={vm.setAccountNames}
          accountOptions={vm.accountOptions}
          loadingAccounts={vm.loadingAccounts}
          videoUploadProps={vm.videoUploadProps}
          videoFileKey={vm.videoFileKey}
          imageUploadProps={vm.imageUploadProps}
          imageKeys={vm.imageKeys}
          coverImageKey={vm.coverImageKey}
          setCoverImageKey={vm.setCoverImageKey}
          coverOptions={vm.coverOptions}
          productLink={vm.productLink}
          setProductLink={vm.setProductLink}
          title={vm.title}
          setTitle={vm.setTitle}
          description={vm.description}
          setDescription={vm.setDescription}
          productTitle={vm.productTitle}
          setProductTitle={vm.setProductTitle}
          approvalNumber={vm.approvalNumber}
          setApprovalNumber={vm.setApprovalNumber}
          isAiContent={vm.isAiContent}
          setIsAiContent={vm.setIsAiContent}
          scheduleAt={vm.scheduleAt}
          setScheduleAt={vm.setScheduleAt}
          schedulePresets={vm.schedulePresets}
          creating={vm.creating}
          onCreateTasks={() => void vm.handleCreateTasks()}
        />
      ),
    },
    {
      key: "tasks",
      label: (
        <Badge count={vm.runningCount} size="small" offset={[6, 0]}>
          <span style={{ paddingRight: 4 }}>任务列表</span>
        </Badge>
      ),
      children: (
        <PublishTaskListSection
          taskTypeFilters={vm.taskTypeFilters}
          setTaskTypeFilters={vm.setTaskTypeFilters}
          taskStatusFilters={vm.taskStatusFilters}
          setTaskStatusFilters={vm.setTaskStatusFilters}
          taskShopFilters={vm.taskShopFilters}
          setTaskShopFilters={vm.setTaskShopFilters}
          taskShopSelectOptions={vm.taskShopSelectOptions}
          selectedRowKeys={vm.selectedRowKeys}
          terminableSelectedRowKeys={vm.terminableSelectedRowKeys}
          onStartTasks={() => void vm.handleStartTasks()}
          onKillSelected={() => void vm.handleKillSelected()}
          onBatchDelete={() => void vm.handleBatchDelete()}
          feishuAiProvider={vm.feishuAiProvider}
          onFeishuAiProviderChange={(v) => void vm.handleFeishuAiProviderChange(v)}
          onGenerateFeishuAiContent={() => void vm.handleGenerateFeishuAiContent()}
          generatingFeishuAi={vm.generatingFeishuAi}
          isNamespaceBusy={vm.isNamespaceBusy}
          onImportFromFeishu={() => void vm.handleImportFromFeishu()}
          importing={vm.importing}
          onRefreshTasks={() => void vm.handleRefreshTasks()}
          loadingTasks={vm.loadingTasks}
          filteredTasks={vm.filteredTasks}
          columns={vm.columns}
          setTableSorter={vm.setTableSorter}
          rowSelection={vm.rowSelection}
        />
      ),
    },
  ];

  return (
    <Tabs
      className="page-fill-tabs"
      defaultActiveKey="tasks"
      items={tabItems}
      size="small"
      style={{ width: "100%" }}
      tabBarStyle={{ marginBottom: 12, flexShrink: 0 }}
      onChange={(key) => {
        if (key === "tasks") void vm.fetchTasks();
      }}
    />
  );
}
