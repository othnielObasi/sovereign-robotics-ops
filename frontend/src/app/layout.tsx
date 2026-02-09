import React from "react";

export const metadata = {
  title: "Sovereign Robotics Ops",
  description: "Governance + Observability for Simulated Robotics",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial", margin: 0 }}>
        <div style={{ padding: 16, borderBottom: "1px solid #eee" }}>
          <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
            <div style={{ fontWeight: 700 }}>Sovereign Robotics Ops</div>
            <a href="/" style={{ textDecoration: "none" }}>Dashboard</a>
            <a href="/policies" style={{ textDecoration: "none" }}>Policies</a>
          </div>
        </div>
        <div style={{ padding: 16 }}>{children}</div>
      </body>
    </html>
  );
}
