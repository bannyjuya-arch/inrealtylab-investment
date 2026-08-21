"use client";

import { useEffect, useMemo, useState } from "react";

type FacilityRow = {
  facility_code: string;
  category_code: string;
  category_name: string;
  business_model: string | null;
  legal_status: string;
  selectable: boolean;
  ratio_pct: number;
};

type CostRow = {
  facilityCode: string;
  categoryCode: string;
  categoryName: string;
  defaultCostPerSqm: number | null;
  benchmarkCount: number;
  latestEffectiveDate: string | null;
  sourceCodes: string | null;
  costBasis: string | null;
};

type FinanceBenchmark = {
  metricCode: string;
  financeType: string | null;
  valueLow: number | null;
  valueMid: number | null;
  valueHigh: number | null;
  unit: string | null;
  baseDate: string | null;
  benchmarkType: string | null;
  sourceCode: string | null;
  publisher: string | null;
  reportName: string | null;
  notes: string | null;
};

type FinanceResponse = {
  ok: boolean;
  benchmark?: Record<string, FinanceBenchmark>;
  pfSpecificAvailable?: boolean;
  note?: string;
  message?: string;
};

type AllocationResponse = {
  ok: boolean;
  message?: string;
  pnu?: string;
  aboveGroundGfaSqm?: number | null;
  commercialPoolGfaSqm?: number | null;
  totalRatioPct?: number;
  remainingRatioPct?: number;
  allocationComplete?: boolean;
  scenario?: {
    scenario_code: string;
    scenario_name: string;
    public_ratio_pct: number;
    commercial_ratio_pct: number;
  };
  facilities?: FacilityRow[];
};

const INDIRECT_COST_RATE = 0.10;
const CONTINGENCY_RATE = 0.10;
const DEFAULT_PF_RATE = 7.0;
const MIN_PF_RATE = 5.0;
const MAX_PF_RATE = 9.0;
const PF_RATE_STEP = 0.1;
const DEFAULT_LTC_PCT = 75;
const MIN_LTC_PCT = 70;
const MAX_LTC_PCT = 80;
const LTC_STEP = 1;

function readContext() {
  const params = new URLSearchParams(window.location.search);
  const pnu = (params.get("pnus") ?? params.get("pnu") ?? "").split(",")[0]?.trim() ?? "";
  let gfa: number | null = null;

  try {
    const raw = params.get("part1") ?? sessionStorage.getItem("inrealtylab.part1Snapshot") ?? "";
    if (raw) {
      const snapshot = JSON.parse(raw);
      const scenarios = Array.isArray(snapshot?.scenarios) ? snapshot.scenarios : [];
      const statutory = scenarios.find((item: any) => item?.label === "법정 최대") ?? scenarios.at(-1);
      const value = Number(statutory?.grossFloorAreaSqm);
      if (Number.isFinite(value) && value > 0) gfa = value;
    }
  } catch {
    // Keep null if Part 1 snapshot is unavailable.
  }

  return { pnu, gfa };
}

function persistCommercialAllocation(
  pnu: string,
  commercialPoolGfaSqm: number | null,
  rows: FacilityRow[],
  complete: boolean,
) {
  try {
    const facilities = rows.map((row) => {
      const ratioPct = Number(row.ratio_pct || 0);
      const allocatedGfaSqm = commercialPoolGfaSqm != null
        ? commercialPoolGfaSqm * ratioPct / 100
        : null;
      return {
        facilityCode: row.facility_code,
        categoryCode: row.category_code,
        categoryName: row.category_name,
        ratioPct,
        allocatedGfaSqm,
      };
    });

    sessionStorage.setItem("inrealtylab.commercialAllocation", JSON.stringify({
      pnu,
      scenarioCode: "BASE",
      commercialPoolGfaSqm,
      complete,
      facilities,
      savedAt: new Date().toISOString(),
    }));
  } catch {
    // Continue if browser storage is unavailable.
  }
}

