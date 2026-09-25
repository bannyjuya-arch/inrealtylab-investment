"use client";

// 2026-09-25: 보고서 "인쇄 / PDF" 버튼을 누르면 베타 사용 신청 정보를 먼저 받는다.
// - 제출 내용은 Supabase report_download_lead 테이블에 저장 (anon은 INSERT만 가능, 조회 불가)
// - 같은 브라우저에서 한 번 제출하면 이후에는 폼 없이 바로 인쇄 (localStorage)
// - 관리자 로그인 상태에서는 폼을 건너뛴다 (page.tsx에서 분기)

import { useEffect, useState, type FormEvent } from "react";
import { getSupabaseBrowserClient } from "../../lib/supabase-browser";

const SUBMITTED_KEY = "inrealtylab.reportLeadSubmitted";

const CUSTOMER_TYPES = [
  "민간 운영사",
  "시행·개발사",
  "건설사",
  "자산운용사·투자자",
  "공공기관·지자체",
  "토지소유자",
  "기타",
];

const REVIEW_TIMINGS = ["3개월 이내", "6개월 이내", "1년 이내", "미정"];

export function hasSubmittedReportLead(): boolean {
  try {
    return window.localStorage.getItem(SUBMITTED_KEY) === "1";
  } catch {
    return false;
  }
}

function markSubmitted() {
  try {
    window.localStorage.setItem(SUBMITTED_KEY, "1");
  } catch {
    // 저장이 막힌 브라우저면 다음번에 다시 묻는다.
  }
}

type Props = {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
  address: string;
  pnus: string[];
};

export default function DownloadGate({ open, onClose, onDone, address, pnus }: Props) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [organization, setOrganization] = useState("");
  const [customerType, setCustomerType] = useState("");
  const [reviewTiming, setReviewTiming] = useState("");
  const [phone, setPhone] = useState("");
  const [privacyAgreed, setPrivacyAgreed] = useState(false);
  const [marketingAgreed, setMarketingAgreed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const canSubmit =
    name.trim() && emailValid && organization.trim() && customerType && privacyAgreed && !submitting;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError("");

    const params = new URLSearchParams(window.location.search);
    const row = {
      name: name.trim(),
      email: email.trim().toLowerCase(),
      organization: organization.trim(),
      customer_type: customerType,
      review_timing: reviewTiming || null,
      phone: phone.trim() || null,
      privacy_agreed: privacyAgreed,
      marketing_agreed: marketingAgreed,
      site_address: address || null,
      pnus: pnus.length ? pnus : null,
      referrer: document.referrer || null,
      utm_source: params.get("utm_source"),
      utm_medium: params.get("utm_medium"),
      utm_campaign: params.get("utm_campaign"),
      page_url: window.location.href.slice(0, 1000),
    };

    try {
      const { error: insertError } = await getSupabaseBrowserClient()
        .from("report_download_lead")
        .insert(row);
      if (insertError) throw insertError;
      markSubmitted();
      setSubmitting(false);
      onDone();
    } catch {
      setSubmitting(false);
      setError("저장 중 문제가 생겼습니다. 잠시 후 다시 시도해 주세요.");
    }
  }

  return (
    <div className="lead-gate-backdrop no-print" role="presentation" onClick={onClose}>
      <div
        className="lead-gate"
        role="dialog"
        aria-modal="true"
        aria-labelledby="lead-gate-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="lead-gate-kicker">BETA · 보고서 PDF 받기</div>
        <h2 id="lead-gate-title">검토 보고서를 받으실 분의 정보를 알려주세요</h2>
        <p className="lead-gate-lead">
          인리얼티 플랫폼은 현재 베타 운영 중입니다. 정보를 남겨 주시면 PDF 출력과 함께
          베타 사용자로 등록되어, 정식 기능 공개와 상세 검토 안내를 먼저 받으실 수 있습니다.
        </p>

        <form onSubmit={handleSubmit}>
          <div className="lead-gate-grid">
            <label>
              <span>이름 *</span>
              <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required />
            </label>
            <label>
              <span>이메일 *</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
              />
            </label>
            <label>
              <span>소속(회사·기관명) *</span>
              <input
                value={organization}
                onChange={(e) => setOrganization(e.target.value)}
                autoComplete="organization"
                required
              />
            </label>
            <label>
              <span>고객 유형 *</span>
              <select value={customerType} onChange={(e) => setCustomerType(e.target.value)} required>
                <option value="">선택해 주세요</option>
                {CUSTOMER_TYPES.map((type) => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>
            </label>
            <label>
              <span>사업 검토 예정 시기</span>
              <select value={reviewTiming} onChange={(e) => setReviewTiming(e.target.value)}>
                <option value="">선택 안 함</option>
                {REVIEW_TIMINGS.map((timing) => (
                  <option key={timing} value={timing}>{timing}</option>
                ))}
              </select>
            </label>
            <label>
              <span>연락처</span>
              <input value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" />
            </label>
          </div>

          <div className="lead-gate-consent">
            <label className="lead-gate-check">
              <input type="checkbox" checked={privacyAgreed} onChange={(e) => setPrivacyAgreed(e.target.checked)} />
              <span><strong>[필수]</strong> 개인정보 수집·이용에 동의합니다.</span>
            </label>
            <p className="lead-gate-fine">
              수집 항목: 이름, 이메일, 소속, 고객 유형, 검토 시기·연락처(선택), 조회한 부지 정보 ·
              이용 목적: 보고서 제공, 베타 서비스 안내 및 상담 · 보유 기간: 수집일로부터 1년 또는 동의 철회 시까지.
              동의를 거부할 수 있으나, 이 경우 PDF 출력이 제한됩니다.
            </p>
            <label className="lead-gate-check">
              <input type="checkbox" checked={marketingAgreed} onChange={(e) => setMarketingAgreed(e.target.checked)} />
              <span>[선택] PPP 칼럼·세미나 등 인리얼티 소식을 이메일로 받겠습니다.</span>
            </label>
          </div>

          {error && <div className="lead-gate-error">{error}</div>}

          <div className="lead-gate-actions">
            <button type="button" className="report-btn" onClick={onClose}>취소</button>
            <button type="submit" className="report-btn primary" disabled={!canSubmit}>
              {submitting ? "저장 중..." : "등록하고 PDF 받기"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
