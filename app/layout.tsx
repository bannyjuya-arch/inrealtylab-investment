import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import MapPrintBridge from "./components/MapPrintBridge";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "INRealtyLab | Site Analyzer",
  description: "지도에서 공공부동산 필지를 선택하고 PNU와 대지면적을 분석하는 INRealtyLab 베타 서비스",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ko"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <MapPrintBridge />
        {children}
      </body>
    </html>
  );
}
