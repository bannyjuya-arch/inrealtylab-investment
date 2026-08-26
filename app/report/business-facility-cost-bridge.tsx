"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const BUSINESS_FACILITIES = [
  { key: "OFFICE", code: "C01_OFFICE", label: "OFFICE" },
  { key: "RETAIL", code: "C02_RETAIL", label: "RETAIL" },
  { key: "HOSPITALITY", code: "C03_HOSPITALITY", label: "HOSPITALITY" },
  { key: "LIVING", code: "C04_LIVING", label: "LIVING" },
  { key: "HEALTHCARE", code: "C05_HEALTHCARE", label: "HEALTHCARE" },
  { key: "EDUCATION", code: "C06_EDUCATION", label: "EDUCATION" },
  { key: "CULTURE_ENTERTAINMENT", code: "C07_CULTURE_ENTERTAINMENT", label: "CULTURE & ENTERTAINMENT" },
  { key: "RND_LAB", code: "C08_RND_LAB", label: "R&D / LAB" },
  { key: "LOGISTICS", code: "C09_LOGISTICS", label: "LOGISTICS" },
  { key: "DIGITAL_INFRA", code: "C10_DIGITAL_INFRA", label: "DIGITAL INFRA" },
] as const;

type FacilityKey = (typeof BUSINESS_FACILITIES)[number]["key"];

type CostResponse = {
  ok: boolean;
  facilityKey?: string;
  facilityCode?: string | null;
  costPerSqm?: number | null;
  costLow?: number | null;
  costMid?: number | null;
  costHigh?: number | null;
  effectiveDate?: string | null;
  sourceCode?: string | null;
  costBasis?: string | null;
  status?: string;
  message?: string;
};

function findConstructionCostField() {
  const labels = Array.from(document.querySelectorAll<HTMLLabelElement>(".report-field label"));
  const label = labels.find((item) => item.textContent?.trim() === "표준공사비 원/㎡");
  if (!label) return null;
  const field = label.closest<HTMLElement>(".report-field");
  const input = field?.querySelector<HTMLInputElement>("input");
  return field && input ? { field, label, input } : null;
}

function setReactInputValue(input: HTMLInputElement, value: number | null) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  const next = value === null ? "" : String(value);
  if (setter) setter.call(input, next);
  else input.value = next;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function formatWonPerSqm(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "공사비 자료 없음";
  return `${Math.round(value).toLocaleString("ko-KR")}원/㎡`;
}

