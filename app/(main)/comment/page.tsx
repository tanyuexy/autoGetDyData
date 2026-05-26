"use client";

import { Select, Table } from "antd";
import { CommentReplyModal } from "@/components/comment/CommentReplyModal";
import { CommentToolbar } from "@/components/comment/CommentToolbar";
import { useTableBodyScrollY } from "@/hooks/useTableBodyScrollY";
import { useCommentPage } from "@/lib/comment/hooks/useCommentPage";

export default function CommentPage() {
  const vm = useCommentPage();
  const { containerRef, scrollY } = useTableBodyScrollY();

  return (
    <div className="app-page-fill">
      <CommentToolbar
        toolbarAccountsSanitized={vm.toolbarAccountsSanitized}
        onToolbarAccountChange={vm.handleToolbarAccountSelectChange}
        toolbarAccountSelectOptions={vm.toolbarAccountSelectOptions}
        loadingAccounts={vm.loadingAccounts}
        maxWorks={vm.maxWorks}
        onMaxWorksChange={vm.setMaxWorks}
        fetching={vm.fetching}
        commentBusy={vm.commentBusy}
        onFetchComments={() => void vm.handleFetchComments()}
        selectedRowKeysCount={vm.selectedRowKeys.length}
        onBatchDelete={() => void vm.handleBatchDelete()}
        totalComments={vm.totalComments}
        accountStats={vm.accountStats}
      />

      <div style={{ marginBottom: 10, display: "flex", gap: 12, alignItems: "center", flexShrink: 0 }}>
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
          pagination={{
            pageSize: 30,
            showSizeChanger: true,
            showTotal: (t) => `共 ${t} 条评论`,
          }}
          scroll={{ x: 960, y: scrollY }}
          locale={{ emptyText: "暂无评论数据，请先选择账号并点击「抓取评论」" }}
          style={{ width: "100%" }}
        />
      </div>

      <CommentReplyModal
        open={vm.replyModalOpen}
        replyTarget={vm.replyTarget}
        replyMode={vm.replyMode}
        replyText={vm.replyText}
        replySending={vm.replySending}
        onCancel={() => vm.setReplyModalOpen(false)}
        onReplyModeChange={vm.setReplyMode}
        onReplyTextChange={vm.setReplyText}
        onSubmit={() => void vm.handleSubmitReply()}
      />
    </div>
  );
}
