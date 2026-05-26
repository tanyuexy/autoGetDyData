"use client";

import { Button, Select, Table } from "antd";
import { LinkOutlined } from "@ant-design/icons";
import { ReviewToolbar } from "@/components/review/ReviewToolbar";
import { useTableBodyScrollY } from "@/hooks/useTableBodyScrollY";
import { STATUS_FILTER_OPTIONS } from "@/lib/review/constants";
import { useReviewPage } from "@/lib/review/hooks/useReviewPage";

export default function ReviewPage() {
  const vm = useReviewPage();
  const { containerRef, scrollY } = useTableBodyScrollY();

  return (
    <div className="app-page-fill">
      <ReviewToolbar
        toolbarAccountsSanitized={vm.toolbarAccountsSanitized}
        onToolbarAccountChange={vm.handleToolbarAccountSelectChange}
        toolbarAccountSelectOptions={vm.toolbarAccountSelectOptions}
        loadingAccounts={vm.loadingAccounts}
        reviewDateRange={vm.reviewDateRange}
        onReviewDateRangeChange={vm.setReviewDateRange}
        fetching={vm.fetching}
        reviewBusy={vm.reviewBusy}
        onFetchWorkInfo={() => void vm.handleFetchWorkInfo()}
        selectedRowKeysCount={vm.selectedRowKeys.length}
        onBatchDelete={() => void vm.handleBatchDelete()}
        filteredCount={vm.filteredItems.length}
        approvedCount={vm.approvedCount}
        needsOptimizationCount={vm.needsOptimizationCount}
        underReviewCount={vm.underReviewCount}
        rejectedCount={vm.rejectedCount}
      />

      <div style={{ marginBottom: 10, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", flexShrink: 0 }}>
        <Select
          size="small"
          style={{ width: 120 }}
          value={vm.statusFilter}
          onChange={(v) => vm.setStatusFilter(v)}
          options={STATUS_FILTER_OPTIONS}
        />
        <Select
          size="small"
          style={{ width: 160 }}
          value={vm.accountFilter}
          onChange={(v) => vm.setAccountFilter(v)}
          options={[{ label: "全部账号", value: "all" }, ...vm.accountOptions]}
        />
        <Select
          size="small"
          showSearch
          allowClear
          style={{ width: 220 }}
          placeholder="搜索作品名"
          value={vm.workTitleFilter || undefined}
          onChange={(v) => vm.setWorkTitleFilter(v || "")}
          options={vm.workTitleOptions}
        />
        <Button
          type="primary"
          size="small"
          onClick={() => void vm.handleSyncFeishuLinks()}
          loading={vm.syncingFeishu}
          icon={<LinkOutlined />}
          style={{ marginLeft: "auto", fontWeight: 500 }}
        >
          同步到飞书
        </Button>
      </div>

      <div ref={containerRef} style={{ flex: 1, minHeight: 0 }}>
        <Table
          rowKey="id"
          size="small"
          bordered
          loading={vm.loadingItems}
          dataSource={vm.filteredItems}
          columns={vm.columns as never[]}
          tableLayout="fixed"
          rowSelection={{
            selectedRowKeys: vm.selectedRowKeys,
            onChange: (keys) => vm.setSelectedRowKeys(keys),
          }}
          pagination={{ pageSize: 20, showSizeChanger: true, showTotal: (t) => `共 ${t} 条` }}
          scroll={{ x: 900, y: scrollY }}
          locale={{ emptyText: "暂无作品记录，请先选择账号并点击「获取作品信息」" }}
          style={{ width: "100%" }}
        />
      </div>
    </div>
  );
}
