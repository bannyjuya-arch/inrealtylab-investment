import { NextResponse } from "next/server";
import { supabasePublicConfig, supabasePublicHeaders } from "../lib/supabase-public";
import { renderReportPdf } from "../../../lib/report-pdf";

// 2026-09-25: 보고서 PDF 출력 전 베타 사용 신청 저장 + 이메일 알림
// 2026-09-26: 방문자에게 PDF를 바로 내려주지 않고, 신청한 이메일로 PDF를 보낸다.
//
// 1) 방문자 화면에서 굳힌 보고서 HTML(report-snapshot.ts)을 헤드리스 크롬으로 PDF 생성
// 2) report_download_lead 테이블에 저장 (RLS: anon은 INSERT만 가능)
// 3) 신청자 이메일로 PDF 첨부 메일 발송 — 실패하면 오류로 돌려 다시 시도하게 한다
// 4) 관리자에게 새 신청 알림 메일 발송 — 실패해도 신청은 막지 않는다
//
// 필요한 환경변수 (Vercel > Settings > Environment Variables)
//   RESEND_API_KEY    : Resend에서 발급한 API 키 (필수, 없으면 보고서 메일을 보낼 수 없다)
//   LEAD_NOTIFY_TO    : 알림 받을 주소, 쉼표로 여러 개 (기본 ceo@inrealtylab.com)
//   LEAD_NOTIFY_FROM  : 보내는 주소 (기본 "INRealtyLab <onboarding@resend.dev>")
//                       onboarding@resend.dev는 Resend 계정 주인에게만 보낼 수 있으므로,
//                       방문자에게 보내려면 inrealtylab.com 도메인을 Resend에서 인증한 뒤
//                       "INRealtyLab <noreply@inrealtylab.com>" 등으로 바꿔야 한다.

export const dynamic = "force-dynamic";
// 크롬 기동 + PDF 생성에 수 초가 걸린다.
export const maxDuration = 60;

// Vercel 요청 본문 한도(4.5MB) 안쪽. 지도 이미지가 대부분을 차지한다.
const MAX_REPORT_HTML = 4_000_000;

// 임의 주소로 PDF 메일을 보내는 창구가 되지 않도록 IP당 발송 횟수를 제한한다.
// 서버리스 인스턴스마다 따로 세는 최소한의 방어다.
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT = 5;
const recentByIp = new Map<string, number[]>();

function rateLimited(ip: string) {
  const now = Date.now();
  const recent = (recentByIp.get(ip) ?? []).filter((time) => now - time < RATE_WINDOW_MS);
  if (recent.length >= RATE_LIMIT) {
    recentByIp.set(ip, recent);
    return true;
  }
  recent.push(now);
  recentByIp.set(ip, recent);
  return false;
}

type LeadInput = {
  name?: unknown;
  email?: unknown;
  organization?: unknown;
  customer_type?: unknown;
  review_timing?: unknown;
  phone?: unknown;
  privacy_agreed?: unknown;
  marketing_agreed?: unknown;
  site_address?: unknown;
  pnus?: unknown;
  referrer?: unknown;
  utm_source?: unknown;
  utm_medium?: unknown;
  utm_campaign?: unknown;
  page_url?: unknown;
  report_html?: unknown;
};

function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function mailFrom() {
  return process.env.LEAD_NOTIFY_FROM?.trim() || "INRealtyLab <onboarding@resend.dev>";
}

// 실패하면 Resend가 돌려준 사유를 함께 돌려준다. 베타 기간에는 화면에 그대로 보여 원인을 바로 찾는다.
async function sendResend(apiKey: string, payload: Record<string, unknown>): Promise<{ ok: boolean; detail?: string }> {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    console.error("[report-lead] 메일 발송 실패", response.status, body);
    let message = body;
    try {
      message = (JSON.parse(body) as { message?: string }).message || body;
    } catch {
      // JSON이 아니면 본문 그대로
    }
    return { ok: false, detail: `Resend ${response.status}: ${message}`.slice(0, 300) };
  }
  return { ok: true };
}

