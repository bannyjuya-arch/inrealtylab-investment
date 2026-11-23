"use client";

// STEP 2 · 사용자 선택
// 2026-09-03 확정: 사업방식(토지 권원)과 사업주체(자금조달)를 별개 축으로 고른다.
// 두 축을 한 라디오 그룹에 섞으면 "대부·사용허가 + 개발리츠" 같은 실제 조합을
// 표현할 수 없기 때문이다. 신탁·위탁개발을 고르면 사업주체는 신탁사로 고정된다.
//
// structureCode 값은 Supabase part3_business_structure_policy의 코드와 맞춘다.

import { useEffect, useState } from "react";

const STORAGE_KEY = "inrealtylab.step2Structure";

type LandRight = "CONCESSION" | "LEASE_PERMIT" | "TRUST" | "MIXED";
type ConcessionType = "BTO" | "BOT";
type Vehicle = "SPC" | "PROJECT_REIT" | "TRUSTEE";

export type StructureSelection = {
  landRight: LandRight;
  concessionType: ConcessionType;
  vehicle: Vehicle;
  publicContributionPct: number;
  /** 2026-11-17: 연 토지사용료 = 공시지가 총액 × 이 요율. 3, 4, 5% 중 선택. */
  landFeeRatePct: LandFeeRate;
};

type LandFeeRate = 3 | 4 | 5;

const LAND_FEE_RATES: Array<{ key: LandFeeRate; title: string; desc: string }> = [
  { key: 3, title: "3%", desc: "주거용 적용 기준. 국유재산 주거용 법정 하한(2~2.5% 이상)보다 보수적으로 잡은 값" },
  { key: 4, title: "4%", desc: "중간값. 주거와 비주거가 섞인 복합 프로그램" },
  { key: 5, title: "5%", desc: "국유재산법 시행령 제29조 기본 요율(1천분의 50 이상)" },
];

const DEFAULT_SELECTION: StructureSelection = {
  landRight: "CONCESSION",
  concessionType: "BTO",
  vehicle: "SPC",
  // 2026-09-06: STEP 2 프로그램 구성의 균형형 기준(BASE_PUBLIC_PCT, ProgramChoice.tsx 참고 —
  // 규모 시나리오 GAP 10%p)과 맞춰 기본 공공기여 비율도 15%에서 10%로 낮췄다.
  publicContributionPct: 10,
  landFeeRatePct: 3,
};

const LAND_RIGHTS: Array<{ key: LandRight; title: string; desc: string }> = [
  {
    key: "CONCESSION",
    title: "민간투자 (BTO, BOT)",
    desc: "민간투자법상 수익형. 시설 사용료 수입으로 회수",
  },
  {
    key: "LEASE_PERMIT",
    title: "대부 및 사용허가",
    desc: "국공유재산 대부 후 직접 개발 및 운영. 소유권은 공공 유지",
  },
  {
    key: "TRUST",
    title: "신탁 및 위탁개발",
    desc: "국유재산법 제57조. 일반재산 신탁 또는 위탁 개발 후 수익 배분",
  },
  {
    key: "MIXED",
    title: "혼합형",
    desc: "동 또는 층별로 두 방식 분리 적용",
  },
];

const CONCESSION_TYPES: Array<{ key: ConcessionType; title: string; desc: string }> = [
  { key: "BTO", title: "BTO", desc: "준공 즉시 소유권 이전. 관리운영권을 무형자산으로 상각" },
  { key: "BOT", title: "BOT", desc: "운영기간 중 민간 소유, 만료 시 소유권 이전" },
];

const VEHICLES: Array<{ key: Vehicle; title: string; desc: string }> = [
  { key: "SPC", title: "프로젝트 SPC", desc: "시행법인 직접 설립 후 개발, 운영수익으로 회수" },
  {
    key: "PROJECT_REIT",
    title: "개발리츠",
    desc: "부동산투자회사법상 위탁관리 리츠. 공공 출자 참여 용이, 배당으로 회수",
  },
  {
    key: "TRUSTEE",
    title: "신탁사",
    desc: "수탁자 시행. 사업방식에서 신탁 및 위탁개발 선택 시 자동 고정",
  },
];

function readSelection(): StructureSelection {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SELECTION;
    return { ...DEFAULT_SELECTION, ...(JSON.parse(raw) as Partial<StructureSelection>) };
  } catch {
    return DEFAULT_SELECTION;
  }
}

