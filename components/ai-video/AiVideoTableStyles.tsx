export function AiVideoTableStyles() {
  return (
    <style jsx global>{`
      .ai-video-table-wrap {
        width: 100%;
        min-width: 0;
      }

      .ai-video-table-wrap .ant-table-wrapper {
        padding-inline-end: 0;
      }

      .ai-video-table-wrap .ant-table-content {
        overflow-x: auto !important;
      }

      @media (max-width: 1679px) {
        .ai-video-table-wrap .ant-table-content {
          scrollbar-gutter: stable both-edges;
        }
      }

      .ai-video-clips-table .ant-table-thead > tr > th,
      .ai-video-clips-table .ant-table-tbody > tr > td,
      .ai-video-films-table .ant-table-thead > tr > th,
      .ai-video-films-table .ant-table-tbody > tr > td {
        text-align: center;
      }
      .ai-video-clips-table .ant-table-selection-column {
        text-align: center;
      }
      .ai-video-clips-table .ai-video-clip-actions .ant-btn-sm {
        width: 24px;
        height: 24px;
        padding: 0;
      }
      .ai-video-clips-table .ai-video-clip-actions .ant-btn-sm .ant-btn-icon {
        font-size: 12px;
      }
      .ai-video-films-table .ant-table-cell {
        vertical-align: middle;
      }
      .ai-video-films-table .ant-table-selection-column {
        text-align: center;
      }
      .ai-video-list-tabs--films .ant-tabs-nav {
        margin-bottom: 8px;
      }
    `}</style>
  );
}