function reportFileName(address: string | null) {
  const safe = (address ?? "").replace(/[\\/:*?"<>|\s]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60);
  return `인리얼티_검토보고서${safe ? `_${safe}` : ""}.pdf`;
}

async function sendReport(apiKey: string, row: Record<string, unknown>, pdf: Buffer) {
  const name = escapeHtml(String(row.name ?? ""));
  const address = typeof row.site_address === "string" ? row.site_address : null;
  const html = `
    <div style="font-family:Pretendard,Apple SD Gothic Neo,Malgun Gothic,sans-serif;color:#1F2A26;line-height:1.7">
      <p style="font-size:12px;letter-spacing:.06em;color:#3E7D65;font-weight:700;margin:0">INREALTYLAB · BETA</p>
      <h2 style="color:#14453A;margin:6px 0 16px">요청하신 검토 보고서를 보내드립니다</h2>
      <p style="margin:0 0 12px">${name}님, 인리얼티 플랫폼 베타를 이용해 주셔서 감사합니다.</p>
      <p style="margin:0 0 12px">${
        address ? `<strong>${escapeHtml(address)}</strong> 부지의 ` : ""
      }사업추진 약식검토 보고서를 PDF로 첨부했습니다.</p>
      <p style="margin:0 0 12px">베타 사용자로 등록되어 정식 기능 공개와 상세 검토 안내를 먼저 받아보실 수 있습니다.
      보고서 내용이나 상세 검토에 관해 궁금하신 점은 이 메일에 회신해 주세요.</p>
      <p style="font-size:12px;color:#5F6260;margin-top:18px">본 보고서는 공개 데이터와 기본 가정에 따른 약식검토로, 실제 사업성과 다를 수 있습니다.</p>
    </div>`;

  const notifyTo = process.env.LEAD_NOTIFY_TO?.trim().split(",")[0]?.trim() || "ceo@inrealtylab.com";
  return sendResend(apiKey, {
    from: mailFrom(),
    to: [row.email],
    reply_to: notifyTo,
    subject: `[인리얼티] ${address ? `${address} ` : ""}검토 보고서`,
    html,
    attachments: [{ filename: reportFileName(address), content: pdf.toString("base64") }],
  });
}

async function sendNotification(apiKey: string, row: Record<string, unknown>) {
  const to = (process.env.LEAD_NOTIFY_TO?.trim() || "ceo@inrealtylab.com")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  const rows: [string, unknown][] = [
    ["이름", row.name],
    ["이메일", row.email],
    ["소속", row.organization],
    ["고객 유형", row.customer_type],
    ["검토 예정 시기", row.review_timing],
    ["연락처", row.phone],
    ["소식 수신 동의", row.marketing_agreed ? "동의" : "미동의"],
    ["조회 부지", row.site_address],
    ["PNU", Array.isArray(row.pnus) ? row.pnus.join(", ") : null],
    ["유입 경로", row.referrer],
    ["UTM", [row.utm_source, row.utm_medium, row.utm_campaign].filter(Boolean).join(" / ")],
  ];

  const html = `
    <div style="font-family:Pretendard,Apple SD Gothic Neo,Malgun Gothic,sans-serif;color:#1F2A26">
      <p style="font-size:12px;letter-spacing:.06em;color:#3E7D65;font-weight:700;margin:0">INREALTYLAB · 베타 사용 신청</p>
      <h2 style="color:#14453A;margin:6px 0 16px">새 보고서 PDF 신청이 들어왔습니다</h2>
      <p style="font-size:13px;color:#5F6260;margin:0 0 12px">신청자 이메일로 보고서 PDF를 보냈습니다.</p>
      <table style="border-collapse:collapse;font-size:14px">
        ${rows
          .map(([label, value]) =>
            `<tr><td style="padding:6px 14px 6px 0;color:#5F6260;white-space:nowrap">${label}</td><td style="padding:6px 0">${
              value ? escapeHtml(String(value)) : "-"
            }</td></tr>`,
          )
          .join("")}
      </table>
      <p style="font-size:12px;color:#5F6260;margin-top:18px">Supabase Table Editor → report_download_lead 에서 상태(status)를 관리하세요.</p>
    </div>`;

  const { ok } = await sendResend(apiKey, {
    from: mailFrom(),
    to,
    reply_to: typeof row.email === "string" ? row.email : undefined,
    subject: `[베타 신청] ${row.organization ?? ""} · ${row.name ?? ""} (${row.customer_type ?? ""})`,
    html,
  });
  return ok ? "sent" : "failed";
}

export async function POST(request: Request) {
  let body: LeadInput;
  try {
    body = (await request.json()) as LeadInput;
  } catch {
    return NextResponse.json({ ok: false, error: "잘못된 요청입니다." }, { status: 400 });
  }

  const name = text(body.name, 100);
  const email = text(body.email, 254)?.toLowerCase() ?? null;
  const organization = text(body.organization, 200);
  const customerType = text(body.customer_type, 50);

  if (!name || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !organization || !customerType) {
    return NextResponse.json({ ok: false, error: "필수 항목을 확인해 주세요." }, { status: 400 });
  }
  if (body.privacy_agreed !== true) {
    return NextResponse.json({ ok: false, error: "개인정보 수집·이용 동의가 필요합니다." }, { status: 400 });
  }

  const reportHtml = typeof body.report_html === "string" ? body.report_html : "";
  if (!reportHtml.includes("report-shell") || reportHtml.length > MAX_REPORT_HTML) {
    return NextResponse.json({ ok: false, error: "보고서 내용을 읽지 못했습니다. 새로고침 후 다시 시도해 주세요." }, { status: 400 });
  }

  // 붙여넣을 때 따옴표가 같이 들어가는 경우가 있어 벗겨낸다.
  const apiKey = process.env.RESEND_API_KEY?.trim().replace(/^["']+|["']+$/g, "");
  if (!apiKey) {
    console.error("[report-lead] RESEND_API_KEY 미설정 — 보고서 메일을 보낼 수 없습니다.");
    return NextResponse.json(
      { ok: false, reason: "mail_not_configured", error: "지금은 보고서 메일을 보낼 수 없습니다. 잠시 후 다시 시도해 주세요." },
      { status: 503 },
    );
  }

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (rateLimited(ip)) {
    return NextResponse.json({ ok: false, error: "요청이 많습니다. 10분 뒤 다시 시도해 주세요." }, { status: 429 });
  }

  let pdf: Buffer;
  try {
    pdf = await renderReportPdf(reportHtml);
  } catch (error) {
    console.error("[report-lead] PDF 생성 실패", error);
    return NextResponse.json(
      {
        ok: false,
        reason: "pdf_failed",
        detail: String(error instanceof Error ? error.message : error).slice(0, 300),
        error: "보고서 PDF를 만들지 못했습니다. 잠시 후 다시 시도해 주세요.",
      },
      { status: 502 },
    );
  }

  const pnus = Array.isArray(body.pnus)
    ? body.pnus.filter((item): item is string => typeof item === "string").slice(0, 50).map((item) => item.slice(0, 30))
    : [];

  const row = {
    name,
    email,
    organization,
    customer_type: customerType,
    review_timing: text(body.review_timing, 50),
    phone: text(body.phone, 50),
    privacy_agreed: true,
    marketing_agreed: body.marketing_agreed === true,
    site_address: text(body.site_address, 300),
    pnus: pnus.length ? pnus : null,
    referrer: text(body.referrer, 1000),
    utm_source: text(body.utm_source, 200),
    utm_medium: text(body.utm_medium, 200),
    utm_campaign: text(body.utm_campaign, 200),
    page_url: text(body.page_url, 1000),
  };

  const { url } = supabasePublicConfig();
  const insert = await fetch(`${url}/rest/v1/report_download_lead`, {
    method: "POST",
    headers: supabasePublicHeaders({ "Content-Type": "application/json", Prefer: "return=minimal" }),
    body: JSON.stringify(row),
  });
  if (!insert.ok) {
    console.error("[report-lead] 저장 실패", insert.status, await insert.text().catch(() => ""));
    return NextResponse.json({ ok: false, reason: "save_failed", error: "저장 중 문제가 생겼습니다." }, { status: 502 });
  }

  let delivery: { ok: boolean; detail?: string } = { ok: false };
  try {
    delivery = await sendReport(apiKey, row, pdf);
  } catch (error) {
    console.error("[report-lead] 보고서 메일 예외", error);
    delivery = { ok: false, detail: String(error instanceof Error ? error.message : error).slice(0, 300) };
  }
  if (!delivery.ok) {
    return NextResponse.json(
      {
        ok: false,
        reason: "mail_rejected",
        detail: delivery.detail,
        error: "보고서 메일을 보내지 못했습니다. 이메일 주소를 확인하고 다시 시도해 주세요.",
      },
      { status: 502 },
    );
  }

  let notify = "failed";
  try {
    notify = await sendNotification(apiKey, row);
  } catch (error) {
    console.error("[report-lead] 알림 메일 예외", error);
  }

  return NextResponse.json({ ok: true, notify });
}
