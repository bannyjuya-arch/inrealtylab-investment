"use client";

// STEP 2 · 프로그램 구성
// 2026-09-03 확정: 사용자가 백지에서 고르는 게 아니라 1차 구성을 제안하고 사용자가 수정한다.
// 손대지 않은 줄은 제안값 그대로 남고, 한 줄을 바꾸면 나머지가 자동 조정돼 합계 100%를 유지한다.
//
// 시설 분류는 Supabase facility_master(C01~C10 / P-NR / P-R)를,
// 허용용도 → 프로그램 코드 매핑은 part1_part3_facility_map을 그대로 따른다.
// SiteProgram이 sessionStorage["inrealtylab.step2AllowedUse"]에 남긴
// 허용 facility_key 목록으로 고를 수 있는 시설을 걸러낸다.

import { useEffect, useMemo, useState } from "react";

const ALLOWED_KEY = "inrealtylab.step2AllowedUse";
const SNAPSHOT_KEY = "inrealtylab.part1Snapshot";
const STORAGE_KEY = "inrealtylab.step2Program";

type CommercialCode =
  | "C01" | "C02" | "C03" | "C04" | "C05"
  | "C06" | "C07" | "C08" | "C09" | "C10";

type PublicCode = "P_R_PARKING" | "P_R_SENIOR_DAYCARE" | "P_R_PUBLIC_RENTAL_HOUSING" | "P_NR_GENERIC" | "P_NR_LIBRARY" | "P_NR_SENIOR_WELFARE_CENTER" | "P_NR_SOCIAL_WELFARE_CENTER" | "P_NR_PARK";

type CommercialFacility = {
  code: CommercialCode;
  label: string;
  businessModel: string;
  // part1_part3_facility_map 기준. 이 중 하나라도 허용되면 선택 가능.
  allowedFrom: string[];
  priority: number;
};

const COMMERCIAL: CommercialFacility[] = [
  { code: "C01", label: "오피스", businessModel: "임대", allowedFrom: ["OFFICE_GENERAL"], priority: 10 },
  { code: "C02", label: "리테일", businessModel: "임대 · 분양", allowedFrom: ["RETAIL", "NEIGHBORHOOD_1", "NEIGHBORHOOD_2"], priority: 20 },
  { code: "C03", label: "호스피탈리티", businessModel: "운영", allowedFrom: ["HOSPITALITY"], priority: 30 },
  { code: "C04", label: "리빙", businessModel: "임대주택", allowedFrom: ["LIVING"], priority: 40 },
  { code: "C05", label: "헬스케어", businessModel: "운영", allowedFrom: ["MEDICAL"], priority: 50 },
  { code: "C06", label: "교육", businessModel: "운영", allowedFrom: ["EDUCATION_RESEARCH"], priority: 60 },
  { code: "C07", label: "문화 · 엔터테인먼트", businessModel: "운영", allowedFrom: ["CULTURE_ASSEMBLY", "SPORTS"], priority: 70 },
  { code: "C08", label: "R&D · 랩", businessModel: "임대 · 운영", allowedFrom: ["EDUCATION_RESEARCH"], priority: 80 },
  { code: "C09", label: "물류", businessModel: "임대 · 운영", allowedFrom: ["LOGISTICS"], priority: 90 },
  { code: "C10", label: "디지털 인프라", businessModel: "용량 계약", allowedFrom: ["DIGITAL_INFRA"], priority: 100 },
];

const PUBLIC_FACILITIES: Array<{ code: PublicCode; label: string; revenue: boolean }> = [
  { code: "P_R_PARKING", label: "공영주차장", revenue: true },
  { code: "P_R_SENIOR_DAYCARE", label: "시니어 주야간보호시설", revenue: true },
  { code: "P_R_PUBLIC_RENTAL_HOUSING", label: "공공 매입임대주택", revenue: true },
  { code: "P_NR_SOCIAL_WELFARE_CENTER", label: "종합사회복지관", revenue: false },
  { code: "P_NR_SENIOR_WELFARE_CENTER", label: "노인복지관", revenue: false },
  { code: "P_NR_LIBRARY", label: "공공도서관", revenue: false },
  { code: "P_NR_PARK", label: "근린공원", revenue: false },
  { code: "P_NR_GENERIC", label: "그 밖의 공공시설", revenue: false },
];

