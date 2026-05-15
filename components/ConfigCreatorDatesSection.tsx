"use client";

import { Table, Input, Divider } from "antd";

interface Props {
  accounts: string[];
  dateMap: Record<string, string>;
  globalDate: string | null;
  onChange: (dateMap: Record<string, string>, globalDate: string | null) => void;
}

export default function ConfigCreatorDatesSection({
  accounts,
  dateMap,
  globalDate,
  onChange,
}: Props) {
  const columns = [
    { title: "账号名称", dataIndex: "name", key: "name", width: 200, align: "center" as const },
    {
      title: "导出开始日期",
      dataIndex: "date",
      key: "date",
      width: 200,
      align: "center" as const,
      render: (_: any, record: any) => (
        <Input
          style={{ textAlign: "center" }}
          value={record.date || ""}
          placeholder='如 "3.1" 表示当年3月1日'
          onChange={(e) => {
            const next = { ...dateMap };
            if (e.target.value.trim()) {
              next[record.name] = e.target.value.trim();
            } else {
              delete next[record.name];
            }
            onChange(next, globalDate);
          }}
        />
      ),
    },
  ];

  return (
    <div>
      <Divider titlePlacement="left" plain style={{ marginTop: 0 }}>
        导出日期
      </Divider>

      <div style={{ marginBottom: 12 }}>
        <label style={{ marginRight: 8 }}>全局默认开始日期：</label>
        <Input
          style={{ width: 200 }}
          value={globalDate || ""}
          placeholder='如 "3.1"'
          onChange={(e) => onChange(dateMap, e.target.value.trim() || null)}
          allowClear
        />
      </div>

      <Table
        columns={columns}
        dataSource={accounts.map((name) => ({
          name,
          date: dateMap[name] || "",
          key: name,
        }))}
        pagination={false}
        size="small"
        locale={{ emptyText: "暂无账号" }}
        styles={{
          header: { cell: { textAlign: "center" } },
          body: { cell: { textAlign: "center" } },
        }}
      />
    </div>
  );
}
