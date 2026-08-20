"use client";

import { useEffect, useState } from "react";
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

  useEffect(() => {
    let timer = 0;

    function install() {
      const target = findConstructionCostField();
      if (!target) return false;

      target.label.textContent = "선택 사업시설 공사비 원/㎡";
      target.input.readOnly = true;
      target.input.placeholder = "사업시설 선택 시 DB 자동조회";

      let node = document.getElementById("inrealtylab-business-facility-selector");
      if (!node) {
        node = document.createElement("div");
        node.id = "inrealtylab-business-facility-selector";
        node.className = "report-section";
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

  async function selectFacility(key: FacilityKey) {
    setSelected(key);
    setLoading(true);
    setCost(null);

    const target = findConstructionCostField();
    if (target) setReactInputValue(target.input, null);

    try {
      const response = await fetch(`/api/construction-cost?facilityKey=${encodeURIComponent(key)}`, { cache: "no-store" });
      const data = (await response.json()) as CostResponse;
      setCost(data);

      const nextTarget = findConstructionCostField();
      if (nextTarget) setReactInputValue(nextTarget.input, data.ok ? (data.costPerSqm ?? null) : null);

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
      const nextTarget = findConstructionCostField();
      if (nextTarget) setReactInputValue(nextTarget.input, null);
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
