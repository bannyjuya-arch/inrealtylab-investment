import { NextRequest } from "next/server";
import puppeteer from "puppeteer";
import { db } from "@/lib/db";

function formatWon(value: number) {
  return `${Math.round(value).toLocaleString("ko-KR")}원`;
}

function formatPercent(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ scenarioId: string }> }
) {
  try {
    const { scenarioId } = await context.params;

    const scenario = await db.scenario.findUnique({
      where: { id: scenarioId },
      include: {
        project: true,
        result: true,
      },
    });

    if (!scenario || !scenario.result) {
      return new Response("시나리오를 찾을 수 없습니다.", { status: 404 });
    }

    const summary = scenario.result.summaryJson as {
      projectIRR?: number;
      avgDSCR?: number;
      breakEvenYear?: number;
      monthlyRent?: number;
      totalCost?: number;
    };

    const warnings = (scenario.result.warningsJson ?? []) as string[];
    const siteJson = scenario.siteJson as any;
    const inputJson = scenario.inputJson as any;

    const html = `
      <!doctype html>
      <html lang="ko">
      <head>
        <meta charset="utf-8" />
        <title>사업 타당성 리포트</title>
        <style>
          body { font-family: Arial, sans-serif; color: #111827; margin: 0; padding: 40px; line-height: 1.5; }
          .header { border-bottom: 2px solid #101720; padding-bottom: 12px; margin-bottom: 24px; }
          .title { font-size: 28px; font-weight: 800; margin: 0 0 6px; }
          .subtitle { color: #6b7280; font-size: 14px; }
          .section { margin-bottom: 24px; }
          .section h2 { font-size: 18px; margin: 0 0 12px; border-left: 4px solid #d4af37; padding-left: 10px; }
          .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
          .card { border: 1px solid #d1d5db; border-radius: 10px; padding: 14px; background: #f9fafb; }
          .label { font-size: 12px; color: #6b7280; margin-bottom: 6px; }
          .value { font-size: 22px; font-weight: 800; }
          table { width: 100%; border-collapse: collapse; }
          th, td { border: 1px solid #d1d5db; padding: 10px; text-align: left; font-size: 14px; }
          th { background: #f3f4f6; }
          .warning { background: #fef2f2; border: 1px solid #fecaca; color: #991b1b; border-radius: 10px; padding: 12px; }
          .ok { background: #f0fdf4; border: 1px solid #bbf7d0; color: #166534; border-radius: 10px; padding: 12px; }
          .footer { margin-top: 30px; padding-top: 12px; border-top: 1px solid #d1d5db; font-size: 12px; color: #6b7280; }
          .watermark {
          position: fixed;
          top: 45%;
          left: 50%;
          transform: translate(-50%, -50%) rotate(-30deg);
          font-size: 120px;
          font-weight: 900;
          color: rgba(180, 180, 180, 0.12);
          z-index: 0;
          pointer-events: none;
          user-select: none;
          }
          </style>

      </head>
      <body>
        <div class="header">
          <div class="watermark">SAMPLE</div>
          <div class="title">사업 타당성 요약 리포트</div>
          <div class="subtitle">InRealtyLab BOT / PF Simulator</div>
        </div>

        <div class="section">
          <h2>1. 프로젝트 개요</h2>
          <table>
            <tr>
              <th style="width:22%">프로젝트명</th>
              <td>${scenario.project.name}</td>
              <th style="width:22%">시나리오명</th>
              <td>${scenario.name}</td>
            </tr>
            <tr>
              <th>부지명</th>
              <td>${scenario.project.siteName ?? "-"}</td>
              <th>주소</th>
              <td>${scenario.project.address ?? "-"}</td>
            </tr>
            <tr>
              <th>시설 유형</th>
              <td>${inputJson?.preset ?? "-"}</td>
              <th>운영 기간</th>
              <td>${inputJson?.operationYears ?? "-"}년</td>
            </tr>
          </table>
        </div>

        <div class="section">
          <h2>2. 핵심 재무지표</h2>
          <div class="grid">
            <div class="card">
              <div class="label">Project IRR</div>
              <div class="value">${summary.projectIRR != null ? formatPercent(summary.projectIRR) : "-"}</div>
            </div>
            <div class="card">
              <div class="label">Avg. DSCR</div>
              <div class="value">${summary.avgDSCR != null ? summary.avgDSCR.toFixed(2) : "-"}</div>
            </div>
            <div class="card">
              <div class="label">Break-even Year</div>
              <div class="value">${summary.breakEvenYear != null ? `${summary.breakEvenYear}년` : "-"}</div>
            </div>
            <div class="card">
              <div class="label">총사업비</div>
              <div class="value">${summary.totalCost != null ? formatWon(summary.totalCost) : "-"}</div>
            </div>
            <div class="card">
              <div class="label">적정 월 임대료</div>
              <div class="value">${summary.monthlyRent != null ? formatWon(summary.monthlyRent) : "-"}</div>
            </div>
            <div class="card">
              <div class="label">소유자 유형</div>
              <div class="value">${siteJson?.eligibility?.site?.ownerType ?? "-"}</div>
            </div>
          </div>
        </div>

        <div class="section">
          <h2>3. PPP 적격성 및 전략</h2>
          <table>
            <tr>
              <th style="width:22%">PPP 적격성</th>
              <td>${siteJson?.eligibility?.site?.pppEligible ? "적격" : "검토 필요"}</td>
            </tr>
            <tr>
              <th>전략 문구</th>
              <td>${siteJson?.eligibility?.strategyText ?? "-"}</td>
            </tr>
          </table>
        </div>

        <div class="section">
          <h2>4. 금융 안정성 판단</h2>
          ${
            warnings.length > 0
              ? `<div class="warning">${warnings.join("<br />")}</div>`
              : `<div class="ok">현재 기준 경고 없음</div>`
          }
        </div>

        <div class="footer">
          출력일: ${new Date().toLocaleDateString("ko-KR")}
        </div>
      </body>
      </html>
    `;

    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });

    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: {
        top: "20px",
        right: "20px",
        bottom: "20px",
        left: "20px",
      },
    });

    await browser.close();

    return new Response(Buffer.from(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="scenario-${scenarioId}.pdf"`,
      },
    });
  } catch (error) {
    console.error("PDF generation error:", error);
    return new Response(
      error instanceof Error ? `PDF 생성 실패: ${error.message}` : "PDF 생성 실패",
      { status: 500 }
    );
  }
}