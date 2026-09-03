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
};

const DEFAULT_SELECTION: StructureSelection = {
  landRight: "CONCESSION",
  concessionType: "BTO",
  vehicle: "SPC",
  publicContributionPct: 15,
};

const LAND_RIGHTS: Array<{ key: LandRight; title: string; desc: string }> = [
  {
    key: "CONCESSION",
    title: "민간투자 · BTO · BOT",
    desc: "민간투자법상 수익형. 시설 사용료 수입으로 회수합니다.",
  },
  {
    key: "LEASE_PERMIT",
    title: "대부 · 사용허가",
    desc: "국공유재산을 빌려 직접 개발하고 운영합니다. 소유권은 그대로 공공에 남습니다.",
  },
  {
    key: "TRUST",
    title: "신탁 · 위탁개발",
    desc: "국유재산법 제57조. 일반재산을 신탁·위탁해 개발하고 수익을 배분합니다.",
  },
  {
    key: "MIXED",
    title: "혼합형",
    desc: "동 또는 층별로 두 방식을 나누어 적용합니다.",
  },
];

const CONCESSION_TYPES: Array<{ key: ConcessionType; title: string; desc: string }> = [
  { key: "BTO", title: "BTO", desc: "준공 즉시 이전. 관리운영권을 무형자산으로 상각합니다." },
  { key: "BOT", title: "BOT", desc: "운영기간 동안 민간이 시설을 소유하고, 만료 시 이전합니다." },
];

const VEHICLES: Array<{ key: Vehicle; title: string; desc: string }> = [
  { key: "SPC", title: "프로젝트 SPC", desc: "시행법인을 직접 세워 개발하고, 운영수익으로 회수합니다." },
  {
    key: "PROJECT_REIT",
    title: "개발리츠",
    desc: "부동산투자회사법상 위탁관리 리츠. 공공이 출자로 함께 들어오기 쉽고, 배당으로 회수합니다.",
  },
  {
    key: "TRUSTEE",
    title: "신탁사",
    desc: "수탁자가 시행합니다. 사업방식에서 신탁·위탁개발을 고르면 여기로 고정됩니다.",
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
        <span>STEP 2 · 선택</span>
        <strong>내가 정하는 값</strong>
      </div>
      <div className="regime-note">여기서 고른 값만 사업성 판정 결과를 바꿉니다.</div>

      {/* ── 사업방식 ── */}
      <div className="choice-block">
        <div className="choice-head">
          <strong>사업방식</strong>
          <em className="choice-required">필수</em>
        </div>
        <p className="choice-hint">국공유지를 어떤 권원으로 확보하는지를 고릅니다.</p>
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
              <span>소유권이 언제 공공으로 넘어가는지</span>
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
              BOT는 시설을 민간이 보유하는 동안 재산세가 붙고 유형자산 감가상각이 잡힙니다. 같은 임대료라도 세후 현금흐름과 IRR이 달라집니다.
            </p>
          </div>
        )}
      </div>

      {/* ── 사업주체 ── */}
      <div className="choice-block">
        <div className="choice-head">
          <strong>사업주체 · 자금조달</strong>
          <em className="choice-required">필수</em>
        </div>
        <p className="choice-hint">사업방식과 별개 축입니다. 대부·사용허가에 리츠를 얹는 조합도 됩니다.</p>
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
          <p className="choice-hint">신탁·위탁개발을 골라서 사업주체가 신탁사로 고정되었습니다.</p>
        )}
        <p className="choice-hint">
          여기서 고른 값에 따라 STEP 3 현금흐름이 갈라집니다 — 리츠는 배당가능이익 90% 배당 요건과 배당 소득공제 법인세, 신탁은 신탁보수와 수익권 배분 구조가 반영됩니다.
        </p>
      </div>

      {/* ── 공공기여 비율 ── */}
      <div className="choice-block">
        <div className="choice-head">
          <strong>공공기여 비율</strong>
          <em className="choice-default">기본값 15%</em>
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
