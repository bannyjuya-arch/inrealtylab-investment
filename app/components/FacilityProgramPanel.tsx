"use client";

// 2026-11-19: STEP 2 수요 기반 프로그램 도출 패널.
// /api/facility-program → Supabase derive_facility_program (특허 청구항 3, 7, 8).
// 결과를 sessionStorage["inrealtylab.facilityProgram"]에 남기고 "inrealtylab:facilityProgram" 이벤트를 보낸다.
// ProgramChoice는 이 값으로 1차 제안(시설 비율, 공공시설)을 만든다.

import { useCallback, useEffect, useRef, useState } from "react";

export const FACILITY_PROGRAM_KEY = "inrealtylab.facilityProgram";
export const FACILITY_PROGRAM_EVENT = "inrealtylab:facilityProgram";

type DemandTriple = { conservative: number | null; base: number | null; aggressive: number | null };
type ThemeScore = {
  theme_code: string;
  theme_name: string;
  score: number;
  indicator_score: number;
  feasible_share: number;
  demand_bonus: number;
  commercial_facilities: string[];
  public_facilities: string[];
};
export type FacilityProgramResult = {
  pnu: string;
  ucode: string | null;
  whitelist: Record<string, string>;
  demand_gfa: Record<string, DemandTriple>;
  demand_basis?: Record<string, { model?: string; capped?: boolean }>;
  regional_indicators: Record<string, number | null>;
  theme_scores: ThemeScore[];
  selected_theme: { code: string; name: string; score: number };
  program: {
    commercial: Array<{ facility_code: string; zoning: string; base_gfa: number | null; included: boolean }>;
    public: Array<{ facility_code: string; basis: string }>;
  };
  site_urgency: {
    urgency_grade: string;
    urgency_score: number;
    has_building: boolean;
    wavg_age_years: number | null;
    aging_ratio: number | null;
    basis: string;
  };
  errors: unknown[];
  patent_claims: number[];
};
type Check = { model: string; check_code: string; scope: string | null; verdict: string | null; metric: Record<string, unknown> | null; suggestion: Record<string, unknown> | null };
type ApiResponse = {
  ok: boolean;
  message?: string;
  zoneName?: string | null;
  result?: FacilityProgramResult;
  calibration?: { paramCount: number | null; unverifiedCount: number | null; latestRunAt: string | null; checks: Check[] };
};

const FACILITY_LABEL: Record<string, string> = {
  C01_OFFICE: "오피스",
  C02_RETAIL: "리테일(근생)",
  C03_HOSPITALITY: "숙박",
  C04_LIVING: "임대주택(1인가구)",
  C05_HEALTHCARE: "의원",
  C06_EDUCATION: "교육",
  C07_CULTURE_ENTERTAINMENT: "문화, 엔터",
  C08_RND_LAB: "R&D, 랩",
  C09_LOGISTICS: "물류",
  C10_DIGITAL_INFRA: "디지털 인프라",
  C11_SILVER_STAY: "임대주택(실버)",
};
const INDICATOR_LABEL: Record<string, string> = {
  single_household_ratio: "1인가구 비율",
  senior_ratio: "고령인구 비율",
  child_ratio: "유소년 비율",
  worker_ratio: "종사자/인구",
  resident_density: "인구밀도",
  rnd_share: "R&D 종사자 비중",
  foreign_visitor_index: "외국인 방문",
};
const MODEL_LABEL: Record<string, string> = { RETAIL: "상가", LODGING: "숙박", OFFICE: "오피스" };
const VERDICT_LABEL: Record<string, string> = {
  GOOD: "양호",
  FAIR: "보통",
  WEAK: "약함",
  CONSISTENT: "실적과 부합",
  ADJUST: "보정 필요",
};

const fmt = (value: number | null | undefined) =>
  value === null || value === undefined ? "-" : Math.round(value).toLocaleString("ko-KR");

function readInputs() {
  try {
    const step1 = JSON.parse(sessionStorage.getItem("inrealtylab.step1") ?? "null") as
      | { pnus?: string[]; center?: { lat: number; lon: number } | null }
      | null;
    const snap = JSON.parse(sessionStorage.getItem("inrealtylab.part1Snapshot") ?? "null") as
      | { siteAreaSqm?: number; statutoryFarMaxPct?: number | null; primaryZone?: string | null }
      | null;
    const pnu = step1?.pnus?.[0];
    const center = step1?.center;
    if (!pnu || !center) return null;
    const area = Number(snap?.siteAreaSqm) || 0;
    const far = Number(snap?.statutoryFarMaxPct) || 0;
    return {
      pnu,
      lat: center.lat,
      lon: center.lon,
      zoneName: snap?.primaryZone ?? null,
      maxGfa: area > 0 && far > 0 ? area * (far / 100) : 0,
    };
  } catch {
    return null;
  }
}

