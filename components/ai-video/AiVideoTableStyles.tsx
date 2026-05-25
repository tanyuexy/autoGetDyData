export function AiVideoTableStyles() {
  return (
    <style jsx global>{`
      .ai-video-clips-table .ant-table-thead > tr > th,
      .ai-video-clips-table .ant-table-tbody > tr > td,
      .ai-video-films-table .ant-table-thead > tr > th,
      .ai-video-films-table .ant-table-tbody > tr > td {
        text-align: center;
      }
      .ai-video-clips-table .ant-table-selection-column {
        text-align: center;
      }
      .ai-video-films-table .ant-table-cell {
        vertical-align: middle;
      }
    `}</style>
  );
}