// part3_program_scenario_policy
const SCENARIOS = [
  { code: "PUBLIC_FOCUS", name: "공공성 중심", publicPct: 60, commercialPct: 40 },
  { code: "BASE", name: "균형형", publicPct: 40, commercialPct: 60 },
  { code: "COMMERCIAL_FOCUS", name: "수익성 중심", publicPct: 20, commercialPct: 80 },
];

const RECOMMENDED_SCENARIO = "BASE";

type ProgramSelection = {
  scenarioCode: string;
  commercial: Partial<Record<CommercialCode, number>>;
  publicFacilities: PublicCode[];
  touched: CommercialCode[];
};

function formatArea(value: number) {
  return `${Math.round(value).toLocaleString("ko-KR")}㎡`;
}

function readAllowedKeys(): string[] | null {
  try {
    const raw = sessionStorage.getItem(ALLOWED_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as string[]) : null;
  } catch {
    return null;
  }
}

function readAboveGroundGfa(): number {
  try {
    const raw = sessionStorage.getItem(SNAPSHOT_KEY);
    if (!raw) return 0;
    const parsed = JSON.parse(raw) as { siteAreaSqm?: number; statutoryFarMaxPct?: number | null };
    const area = Number(parsed.siteAreaSqm) || 0;
    const far = Number(parsed.statutoryFarMaxPct) || 0;
    return area > 0 && far > 0 ? area * (far / 100) : 0;
  } catch {
    return 0;
  }
}

// 허용된 시설 중 우선순위 상위 둘에 70:30을 제안한다.
// 실제 수요 데이터(demand_observation·facility_demand_weight) 연결은 다음 작업.
function recommend(available: CommercialFacility[]): Partial<Record<CommercialCode, number>> {
  if (!available.length) return {};
  if (available.length === 1) return { [available[0].code]: 100 };
  return { [available[0].code]: 70, [available[1].code]: 30 };
}