export default function FacilityProgramPanel() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const lastKey = useRef("");

  const load = useCallback(() => {
    const input = readInputs();
    if (!input || !input.zoneName || input.maxGfa <= 0) return;
    const key = `${input.pnu}|${input.zoneName}|${Math.round(input.maxGfa)}`;
    if (key === lastKey.current) return;
    lastKey.current = key;
    setLoading(true);
    fetch(
      `/api/facility-program?pnu=${encodeURIComponent(input.pnu)}&lat=${input.lat}&lon=${input.lon}` +
        `&zoneName=${encodeURIComponent(input.zoneName)}&maxGfa=${Math.round(input.maxGfa)}`,
      { cache: "no-store" }
    )
      .then((response) => response.json())
      .then((json: ApiResponse) => {
        setData(json);
        if (json.ok && json.result) {
          try {
            sessionStorage.setItem(FACILITY_PROGRAM_KEY, JSON.stringify({ key, ...json.result }));
          } catch {
            // 저장 실패 시 ProgramChoice는 기존 우선순위 제안을 쓴다.
          }
          window.dispatchEvent(new CustomEvent(FACILITY_PROGRAM_EVENT, { detail: json.result }));
        }
      })
      .catch(() => setData({ ok: false, message: "수요 기반 시설 도출 결과 조회 실패" }))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
    // 용도지역, 상한이 확정되면 SiteProgram이 allowedUse 이벤트를 보낸다. 스냅샷 저장이 뒤따르므로 한 박자 늦게 읽는다.
    const onAllowed = () => window.setTimeout(load, 300);
    window.addEventListener("inrealtylab:allowedUse", onAllowed);
    return () => window.removeEventListener("inrealtylab:allowedUse", onAllowed);
  }, [load]);

  const result = data?.result;

  return (
    <section className="control-section">
      <div className="control-section-title">
        <span>STEP 2-3 수요 산출값</span>
        <strong>수요 기반 시설 도출</strong>
      </div>

      {!data && !loading && <div className="regime-note">용도지역 및 연면적 상한 확인 후 시설별 수요 산정</div>}
      {loading && <div className="regime-note">허용 시설별 수요 및 지역 테마 산정 중</div>}
      {data && !data.ok && <div className="regime-note">{data.message}</div>}

      {result && (
        <>
          <div className="fp-summary">
            <div>
              <span>추천 테마</span>
              <strong>{result.selected_theme?.name ?? "-"}</strong>
              <small>적합도 {result.selected_theme?.score ?? "-"}점</small>
            </div>
            <div>
              <span>개발 시급성</span>
              <strong>{result.site_urgency?.urgency_grade ?? "-"}</strong>
              <small>
                {result.site_urgency?.urgency_score ?? "-"}점
                {result.site_urgency?.wavg_age_years ? `, 평균 경과 ${Math.round(result.site_urgency.wavg_age_years)}년` : ""}
              </small>
            </div>
            <div>
              <span>기준 용도지역</span>
              <strong>{data?.zoneName ?? "-"}</strong>
              <small>허용 시설만 수요 계산</small>
            </div>
          </div>

          <table className="fp-table">
            <thead>
              <tr>
                <th>수익시설</th>
                <th>용도지역</th>
                <th>보수</th>
                <th>중간</th>
                <th>공격</th>
              </tr>
            </thead>
            <tbody>
              {Object.keys(FACILITY_LABEL)
                .filter((code) => result.whitelist?.[code] !== "PROHIBITED" || result.demand_gfa?.[code])
                .map((code) => {
                  const demand = result.demand_gfa?.[code];
                  const zoning = result.whitelist?.[code] ?? "UNKNOWN";
                  return (
                    <tr key={code}>
                      <td>{FACILITY_LABEL[code]}</td>
                      <td>{zoning === "ALLOWED" ? "허용" : zoning === "CONDITIONAL" ? "조건부" : zoning === "PROHIBITED" ? "불가" : "확인 필요"}</td>
                      <td>{demand ? `${fmt(demand.conservative)}㎡` : "모형 없음"}</td>
                      <td>{demand ? `${fmt(demand.base)}㎡` : "-"}</td>
                      <td>
                        {demand ? `${fmt(demand.aggressive)}㎡` : "-"}
                        {result.demand_basis?.[code]?.capped ? " (상한)" : ""}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>

          <div className="fp-themes">
            {result.theme_scores?.map((theme) => (
              <div key={theme.theme_code} className={theme.theme_code === result.selected_theme?.code ? "selected" : ""}>
                <strong>{theme.theme_name}</strong>
                <span>{theme.score}점</span>
                <small>
                  지표 {theme.indicator_score}, 실현가능 {Math.round((theme.feasible_share ?? 0) * 100)}%, 수요 가점 {theme.demand_bonus}
                </small>
              </div>
            ))}
          </div>

          <p className="choice-hint">
            반경 1.5km 지역 지표(서울 평균 = 1.0):{" "}
            {Object.entries(result.regional_indicators ?? {})
              .map(([key, value]) => `${INDICATOR_LABEL[key] ?? key} ${value ?? "-"}`)
              .join(", ")}
          </p>

          {data?.calibration && (
            <div className="fp-calibration">
              <strong>모형 검증 상태</strong>
              <span>
                가정값 {data.calibration.paramCount ?? "-"}개 중 미검증 {data.calibration.unverifiedCount ?? "-"}개
                {data.calibration.latestRunAt ? `, 최근 검증 ${data.calibration.latestRunAt.slice(0, 10)}` : ", 검증 미실행"}
              </span>
              {data.calibration.checks.length > 0 && (
                <ul>
                  {data.calibration.checks.map((check, index) => (
                    <li key={index}>
                      {MODEL_LABEL[check.model] ?? check.model} {check.scope ?? ""}{" "}
                      {check.check_code === "REGRESSION_FIT"
                        ? `회귀 설명력 R² ${String(check.metric?.r2 ?? "-")}`
                        : `포착률 보정 제안 ${String(check.suggestion?.suggested_base_capture_pct ?? "-")}% (현재 ${String(check.metric?.current_base_capture_pct ?? "-")}%)`}{" "}
                      : {VERDICT_LABEL[check.verdict ?? ""] ?? check.verdict}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <p className="choice-hint">
            특허 10-2026-0144458 청구항 {result.patent_claims?.join(", ")} 적용. 수요 가정값은 전부 잠정값이며 검증 결과에 따라 보정 예정
          </p>
        </>
      )}
    </section>
  );
}
