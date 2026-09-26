import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 보고서 PDF 메일(/api/report-lead)이 Vercel에서 쓰는 크롬 압축 바이너리.
  // 동적 import라 파일 추적에서 빠질 수 있어 명시적으로 함수 번들에 넣는다.
  outputFileTracingIncludes: {
    "/api/report-lead": ["./node_modules/@sparticuz/chromium/bin/**/*"],
  },
};

export default nextConfig;