export default function BusinessFacilityCostBridge() {
  const [mount, setMount] = useState<HTMLElement | null>(null);
  const [selected, setSelected] = useState<FacilityKey | null>(null);
  const [cost, setCost] = useState<CostResponse | null>(null);
  const [loading, setLoading] = useState(false);
  // 2026-08-26 버그수정: install() 이 라벨 텍스트를 "표준공사비 원/㎡" → "선택 사업시설 공사비 원/㎡"로
  // 바꿔버린 뒤, findConstructionCostField()가 원래 라벨 텍스트로만 재검색하다 보니
  // selectFacility() 시점엔 입력창을 다시 못 찾아 값이 절대 반영되지 않던 버그.
  // 마운트 시점에 찾은 input 엘리먼트 자체를 ref에 고정해두고 재사용한다.
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let timer = 0;

    function install() {
      const target = findConstructionCostField();
      if (!target) return false;

      target.label.textContent = "선택 사업시설 공사비 원/㎡";
      target.input.readOnly = true;
      target.input.placeholder = "사업시설 선택 시 DB 자동조회";
      inputRef.current = target.input;

      let node = document.getElementById("inrealtylab-business-facility-selector");
      if (!node) {
        node = document.createElement("div");
        node.id = "inrealtylab-business-facility-selector";
        // 2026-08-26 확정: 외부 공유용 보고서에서는 시설 선택 UI와 단가·DB 출처(내부 원가 데이터)를
        // 노출하지 않는다 — 계산 결과인 COST 표(Construction CAPEX)만 남기고 이 카드 전체는 인쇄 시에도,
        // 관리자로 로그인하지 않은 화면(admin-only)에서도 숨긴다.
        node.className = "report-section no-print admin-only";
        const assumptionsSection = target.field.closest<HTMLElement>(".report-section");
        assumptionsSection?.parentElement?.insertBefore(node, assumptionsSection);
      }
      setMount(node);
      return true;
    }

    if (!install()) {
      timer = window.setInterval(() => {
        if (install()) window.clearInterval(timer);
      }, 100);
    }

    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (mount && !selected) {
      // 2026-08-26 확정: 시설 선택 카드를 관리자 전용(admin-only)으로 숨기면서 외부 사용자는
      // 시설을 고를 방법이 사라져 공사비·DSCR·IRR이 전부 REVIEW/빈 값으로 나오는 문제가 생겼다.
      // 시범검토 기본 시설(OFFICE)을 자동 선택해 기본 계산이 항상 돌아가게 하고,
      // 관리자는 로그인 후 화면에 다시 나타나는 버튼으로 다른 시설을 직접 골라 바꿀 수 있다.
      void selectFacility("OFFICE");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mount]);

  async function selectFacility(key: FacilityKey) {
    setSelected(key);
    setLoading(true);
    setCost(null);

    // install() 이후로는 라벨 텍스트가 바뀌어 findConstructionCostField()가
    // 더 이상 입력창을 찾지 못한다 — 마운트 시 저장해둔 inputRef를 직접 사용한다.
    if (inputRef.current) setReactInputValue(inputRef.current, null);

    try {
  const facilityCode = BUSINESS_FACILITIES.find((item) => item.key === key)?.code ?? key;
  const response = await fetch(`/api/construction-cost?facilityCode=${encodeURIComponent(facilityCode)}`, { cache: "no-store" });
  const raw = (await response.json()) as {
    ok: boolean;
    message?: string;
    costs?: Array<{
      facilityCode: string;
      defaultCostPerSqm: number | null;
      latestEffectiveDate: string | null;
      sourceCodes: string | null;
      costBasis: string | null;
    }>;
  };
  const first = raw.ok ? raw.costs?.[0] : undefined;
  const data: CostResponse = raw.ok
    ? {
        ok: true,
        facilityCode: first?.facilityCode ?? facilityCode,
        costPerSqm: first?.defaultCostPerSqm ?? null,
        effectiveDate: first?.latestEffectiveDate ?? null,
        sourceCode: first?.sourceCodes ?? null,
        costBasis: first?.costBasis ?? null,
        status: first ? "OK" : "NOT_FOUND",
        message: first ? undefined : "해당 시설의 공사비 데이터가 아직 없습니다.",
      }
    : { ok: false, message: raw.message ?? "공사비 조회 실패" };
  setCost(data);

      if (inputRef.current) setReactInputValue(inputRef.current, data.ok ? (data.costPerSqm ?? null) : null);

      try {
        sessionStorage.setItem("inrealtylab.selectedBusinessFacility", JSON.stringify({
          selectedAt: new Date().toISOString(),
          facilityKey: key,
          facilityCode: BUSINESS_FACILITIES.find((item) => item.key === key)?.code ?? null,
          constructionCost: data,
        }));
      } catch {
        // calculation does not depend on storage
      }
    } catch {
      if (inputRef.current) setReactInputValue(inputRef.current, null);
      setCost({ ok: false, costPerSqm: null, message: "공사비 조회 실패" });
    } finally {
      setLoading(false);
    }
  }

  if (!mount) return null;

  return createPortal(
    <>
      <div className="report-section-head">
        <div><span>BUSINESS FACILITY</span><br /><strong>사업시설 선택 · 공사비 연계</strong></div>
      </div>
      <div className="report-note" style={{ marginBottom: 12 }}>
        선택한 사업시설의 공사비를 DB에서 조회합니다. 현재 샘플에서는 OFFICE만 공사비가 연결되며 나머지 9개 시설은 단가와 Construction CAPEX를 null로 유지합니다.
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 8 }}>
        {BUSINESS_FACILITIES.map((facility) => (
          <button
            key={facility.key}
            type="button"
            className={`report-btn ${selected === facility.key ? "primary" : ""}`}
            onClick={() => void selectFacility(facility.key)}
            disabled={loading}
            style={{ minHeight: 44 }}
          >
            {facility.label}
          </button>
        ))}
      </div>
      <div className="report-card" style={{ marginTop: 12, minHeight: 0 }}>
        <h3 style={{ marginBottom: 6 }}>공사비 연결 상태</h3>
        {!selected ? (
          <div className="report-source">사업시설을 선택해 주세요.</div>
        ) : loading ? (
          <div className="report-source">공사비 DB 조회 중</div>
        ) : (
          <>
            <div className="report-metric"><span>선택 시설</span><strong>{BUSINESS_FACILITIES.find((item) => item.key === selected)?.label}</strong></div>
            <div className="report-metric"><span>적용 단가</span><strong>{formatWonPerSqm(cost?.costPerSqm)}</strong></div>
            {cost?.costPerSqm !== null && cost?.costPerSqm !== undefined && (
              <div className="report-source" style={{ marginTop: 8 }}>
                DB {cost.facilityCode ?? "-"} · 기준일 {cost.effectiveDate ?? "-"} · {cost.sourceCode ?? "출처 확인 필요"}
              </div>
            )}
            {selected !== "OFFICE" && (
              <div className="report-warning" style={{ marginTop: 8 }}>
                현재 이 시설은 연결된 공사비 자료가 없어 단가와 Construction CAPEX를 null로 유지합니다.
              </div>
            )}
          </>
        )}
      </div>
    </>,
    mount
  );
}
