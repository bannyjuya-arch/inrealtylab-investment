import { NextResponse } from "next/server";
import { supabasePublicConfig, supabasePublicHeaders } from "../lib/supabase-public";

// 2026-09-25: 보고서 PDF 출력 전 베타 사용 신청 저장 + 이메일 알림
//
// 1) report_download_lead 테이블에 저장 (RLS: anon은 INSERT만 가능)
// 2) RESEND_API_KEY가 설정돼 있으면 새 신청 알림 메일 발송
//    - 메일 발송이 실패해도 신청 저장과 PDF 출력은 막지 않는다.
//
// 필요한 환경변수 (Vercel > Settings > Environment Variables)
//   RESEND_API_KEY    : Resend에서 발급한 API 키 (필수, 없으면 메일만 건너뜀)
//   LEAD_NOTIFY_TO    : 알림 받을 주소, 쉼표로 여러 개 (기본 ceo@inrealtylab.com)
//   LEAD_NOTIFY_FROM  : 보내는 주소 (기본 "INRealtyLab <onboarding@resend.dev>")
//                       inrealtylab.com 도메인을 Resend에서 인증한 뒤 noreply@inrealtylab.com 등으로 변경

export const dynamic = "force-dynamic";

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

async function sendNotification(row: Record<string, unknown>) {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) return "skipped";

  const to = (process.env.LEAD_NOTIFY_TO?.trim() || "ceo@inrealtylab.com")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const from = process.env.LEAD_NOTIFY_FROM?.trim() || "INRealtyLab <onboarding@resend.dev>";

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

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to,
      reply_to: typeof row.email === "string" ? row.email : undefined,
      subject: `[베타 신청] ${row.organization ?? ""} · ${row.name ?? ""} (${row.customer_type ?? ""})`,
      html,
    }),
  });
  if (!response.ok) {
    console.error("[report-lead] 알림 메일 실패", response.status, await response.text().catch(() => ""));
    return "failed";
  }
  return "sent";
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
    return NextResponse.json({ ok: false, error: "저장 중 문제가 생겼습니다." }, { status: 502 });
  }

  let notify = "skipped";
  try {
    notify = await sendNotification(row);
  } catch (error) {
    console.error("[report-lead] 알림 메일 예외", error);
    notify = "failed";
  }

  return NextResponse.json({ ok: true, notify });
}