export default function ProgramChoice() {
  const [allowedKeys, setAllowedKeys] = useState<string[] | null>(null);
  const [aboveGroundGfa, setAboveGroundGfa] = useState(0);
  const [selection, setSelection] = useState<ProgramSelection | null>(null);

  useEffect(() => {
    setAllowedKeys(readAllowedKeys());
    setAboveGroundGfa(readAboveGroundGfa());
  }, []);

  const available = useMemo(() => {
    if (!allowedKeys) return [];
    return COMMERCIAL
      .filter((facility) => facility.allowedFrom.some((key) => allowedKeys.includes(key)))
      .sort((a, b) => a.priority - b.priority);
  }, [allowedKeys]);

  const blocked = useMemo(() => {
    if (!allowedKeys) return [];
    return COMMERCIAL.filter((facility) => !facility.allowedFrom.some((key) => allowedKeys.includes(key)));
  }, [allowedKeys]);

  // 1차 제안을 만들거나, 저장해둔 사용자 수정본을 되살린다.
  useEffect(() => {
    if (!allowedKeys) return;
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (raw) {
        setSelection(JSON.parse(raw) as ProgramSelection);
        return;
      }
    } catch {
      // 저장본을 못 읽으면 새로 제안한다.
    }
    setSelection({
      scenarioCode: RECOMMENDED_SCENARIO,
      commercial: recommend(available),
      publicFacilities: ["P_R_PARKING", "P_NR_SOCIAL_WELFARE_CENTER"],
      touched: [],
    });
  }, [allowedKeys, available]);

  useEffect(() => {
    if (!selection) return;
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(selection));
    } catch {
      // 스토리지를 못 쓰면 STEP 3에서 기본 배분으로 계산한다.
    }
  }, [selection]);

  const scenario = SCENARIOS.find((item) => item.code === selection?.scenarioCode) ?? SCENARIOS[1];
  const commercialGfa = aboveGroundGfa * (scenario.commercialPct / 100);
  const publicGfa = aboveGroundGfa * (scenario.publicPct / 100);

  const commercialTotal = useMemo(() => {
    if (!selection) return 0;
    return Object.values(selection.commercial).reduce((sum, value) => sum + (value ?? 0), 0);
  }, [selection]);

  // 한 줄을 바꾸면 손대지 않은 줄들이 남은 몫을 나눠 갖는다.
  function setCommercialPct(code: CommercialCode, nextValue: number) {
    setSelection((current) => {
      if (!current) return current;
      const value = Math.max(0, Math.min(100, Math.round(nextValue)));
      const touched = current.touched.includes(code) ? current.touched : [...current.touched, code];
      const entries = Object.keys(current.commercial) as CommercialCode[];
      const others = entries.filter((item) => item !== code && !touched.includes(item));
      const fixed = entries
        .filter((item) => item !== code && touched.includes(item))
        .reduce((sum, item) => sum + (current.commercial[item] ?? 0), 0);

      const next: Partial<Record<CommercialCode, number>> = { ...current.commercial, [code]: value };
      const remainder = Math.max(0, 100 - value - fixed);

      if (others.length) {
        const base = Math.floor(remainder / others.length);
        others.forEach((item, index) => {
          next[item] = index === others.length - 1 ? remainder - base * (others.length - 1) : base;
        });
      }

      return { ...current, commercial: next, touched };
    });
  }

  function addFacility(code: CommercialCode) {
    setSelection((current) => {
      if (!current || current.commercial[code] !== undefined) return current;
      return { ...current, commercial: { ...current.commercial, [code]: 0 } };
    });
  }

  function removeFacility(code: CommercialCode) {
    setSelection((current) => {
      if (!current) return current;
      const next = { ...current.commercial };
      delete next[code];
      return {
        ...current,
        commercial: next,
        touched: current.touched.filter((item) => item !== code),
      };
    });
  }

  function togglePublic(code: PublicCode) {
    setSelection((current) => {
      if (!current) return current;
      const has = current.publicFacilities.includes(code);
      return {
        ...current,
        publicFacilities: has
          ? current.publicFacilities.filter((item) => item !== code)
          : [...current.publicFacilities, code],
      };
    });
  }

  function resetToRecommended() {
    setSelection({
      scenarioCode: RECOMMENDED_SCENARIO,
      commercial: recommend(available),
      publicFacilities: ["P_R_PARKING", "P_NR_SOCIAL_WELFARE_CENTER"],
      touched: [],
    });
  }

  if (!allowedKeys) {
    return (
      <section className="control-section">
        <div className="control-section-title"><span>STEP 2 · 선택</span><strong>프로그램 구성</strong></div>
        <div className="regime-note">지을 수 있는 용도가 확인되면 시설 구성을 제안합니다.</div>
      </section>
    );
  }

  if (!selection) return null;

  const selectedCodes = Object.keys(selection.commercial) as CommercialCode[];
  const addable = available.filter((facility) => selection.commercial[facility.code] === undefined);
  const totalOk = commercialTotal === 100;

  return (
    <section className="control-section">
      <div className="control-section-title">
        <span>STEP 2 · 선택</span>
        <strong>프로그램 구성</strong>
      </div>

      <div className="choice-head" style={{ marginBottom: 10 }}>
        <em className="choice-proposed">1차 제안</em>
        <button type="button" className="choice-reset" onClick={resetToRecommended}>추천 구성으로 되돌리기</button>
      </div>
      <p className="choice-hint">
        수요를 기준으로 구성을 먼저 제안했습니다. 각 줄을 바꾸면 손대지 않은 줄이 자동으로 조정돼 합계 100%가 유지됩니다.
      </p>

      {/* ── 시나리오 ── */}
      <div className="choice-grid three">
        {SCENARIOS.map((item) => (
          <button
            type="button"
            key={item.code}
            className={`choice-card${selection.scenarioCode === item.code ? " selected" : ""}`}
            onClick={() => setSelection((current) => (current ? { ...current, scenarioCode: item.code } : current))}
          >
            <span className="choice-card-head">
              <i className="choice-radio" />
              <strong>{item.name}</strong>
              {item.code === RECOMMENDED_SCENARIO && <em className="choice-tag">추천</em>}
            </span>
            <span className="choice-desc">공공 {item.publicPct}% : 수익 {item.commercialPct}%</span>
          </button>
        ))}
      </div>

      {/* ── 연면적 분할 ── */}
      {aboveGroundGfa > 0 ? (
        <>
          <div className="program-split">
            <div className="program-split-bar">
              <div className="program-split-public" style={{ width: `${scenario.publicPct}%` }}>
                공공 {scenario.publicPct}% · {formatArea(publicGfa)}
              </div>
              <div className="program-split-commercial" style={{ width: `${scenario.commercialPct}%` }}>
                수익 {scenario.commercialPct}% · {formatArea(commercialGfa)}
              </div>
            </div>
            <div className="program-split-total">지상 연면적 <strong>{formatArea(aboveGroundGfa)}</strong></div>
          </div>
        </>
      ) : (
        <div className="regime-note">용적률 상한이 확인되면 연면적 배분을 계산합니다.</div>
      )}

      {/* ── 수익시설 ── */}
      <div className="program-head">
        <div><strong>수익시설</strong> <span>{aboveGroundGfa > 0 ? formatArea(commercialGfa) : "-"}</span></div>
        <em className={`program-total${totalOk ? " ok" : ""}`}>합계 {commercialTotal}%</em>
      </div>

      <div className="program-rows">
        {selectedCodes.map((code) => {
          const facility = COMMERCIAL.find((item) => item.code === code);
          if (!facility) return null;
          const pct = selection.commercial[code] ?? 0;
          const isTouched = selection.touched.includes(code);
          return (
            <div className={`program-row${isTouched ? " touched" : ""}`} key={code}>
              <div className="program-row-head">
                <span className="program-code">{code}</span>
                <strong>{facility.label}</strong>
                <span className="program-model">{facility.businessModel}</span>
                {isTouched ? <em className="choice-tag dark">직접 수정함</em> : <em className="choice-tag">추천</em>}
                <button type="button" className="program-remove" onClick={() => removeFacility(code)}>제거</button>
              </div>
              <div className="program-row-input">
                <input
                  type="range"
                  className="choice-range"
                  min={0}
                  max={100}
                  step={5}
                  value={pct}
                  onChange={(event) => setCommercialPct(code, Number(event.target.value))}
                />
                <strong>{pct}%</strong>
                <span>{aboveGroundGfa > 0 ? formatArea(commercialGfa * (pct / 100)) : "-"}</span>
              </div>
            </div>
          );
        })}
      </div>

      {!totalOk && (
        <div className="control-warning">
          수익시설 비율 합계가 정확히 100%가 되어야 연면적 배분이 확정됩니다. 지금은 {commercialTotal}%입니다.
        </div>
      )}

      {addable.length > 0 && (
        <>
          <p className="choice-hint" style={{ marginTop: 16 }}>더 넣을 수 있는 시설</p>
          <div className="program-chips">
            {addable.map((facility) => (
              <button type="button" key={facility.code} className="program-chip" onClick={() => addFacility(facility.code)}>
                <span className="program-code">{facility.code}</span>{facility.label}
              </button>
            ))}
          </div>
        </>
      )}

      {blocked.length > 0 && (
        <>
          <p className="choice-hint" style={{ marginTop: 16 }}>이 필지에서는 허용 용도 밖</p>
          <div className="program-chips">
            {blocked.map((facility) => (
              <span key={facility.code} className="program-chip blocked">
                <span className="program-code">{facility.code}</span>{facility.label}
              </span>
            ))}
          </div>
        </>
      )}

      {/* ── 공공시설 ── */}
      <div className="program-head" style={{ marginTop: 24 }}>
        <div><strong>공공시설</strong> <span>{aboveGroundGfa > 0 ? formatArea(publicGfa) : "-"}</span></div>
        <em className="program-note">수익 발생 여부로 나뉩니다</em>
      </div>
      <div className="program-chips">
        {PUBLIC_FACILITIES.map((facility) => {
          const on = selection.publicFacilities.includes(facility.code);
          return (
            <button
              type="button"
              key={facility.code}
              className={`program-chip${on ? " on" : ""}`}
              onClick={() => togglePublic(facility.code)}
            >
              <span className={`program-code${facility.revenue ? " revenue" : ""}`}>{facility.revenue ? "P-R" : "P-NR"}</span>
              {facility.label}
            </button>
          );
        })}
      </div>
    </section>
  );
}
