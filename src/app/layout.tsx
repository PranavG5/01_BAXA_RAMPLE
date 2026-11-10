import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Rample Video Studio",
  description: "Turn a one-line idea into a short video ad filmed in your own shop.",
  icons: { icon: "/icon.svg" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
