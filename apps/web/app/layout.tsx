import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Entangle — quantum network control plane",
  description:
    "Air-traffic control for a network where every connection is perishable, can't be copied, and vanishes the instant it's used. (Simulated quantum layer; the orchestration is the real artifact.)",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#F7F8FA",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // No next-themes, no dark class — light theme only.
  return (
    <html lang="en">
      <body className="min-h-screen bg-background font-sans text-foreground antialiased">
        {children}
      </body>
    </html>
  );
}
