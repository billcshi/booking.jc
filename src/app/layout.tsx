import type { Metadata } from "next";
import { DM_Sans, Fraunces } from "next/font/google";
import "./globals.css";
import "./calendar-responsive.css";
import "./natural-calendar.css";
import "./admin-calendar.css";
import "./blackouts.css";
import "./group-key.css";
import "./occupancy.css";
import "./heat-legend.css";
import "./edit-request.css";
import "./date-range.css";
import "./home-settings.css";
import "./admin-panels.css";

const sans = DM_Sans({
  variable: "--font-sans",
  subsets: ["latin"],
});
const serif = Fraunces({
  variable: "--font-serif",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "booking.jc",
  description: "A private stay coordinator for friends.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="zh-CN"
      className={`${sans.variable} ${serif.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
