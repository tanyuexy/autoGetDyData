"use client";

import type { ReactNode } from "react";
import { Typography } from "antd";
import { sectionStyle } from "@/lib/pageStyles";

export interface SettingSectionProps {
  title: string;
  description?: string;
  extra?: ReactNode;
  children: ReactNode;
}

export default function SettingSection(props: SettingSectionProps) {
  return (
    <section style={sectionStyle}>
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 12,
          marginBottom: 14,
        }}
      >
        <div>
          <Typography.Text strong style={{ fontSize: 15 }}>
            {props.title}
          </Typography.Text>
          {props.description ? (
            <div style={{ marginTop: 4 }}>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {props.description}
              </Typography.Text>
            </div>
          ) : null}
        </div>
        {props.extra}
      </div>
      {props.children}
    </section>
  );
}
