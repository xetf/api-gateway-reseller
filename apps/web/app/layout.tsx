import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "API Gateway",
  description: "API key, wallet, usage, and billing dashboard.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