export default function StructureChoice() {
  const [selection, setSelection] = useState<StructureSelection>(DEFAULT_SELECTION);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setSelection(readSelection());
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(selection));
    } catch {
      // 스토리지를 못 쓰면 STEP 3에서 기본 구조로 판정한다.
    }
  }, [selection, ready]);

  function pickLandRight(landRight: LandRight) {
    setSelection((current) => ({
      ...current,
      landRight,
      // 신탁·위탁개발은 수탁자가 시행 주체라 사업주체가 따라 고정된다.
      vehicle: landRight === "TRUST" ? "TRUSTEE" : current.vehicle === "TRUSTEE" ? "SPC" : current.vehicle,
    }));
  }

  const vehicleLocked = selection.landRight === "TRUST";

  return (
    <section className="control-section">
      <div className="control-section-title">
        <span>STEP 2-2 사용자 설정값</span>
        <strong>사업방식 및 사업주체</strong>
      </div>
      <div className="regime-note">이 항목의 선택값에 따라 STEP 3 사업성 판정 결과 변동</div>

      {/* ── 사업방식 ── */}
      <div className="choice-block">
        <div className="choice-head">
          <strong>사업방식</strong>
          <em className="choice-required">필수</em>
        </div>
        <p className="choice-hint">국공유지 확보 권원 선택</p>
        <div className="choice-grid">
          {LAND_RIGHTS.map((option) => (
            <button
              type="button"
              key={option.key}
              className={`choice-card${selection.landRight === option.key ? " selected" : ""}`}
              onClick={() => pickLandRight(option.key)}
            >
              <span className="choice-card-head">
                <i className="choice-radio" />
                <strong>{option.title}</strong>
              </span>
              <span className="choice-desc">{option.desc}</span>
            </button>
          ))}
        </div>

        {selection.landRight === "CONCESSION" && (
          <div className="choice-sub">
            <div className="choice-sub-head">
              <strong>민간투자 세부 유형</strong>
              <span>공공으로 소유권 이전 시점 기준</span>
            </div>
            <div className="choice-grid two">
              {CONCESSION_TYPES.map((option) => (
                <button
                  type="button"
                  key={option.key}
                  className={`choice-card${selection.concessionType === option.key ? " selected" : ""}`}
                  onClick={() => setSelection((current) => ({ ...current, concessionType: option.key }))}
                >
                  <span className="choice-card-head">
                    <i className="choice-radio" />
                    <strong>{option.title}</strong>
                  </span>
                  <span className="choice-desc">{option.desc}</span>
                </button>
              ))}
            </div>
            <p className="choice-hint">
              BOT는 민간 보유 기간 중 재산세 부과 및 유형자산 감가상각 발생. 같은 임대료라도 세후 현금흐름과 IRR 상이
            </p>
          </div>
        )}
      </div>

      {/* ── 사업주체 ── */}
      <div className="choice-block">
        <div className="choice-head">
          <strong>사업주체 및 자금조달</strong>
          <em className="choice-required">필수</em>
        </div>
        <p className="choice-hint">사업방식과 별개 항목. 대부 및 사용허가에 리츠를 결합하는 구성도 가능</p>
        <div className="choice-grid three">
          {VEHICLES.map((option) => (
            <button
              type="button"
              key={option.key}
              className={`choice-card${selection.vehicle === option.key ? " selected" : ""}`}
              disabled={vehicleLocked && option.key !== "TRUSTEE"}
              onClick={() => setSelection((current) => ({ ...current, vehicle: option.key }))}
            >
              <span className="choice-card-head">
                <i className="choice-radio" />
                <strong>{option.title}</strong>
              </span>
              <span className="choice-desc">{option.desc}</span>
            </button>
          ))}
        </div>
        {vehicleLocked && (
          <p className="choice-hint">신탁 및 위탁개발 선택으로 사업주체가 신탁사로 고정됨</p>
        )}
        <p className="choice-hint">
          선택값에 따라 STEP 3 현금흐름 산정 방식 상이. 리츠는 배당가능이익 90% 배당 요건 및 배당 소득공제 법인세, 신탁은 신탁보수 및 수익권 배분 구조 반영
        </p>
      </div>

      {/* ── 토지사용료 요율 (2026-11-17) ── */}
      <div className="choice-block">
        <div className="choice-head">
          <strong>토지사용료율</strong>
          <em className="choice-default">공시지가 대비, 기본값 3%</em>
        </div>
        <p className="choice-hint">연 토지사용료 = 개별공시지가 × 대지면적 × 요율. 사업성 판정 현금흐름에서 매년 차감</p>
        <div className="choice-grid three">
          {LAND_FEE_RATES.map((option) => (
            <button
              type="button"
              key={option.key}
              className={`choice-card${selection.landFeeRatePct === option.key ? " selected" : ""}`}
              onClick={() => setSelection((current) => ({ ...current, landFeeRatePct: option.key }))}
            >
              <span className="choice-card-head">
                <i className="choice-radio" />
                <strong>{option.title}</strong>
              </span>
              <span className="choice-desc">{option.desc}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ── 공공기여 비율 ── */}
      <div className="choice-block">
        <div className="choice-head">
          <strong>공공기여율</strong>
          <em className="choice-default">기본값 10%</em>
        </div>
        <input
          className="choice-range"
          type="range"
          min={0}
          max={30}
          step={1}
          value={selection.publicContributionPct}
          onChange={(event) =>
            setSelection((current) => ({ ...current, publicContributionPct: Number(event.target.value) }))
          }
        />
        <div className="choice-range-scale">
          <span>0%</span>
          <strong>{selection.publicContributionPct}%</strong>
          <span>30%</span>
        </div>
      </div>
    </section>
  );
}