export default function CommercialAllocationTable() {
  const [pnu, setPnu] = useState("");
  const [aboveGroundGfaSqm, setAboveGroundGfaSqm] = useState<number | null>(null);
  const [rows, setRows] = useState<FacilityRow[]>([]);
  const [scenario, setScenario] = useState<AllocationResponse["scenario"]>();
  const [commercialPoolGfaSqm, setCommercialPoolGfaSqm] = useState<number | null>(null);
  const [costDefaults, setCostDefaults] = useState<Record<string, CostRow>>({});
  const [costInputs, setCostInputs] = useState<Record<string, number>>({});
  const [financeBenchmark, setFinanceBenchmark] = useState<Record<string, FinanceBenchmark>>({});
  const [financeNote, setFinanceNote] = useState("");
  const [pfRatePct, setPfRatePct] = useState(DEFAULT_PF_RATE);
  const [ltcPct, setLtcPct] = useState(DEFAULT_LTC_PCT);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const total = useMemo(() => rows.reduce((sum, row) => sum + Number(row.ratio_pct || 0), 0), [rows]);
  const remaining = Math.max(0, 100 - total);
  const complete = Math.abs(total - 100) < 0.000001;

  const directConstructionCost = useMemo(() => {
    if (!complete || commercialPoolGfaSqm == null) return null;
    return rows.reduce((sum, row) => {
      const area = commercialPoolGfaSqm * Number(row.ratio_pct || 0) / 100;
      const unitCost = Number(costInputs[row.facility_code] || 0);
      return sum + area * unitCost;
    }, 0);
  }, [complete, commercialPoolGfaSqm, rows, costInputs]);

  const indirectCost = directConstructionCost == null ? null : directConstructionCost * INDIRECT_COST_RATE;
  const contingencyCost = directConstructionCost == null ? null : directConstructionCost * CONTINGENCY_RATE;
  const totalProjectCost = directConstructionCost == null
    ? null
    : directConstructionCost + (indirectCost ?? 0) + (contingencyCost ?? 0);
  const pfLoanAmount = totalProjectCost == null ? null : totalProjectCost * (ltcPct / 100);

  useEffect(() => {
    const ctx = readContext();
    setPnu(ctx.pnu);
    setAboveGroundGfaSqm(ctx.gfa);

    try {
      const savedPfRate = Number(sessionStorage.getItem("inrealtylab.pfRatePct"));
      if (Number.isFinite(savedPfRate) && savedPfRate >= MIN_PF_RATE && savedPfRate <= MAX_PF_RATE) {
        setPfRatePct(savedPfRate);
      }
      const savedLtc = Number(sessionStorage.getItem("inrealtylab.ltcPct"));
      if (Number.isFinite(savedLtc) && savedLtc >= MIN_LTC_PCT && savedLtc <= MAX_LTC_PCT) {
        setLtcPct(Math.round(savedLtc));
      } else {
        sessionStorage.setItem("inrealtylab.ltcPct", String(DEFAULT_LTC_PCT));
      }
    } catch {
      // Keep default finance assumptions if browser storage is unavailable.
    }

    if (!/^\d{19}$/.test(ctx.pnu)) return;

    const qs = new URLSearchParams({ pnu: ctx.pnu, scenarioCode: "BASE" });
    if (ctx.gfa) qs.set("aboveGroundGfaSqm", String(ctx.gfa));

    setLoading(true);
    Promise.all([
      fetch(`/api/commercial-allocation?${qs.toString()}`, { cache: "no-store" }).then((r) => r.json().then((data) => ({ ok: r.ok, data }))),
      fetch("/api/construction-cost?all=1", { cache: "no-store" }).then((r) => r.json().then((data) => ({ ok: r.ok, data }))),
      fetch("/api/finance-benchmark", { cache: "no-store" }).then((r) => r.json().then((data) => ({ ok: r.ok, data: data as FinanceResponse }))),
    ])
      .then(([allocationResult, costResult, financeResult]) => {
        if (!allocationResult.ok || !allocationResult.data.ok) {
          throw new Error(allocationResult.data?.message ?? "수익시설 배분정보를 불러오지 못했습니다.");
        }
        if (!costResult.ok || !costResult.data.ok) {
          throw new Error(costResult.data?.message ?? "공사비 기준정보를 불러오지 못했습니다.");
        }

        const loadedRows = allocationResult.data.facilities ?? [];
        const loadedPool = allocationResult.data.commercialPoolGfaSqm ?? null;
        const loadedTotal = loadedRows.reduce((sum: number, row: FacilityRow) => sum + Number(row.ratio_pct || 0), 0);
        const loadedComplete = allocationResult.data.allocationComplete ?? Math.abs(loadedTotal - 100) < 0.000001;

        setRows(loadedRows);
        setScenario(allocationResult.data.scenario);
        setCommercialPoolGfaSqm(loadedPool);
        persistCommercialAllocation(ctx.pnu, loadedPool, loadedRows, loadedComplete);

        const costMap: Record<string, CostRow> = {};
        const inputMap: Record<string, number> = {};
        for (const cost of (costResult.data.costs ?? []) as CostRow[]) {
          costMap[cost.facilityCode] = cost;
          if (cost.defaultCostPerSqm != null) inputMap[cost.facilityCode] = cost.defaultCostPerSqm;
        }
        setCostDefaults(costMap);
        setCostInputs(inputMap);

        if (financeResult.ok && financeResult.data.ok) {
          setFinanceBenchmark(financeResult.data.benchmark ?? {});
          setFinanceNote(financeResult.data.note ?? "");
        }
      })
      .catch((e) => setMessage(e instanceof Error ? e.message : "조회 중 오류가 발생했습니다."))
      .finally(() => setLoading(false));
  }, []);

  function updateRatio(code: string, raw: string) {
    const nextValue = Math.max(0, Math.min(100, Number(raw || 0)));
    const current = rows.find((row) => row.facility_code === code)?.ratio_pct ?? 0;
    const nextTotal = total - current + nextValue;

    if (nextTotal > 100.000001) {
      setMessage(`합계가 100%를 넘을 수 없습니다. 현재 잔여 비율은 ${remaining.toFixed(1)}%입니다.`);
      return;
    }

    setMessage("");
    setRows((currentRows) => currentRows.map((row) =>
      row.facility_code === code ? { ...row, ratio_pct: nextValue } : row
    ));
  }

  function updateArea(code: string, raw: string) {
    if (commercialPoolGfaSqm == null || commercialPoolGfaSqm <= 0) {
      setMessage("수익시설 Pool 면적을 먼저 확인해야 합니다.");
      return;
    }
    const area = Math.max(0, Math.min(commercialPoolGfaSqm, Number(raw || 0)));
    const ratio = area / commercialPoolGfaSqm * 100;
    updateRatio(code, String(ratio));
  }

  function updateCost(code: string, raw: string) {
    const value = Math.max(0, Number(raw || 0));
    setCostInputs((current) => ({ ...current, [code]: value }));
  }

  function updatePfRate(raw: number) {
    const rounded = Math.round(Math.min(MAX_PF_RATE, Math.max(MIN_PF_RATE, raw)) * 10) / 10;
    setPfRatePct(rounded);
    try {
      sessionStorage.setItem("inrealtylab.pfRatePct", rounded.toFixed(1));
    } catch {
      // Continue even if browser storage is unavailable.
    }
  }

  function updateLtc(raw: number) {
    const rounded = Math.round(Math.min(MAX_LTC_PCT, Math.max(MIN_LTC_PCT, raw)));
    setLtcPct(rounded);
    try {
      sessionStorage.setItem("inrealtylab.ltcPct", String(rounded));
    } catch {
      // Continue even if browser storage is unavailable.
    }
  }

  async function save() {
    if (!/^\d{19}$/.test(pnu)) {
      setMessage("유효한 PNU가 없습니다.");
      return;
    }

    setLoading(true);
    setMessage("");
    try {
      const response = await fetch("/api/commercial-allocation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pnu,
          scenarioCode: "BASE",
          aboveGroundGfaSqm,
          allocations: rows.map((row) => ({
            facility_code: row.facility_code,
            ratio_pct: Number(row.ratio_pct || 0),
          })),
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data?.message ?? "저장에 실패했습니다.");
      persistCommercialAllocation(pnu, commercialPoolGfaSqm, rows, complete);
      setMessage(complete ? "수익시설 비율·면적이 100%로 확정되었습니다." : `저장되었습니다. 남은 비율 ${remaining.toFixed(1)}%를 배분해 주세요.`);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "저장 중 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  }

  if (!/^\d{19}$/.test(pnu)) return null;

  const baseRate = financeBenchmark.REFERENCE_RATE;
  const bankRate = financeBenchmark.BANK_LENDING_RATE;

  return (
    <section className="control-section commercial-allocation-section">
      <div className="control-section-title">
        <span>COMMERCIAL PROGRAM</span>
        <strong>수익시설 비율 · 면적 · 공사비 직접 검토</strong>
      </div>

      <div className="control-policy-card">
        <strong>배분 원칙</strong>
        <p>비율과 배분면적은 서로 연동됩니다. 면적을 직접 수정하면 비율이 자동 환산되고, 비율을 수정하면 면적이 자동 변경됩니다. 합계는 100%를 넘을 수 없습니다.</p>
      </div>

      <div className="metric-grid" style={{ marginBottom: 16 }}>
        <div><span>시나리오</span><strong>{scenario?.scenario_name ?? "균형형"}</strong></div>
        <div><span>수익시설 비중</span><strong>{scenario?.commercial_ratio_pct ?? 60}%</strong></div>
        <div><span>수익시설 Pool</span><strong>{commercialPoolGfaSqm ? `${Math.round(commercialPoolGfaSqm).toLocaleString("ko-KR")}㎡` : "확인 필요"}</strong></div>
      </div>

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", padding: 10 }}>시설</th>
              <th style={{ textAlign: "center", padding: 10 }}>법적 상태</th>
              <th style={{ textAlign: "right", padding: 10 }}>비율</th>
              <th style={{ textAlign: "right", padding: 10 }}>배분면적</th>
              <th style={{ textAlign: "right", padding: 10 }}>기본 공사비</th>
              <th style={{ textAlign: "right", padding: 10 }}>적용 공사비</th>
              <th style={{ textAlign: "right", padding: 10 }}>시설별 공사비</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const area = commercialPoolGfaSqm != null
                ? commercialPoolGfaSqm * Number(row.ratio_pct || 0) / 100
                : null;
              const defaultCost = costDefaults[row.facility_code]?.defaultCostPerSqm ?? null;
              const appliedCost = costInputs[row.facility_code] ?? defaultCost ?? 0;
              const facilityCost = area == null ? null : area * appliedCost;
              return (
                <tr key={row.facility_code} style={{ opacity: row.selectable ? 1 : 0.45 }}>
                  <td style={{ padding: 10 }}><strong>{row.category_code} · {row.category_name}</strong></td>
                  <td style={{ padding: 10, textAlign: "center" }}>{row.selectable ? (row.legal_status === "CONDITIONAL" ? "조건부" : "가능") : "불가/미확인"}</td>
                  <td style={{ padding: 10, textAlign: "right" }}>
                    <input type="number" min={0} max={100} step={0.1} value={Number(row.ratio_pct || 0)} disabled={!row.selectable} onChange={(e) => updateRatio(row.facility_code, e.target.value)} style={{ width: 82, textAlign: "right" }} /> %
                  </td>
                  <td style={{ padding: 10, textAlign: "right" }}>
                    <input type="number" min={0} step={1} value={area == null ? "" : Math.round(area)} disabled={!row.selectable || commercialPoolGfaSqm == null} onChange={(e) => updateArea(row.facility_code, e.target.value)} style={{ width: 112, textAlign: "right" }} /> ㎡
                  </td>
                  <td style={{ padding: 10, textAlign: "right" }}>{defaultCost == null ? "-" : `${Math.round(defaultCost).toLocaleString("ko-KR")}원/㎡`}</td>
                  <td style={{ padding: 10, textAlign: "right" }}>
                    <input type="number" min={0} step={10000} value={Math.round(appliedCost)} disabled={!row.selectable} onChange={(e) => updateCost(row.facility_code, e.target.value)} style={{ width: 122, textAlign: "right" }} />
                  </td>
                  <td style={{ padding: 10, textAlign: "right" }}>{facilityCost == null ? "미확정" : `${Math.round(facilityCost / 100000000).toLocaleString("ko-KR")}억원`}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="control-policy-card" style={{ marginTop: 16 }}>
        <strong>합계 {total.toFixed(1)}% · 잔여 {remaining.toFixed(1)}%</strong>
        <p>{complete ? "100% 배분 완료 — 시설별 연면적과 사업비를 확정할 수 있습니다." : "비율 또는 면적을 직접 입력해 100%까지 배분해 주세요."}</p>
        <p>공사비 기본값은 현재 DB의 대표 벤치마크 평균을 VAT 제외 기준으로 통일한 값이며, 사용자가 직접 수정할 수 있습니다.</p>
        <button type="button" onClick={save} disabled={loading}>{loading ? "저장 중" : "비율·면적 저장"}</button>
      </div>

      {directConstructionCost != null && totalProjectCost != null && (
        <div className="control-policy-card" style={{ marginTop: 12 }}>
          <strong>총사업비 {Math.round(totalProjectCost / 100000000).toLocaleString("ko-KR")}억원</strong>
          <dl style={{ marginTop: 12 }}>
            <div><dt>직접 공사비</dt><dd>{Math.round(directConstructionCost / 100000000).toLocaleString("ko-KR")}억원</dd></div>
            <div><dt>간접비</dt><dd>{Math.round((indirectCost ?? 0) / 100000000).toLocaleString("ko-KR")}억원 · 공사비의 10%</dd></div>
            <div><dt>예비비</dt><dd>{Math.round((contingencyCost ?? 0) / 100000000).toLocaleString("ko-KR")}억원 · 공사비의 10%</dd></div>
          </dl>
          <p>총사업비 = 직접 공사비 × 1.20으로 자동 계산합니다. 예: 공사비 200억원 → 간접비 20억원 + 예비비 20억원 → 총사업비 240억원.</p>
        </div>
      )}

      <div className="control-policy-card" style={{ marginTop: 12 }}>
        <strong>PF 대출비율(LTC) {ltcPct}%</strong>
        <p>기본 75% · 선택범위 70~80% · 1% 단위. 대출금액은 총사업비 × LTC로 자동 계산합니다.</p>
        <input
          type="range"
          min={MIN_LTC_PCT}
          max={MAX_LTC_PCT}
          step={LTC_STEP}
          value={ltcPct}
          onChange={(e) => updateLtc(Number(e.target.value))}
          style={{ width: "100%" }}
        />
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginTop: 4 }}><span>70%</span><span>75%</span><span>80%</span></div>
        {pfLoanAmount != null && <p style={{ marginTop: 10 }}><strong>PF 대출금액 {Math.round(pfLoanAmount / 100000000).toLocaleString("ko-KR")}억원</strong> · 총사업비 {Math.round((totalProjectCost ?? 0) / 100000000).toLocaleString("ko-KR")}억원 × {ltcPct}%</p>}
      </div>

      <div className="control-policy-card" style={{ marginTop: 12 }}>
        <strong>PF 적용금리 {pfRatePct.toFixed(1)}%</strong>
        <p>기본 7.0% · 선택범위 5.0~9.0% · 0.1% 단위. 선택한 금리는 Part 3 DSCR 계산에 직접 적용됩니다.</p>
        <input
          type="range"
          min={MIN_PF_RATE}
          max={MAX_PF_RATE}
          step={PF_RATE_STEP}
          value={pfRatePct}
          onChange={(e) => updatePfRate(Number(e.target.value))}
          style={{ width: "100%" }}
        />
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginTop: 4 }}><span>5.0%</span><span>7.0%</span><span>9.0%</span></div>
        <div style={{ marginTop: 12, fontSize: 13, lineHeight: 1.6 }}>
          {baseRate?.valueMid != null && <div>참고 · 한국은행 기준금리 {baseRate.valueMid.toFixed(2)}% ({baseRate.baseDate ?? "기준일 미상"})</div>}
          {bankRate?.valueMid != null && <div>참고 · 국내 은행 평균 대출금리 {bankRate.valueMid.toFixed(2)}% ({bankRate.baseDate ?? "기준일 미상"}) · PF 전용 금리 아님</div>}
          {financeNote && <div>{financeNote}</div>}
        </div>
      </div>

      {message && <div className="control-warning" style={{ marginTop: 12 }}>{message}</div>}
    </section>
  );
}
