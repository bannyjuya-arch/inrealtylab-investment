"use client";

import { useEffect, useMemo, useState } from "react";
import {
  COMMERCIAL_CATEGORIES,
  CONCESSION_TERMS,
  DEVELOPMENT_SCENARIOS,
  buildIntegratedAnalysis,
  formatGfa,
  formatPercent,
  formatWon,
  type CommercialCategoryKey,
  type DemandInputs,
  type FinancialAssumptions,
} from "../../lib/integrated-report";
import "./report.css";

type Part1Snapshot = {
  capturedAt?: string;
  pnus?: string[];
  siteAreaSqm?: number | null;
  primaryZone?: string | null;
  statutoryFarMaxPct?: number | null;
  statutoryBcrMaxPct?: number | null;
  scenarios?: Array<{
    label: string;
    bcrPct: number | null;
    farPct: number | null;
    footprintSqm: number | null;
    grossFloorAreaSqm: number | null;
  }>;
};

type OwnershipRecord = {
  pnu: string;
  legalDong: string;
  jibun: string;
  landCategory: string;
  areaSqm: number | null;
  officialLandPrice: number | null;
  ownerClass: string;
  ownerSector: "PUBLIC" | "PRIVATE" | "UNKNOWN";
  ownerTypeLabel: string;
  nationalInstitutionClass?: string | null;
  coOwnerCount: number;
  dataDate: string | null;
};

type OwnershipResponse = {
  ok: boolean;
  message?: string;
  records?: OwnershipRecord[];
  assessment?: {
    inScope: boolean;
    readiness: string;
    headline: string;
    summary: string;
    governingRegime?: string;
    ownerClasses: string[];
    ownerTypes: string[];
    assetClass?: string;
    assetClassBasis?: string;
    candidateRoutes: string[];
    unresolved: string[];
  };
  source?: { name: string; queriedAt: string; totalCount: number };
};

type OwnershipParcel = { pnu: string; result: OwnershipResponse };

const emptyDemand: DemandInputs = {
  publicRequiredGfa: null,
  commercialSupportableGfa: Object.fromEntries(
    COMMERCIAL_CATEGORIES.map((item) => [item.key, null])
  ) as Partial<Record<CommercialCategoryKey, number | null>>,
};

const initialAssumptions: FinancialAssumptions = {
  basementRatioPct: null,
  constructionCostPerSqm: null,
  monthlyRentPerSqm: null,
  occupancyPct: 90,
  opexPct: null,
  referenceRatePct: null,
  pfSpreadPct: null,
  debtRatioPct: null,
  debtTenorYears: null,
  investorRequiredReturnPct: null,
  otherAnnualRevenue: null,
};

function toNumber(value: string) {
  if (!value.trim()) return null;
  const number = Number(value.replace(/,/g, ""));
  return Number.isFinite(number) ? number : null;
}

function pct(value: number | null) {
  return value === null ? "-" : `${(value * 100).toLocaleString("ko-KR", { maximumFractionDigits: 2 })}%`;
}

function statusClass(status: string) {
  return status.toLowerCase();
}

function demandFitLabel(status: string) {
  if (status === "SHORT") return "부족";
  if (status === "EXACT") return "적합";
  if (status === "EXCESS") return "여유";
  return "검토";
}

export default function IntegratedReportPage() {
  const [snapshot, setSnapshot] = useState<Part1Snapshot>({});
  const [ownership, setOwnership] = useState<OwnershipParcel[]>([]);
  const [loadingOwnership, setLoadingOwnership] = useState(false);
  const [demand, setDemand] = useState<DemandInputs>(emptyDemand);
  const [assumptions, setAssumptions] = useState<FinancialAssumptions>(initialAssumptions);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem("inrealtylab.part1Snapshot");
      if (raw) setSnapshot(JSON.parse(raw));
    } catch {
      setSnapshot({});
    }

    const params = new URLSearchParams(window.location.search);
    const pnus = (params.get("pnus") ?? params.get("pnu") ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter((item) => /^\d{19}$/.test(item));

    if (!pnus.length) return;
    setLoadingOwnership(true);
    Promise.all(
      pnus.map(async (pnu) => {
        try {
          const response = await fetch(`/api/ownership?pnu=${encodeURIComponent(pnu)}`, { cache: "no-store" });
          const result = (await response.json()) as OwnershipResponse;
          return { pnu, result };
        } catch (error) {
          return {
            pnu,
            result: {
              ok: false,
              message: error instanceof Error ? error.message : "소유정보 조회 실패",
            },
          };
        }
      })
    ).then(setOwnership).finally(() => setLoadingOwnership(false));
  }, []);

  const ownershipRecords = useMemo(
    () => ownership.flatMap((item) => item.result.records ?? []),
    [ownership]
  );

  const officialLandValue = useMemo(() => {
    const rows = ownershipRecords.filter(
      (record) => record.areaSqm !== null && record.officialLandPrice !== null
    );
    if (!rows.length) return null;
    return rows.reduce((sum, record) => sum + (record.areaSqm ?? 0) * (record.officialLandPrice ?? 0), 0);
  }, [ownershipRecords]);

  const siteAreaSqm = snapshot.siteAreaSqm ?? (
    ownershipRecords.length
      ? ownershipRecords.reduce((sum, record) => sum + (record.areaSqm ?? 0), 0)
      : null
  );

  const analysis = useMemo(
    () => buildIntegratedAnalysis({
      siteAreaSqm,
      farMaxPct: snapshot.statutoryFarMaxPct ?? null,
      officialLandValue,
      demand,
      assumptions,
    }),
    [siteAreaSqm, snapshot.statutoryFarMaxPct, officialLandValue, demand, assumptions]
  );

  const ownershipGate = useMemo(() => {
    if (!ownership.length || loadingOwnership) return "REVIEW" as const;
    if (ownership.some((item) => !item.result.ok)) return "REVIEW" as const;
    if (ownership.some((item) => item.result.records?.some((record) => record.ownerSector === "PRIVATE"))) return "FAIL" as const;
    if (ownership.every((item) => item.result.assessment?.inScope)) return "PASS" as const;
    return "REVIEW" as const;
  }, [ownership, loadingOwnership]);

  const recommendation = useMemo(() => {
    const fitRank: Record<string, number> = { BASE: 0, CONSERVATIVE: 1, POSITIVE: 2 };
    const viable = analysis.financialMatrix
      .filter((cell) => {
        const capacity = analysis.capacities.find((item) => item.key === cell.scenarioKey);
        if (!capacity || capacity.demandFit === "SHORT" || capacity.demandFit === "REVIEW") return false;
        return cell.btoBotStatus === "PASS" || cell.btoBotStatus === "STRONG" || cell.reitsStatus === "PASS";
      })
      .sort((a, b) => {
        const scenario = fitRank[a.scenarioKey] - fitRank[b.scenarioKey];
        if (scenario !== 0) return scenario;
        return a.term - b.term;
      });
    return viable[0] ?? null;
  }, [analysis]);

  const finalDecision = useMemo(() => {
    if (ownershipGate === "FAIL") return { status: "FAIL", title: "사업추진 대상 제외", detail: "선택 필지에 민간소유가 포함되어 현재 공공부지 PPP 검토대상에서 제외됩니다." };
    if (ownershipGate !== "PASS") return { status: "REVIEW", title: "소유·협의구조 추가 확인", detail: "공공소유 또는 협의대상 확인이 완료되어야 사업추진 여부를 판정할 수 있습니다." };
    if (analysis.fullDemandGfa === null) return { status: "REVIEW", title: "수요 데이터 입력 필요", detail: "PUBLIC 필요면적과 COMMERCIAL 흡수가능면적을 입력·연결하면 개발규모 적합성을 판정합니다." };
    if (!recommendation) return { status: "REVIEW", title: "사업조건 조정 필요", detail: "현재 입력조건에서는 수요 적합성과 금융기준을 동시에 충족하는 조합이 확인되지 않았습니다." };
    return { status: "PASS", title: "사업추진 검토 가능", detail: `${recommendation.scenarioLabel} 개발안 / ${recommendation.term}년 조건에서 수요 적합성과 최소 한 가지 금융구조 기준을 충족합니다.` };
  }, [ownershipGate, analysis.fullDemandGfa, recommendation]);

  function updateAssumption(key: keyof FinancialAssumptions, value: string | number) {
    const numeric = typeof value === "number" ? value : toNumber(value);
    setAssumptions((current) => ({ ...current, [key]: numeric }));
  }

  function updateCommercial(key: CommercialCategoryKey, value: string) {
    setDemand((current) => ({
      ...current,
      commercialSupportableGfa: {
        ...current.commercialSupportableGfa,
        [key]: toNumber(value),
      },
    }));
  }

  const primaryAddress = ownershipRecords[0]
    ? `${ownershipRecords[0].legalDong} ${ownershipRecords[0].jibun}`.trim()
    : "선택 대지";

  return (
    <main className="report-shell">
      <div className="report-toolbar no-print">
        <div>
          <strong>INRealtyLab · Integrated Executive Review</strong>
          <div className="report-source">Part 1 → Part 2 → Part 3 통합 약식검토</div>
        </div>
        <div className="report-toolbar-actions">
          <button className="report-btn" onClick={() => history.back()}>이전</button>
          <button className="report-btn primary" onClick={() => window.print()}>3장 보고서 인쇄 / PDF</button>
        </div>
      </div>

      <section className="report-page">
        <div className="report-kicker">01 · SITE / LEGAL STATUS</div>
        <h1 className="report-title">{primaryAddress} 사업추진 약식검토</h1>
        <p className="report-subtitle">지도·대지현황과 법적 개발가능 규모를 Part 1 분석결과에서 연결합니다.</p>

        <div className="report-grid">
          <div className="report-map-placeholder">
            <div>
              <strong>선택 필지 지도영역</strong>
              <span>Part 1에서 선택한 지적필지 {snapshot.pnus?.length ?? ownership.length || "-"}개<br />PNU 기준 분석결과 연계</span>
            </div>
          </div>
          <div className="report-card">
            <h3>대지 개요</h3>
            <div className="report-metric"><span>소재지</span><strong>{primaryAddress}</strong></div>
            <div className="report-metric"><span>대지면적</span><strong>{formatGfa(siteAreaSqm)}</strong></div>
            <div className="report-metric"><span>주요 용도지역</span><strong>{snapshot.primaryZone ?? "확인 필요"}</strong></div>
            <div className="report-metric"><span>법정 건폐율 상한</span><strong>{formatPercent(snapshot.statutoryBcrMaxPct ?? null)}</strong></div>
            <div className="report-metric"><span>법정 용적률 상한</span><strong>{formatPercent(snapshot.statutoryFarMaxPct ?? null)}</strong></div>
            <div className="report-metric"><span>공시지가 기준 토지가치</span><strong>{formatWon(officialLandValue)}</strong></div>
            <div className="report-metric"><span>연간 토지사용료</span><strong>{formatWon(analysis.annualLandFee)}</strong></div>
          </div>
        </div>

        <div className="report-section">
          <div className="report-section-head"><div><span>PART 1</span><br /><strong>개발가능 규모 3개 시나리오</strong></div></div>
          <table className="report-table">
            <thead><tr><th>구분</th><th>보수</th><th>중간</th><th>긍정</th></tr></thead>
            <tbody>
              <tr><td className="left">적용 FAR</td>{analysis.capacities.map((item) => <td key={item.key}>{snapshot.statutoryFarMaxPct ? formatPercent(snapshot.statutoryFarMaxPct * item.factor) : "-"}</td>)}</tr>
              <tr><td className="left">지상 개발가능 GFA</td>{analysis.capacities.map((item) => <td key={item.key}>{formatGfa(item.aboveGroundGfa || null)}</td>)}</tr>
              <tr><td className="left">지하 GFA</td>{analysis.capacities.map((item) => <td key={item.key}>{formatGfa(item.undergroundGfa)}</td>)}</tr>
              <tr><td className="left">총 공사 GFA</td>{analysis.capacities.map((item) => <td key={item.key}>{formatGfa(item.totalConstructionGfa)}</td>)}</tr>
            </tbody>
          </table>
          <div className="report-note">지상 GFA는 시설 수용능력 판단에 사용하고, 지하를 포함한 총 공사 GFA는 사업비 산정에 사용합니다. 지하비율은 유사사례 DB 연결 전까지 담당자 입력값으로 둡니다.</div>
        </div>

        <div className="report-section no-print">
          <div className="report-section-head"><div><span>PROJECT ASSUMPTIONS</span><br /><strong>사업비·운영·금융 입력</strong></div></div>
          <div className="report-form-grid">
            <Field label="지하/지상 비율 %" value={assumptions.basementRatioPct} onChange={(v) => updateAssumption("basementRatioPct", v)} />
            <Field label="표준공사비 원/㎡" value={assumptions.constructionCostPerSqm} onChange={(v) => updateAssumption("constructionCostPerSqm", v)} />
            <Field label="시장 임대료 원/㎡·월" value={assumptions.monthlyRentPerSqm} onChange={(v) => updateAssumption("monthlyRentPerSqm", v)} />
            <Field label="OPEX / 매출 %" value={assumptions.opexPct} onChange={(v) => updateAssumption("opexPct", v)} />
            <Field label="시장 기준금리 %" value={assumptions.referenceRatePct} onChange={(v) => updateAssumption("referenceRatePct", v)} />
            <Field label="PF Spread %" value={assumptions.pfSpreadPct} onChange={(v) => updateAssumption("pfSpreadPct", v)} />
            <Field label="Debt Ratio %" value={assumptions.debtRatioPct} onChange={(v) => updateAssumption("debtRatioPct", v)} />
            <Field label="Debt Tenor 년" value={assumptions.debtTenorYears} onChange={(v) => updateAssumption("debtTenorYears", v)} />
            <Field label="출자자 요구수익률 %" value={assumptions.investorRequiredReturnPct} onChange={(v) => updateAssumption("investorRequiredReturnPct", v)} />
          </div>
          <div className="report-field" style={{ marginTop: 12 }}>
            <label>가동률 {assumptions.occupancyPct}% · 담당자 조정 80~95%, 1% 단위</label>
            <input type="range" min={80} max={95} step={1} value={assumptions.occupancyPct} onChange={(event) => updateAssumption("occupancyPct", Number(event.target.value))} />
          </div>
        </div>

        <div className="report-footer-note">본 보고서는 초기 사업검토용 약식자료이며, 상세 법률·건축·감정평가·금융 실사 전 단계의 의사결정 지원자료입니다.</div>
        <div className="report-page-number">1 / 3</div>
      </section>

      <section className="report-page">
        <div className="report-kicker">02 · OWNERSHIP / DEMAND</div>
        <h2 className="report-title">소유·협의대상과 시설수요 적합성</h2>
        <p className="report-subtitle">Part 2 소유권 확인결과와 Part 3 수요엔진의 시설별 필요·흡수가능 연면적을 연결합니다.</p>

        <div className="report-grid">
          <div className="report-card">
            <h3>소유권 Gate</h3>
            <div className="report-metric"><span>현재 판정</span><strong><span className={`report-status ${ownershipGate === "PASS" ? "pass" : ownershipGate === "FAIL" ? "fail" : "review"}`}>{ownershipGate}</span></strong></div>
            <div className="report-owner-list">
              {ownershipRecords.length ? ownershipRecords.map((record, index) => (
                <div className="report-owner-row" key={`${record.pnu}-${index}`}>
                  <strong>{record.ownerTypeLabel} · {record.ownerClass}</strong>
                  <span>{record.legalDong} {record.jibun} · {record.areaSqm ? formatGfa(record.areaSqm) : "면적 확인 필요"}</span>
                </div>
              )) : <p>{loadingOwnership ? "소유정보 조회 중..." : "소유정보 확인 필요"}</p>}
            </div>
          </div>
          <div className="report-card">
            <h3>협의대상자</h3>
            <p><strong>1차:</strong> 토지 소유기관</p>
            <p><strong>2차:</strong> 재산관리관·관리권자·운영주체</p>
            <p><strong>3차:</strong> 관리·처분·개발 의사결정권자</p>
            <div className="report-warning">현재 공개 소유정보만으로 실제 기관명·재산관리관을 확정할 수 없는 경우 “확인 필요”로 유지합니다. 개인정보는 보고서에 표시하지 않습니다.</div>
          </div>
        </div>

        <div className="report-section no-print">
          <div className="report-section-head"><div><span>DEMAND ENGINE</span><br /><strong>시설별 연면적 입력 / DB 연결 슬롯</strong></div></div>
          <div className="report-demand-grid">
            <Field label="PUBLIC Required GFA ㎡" value={demand.publicRequiredGfa} onChange={(value) => setDemand((current) => ({ ...current, publicRequiredGfa: toNumber(value) }))} />
            {COMMERCIAL_CATEGORIES.map((item) => (
              <Field key={item.key} label={`${item.label} Supportable GFA ㎡`} value={demand.commercialSupportableGfa[item.key] ?? null} onChange={(value) => updateCommercial(item.key, value)} />
            ))}
          </div>
        </div>

        <div className="report-section">
          <div className="report-section-head"><div><span>DEMAND FIT</span><br /><strong>Part 1 공급가능 면적 vs Part 3 수요시설 면적</strong></div></div>
          <table className="report-table">
            <thead><tr><th>개발안</th><th>지상 개발가능 GFA</th><th>수요시설 GFA</th><th>여유 / 부족</th><th>판정</th></tr></thead>
            <tbody>
              {analysis.capacities.map((item) => (
                <tr key={item.key}>
                  <td>{item.label}</td>
                  <td>{formatGfa(item.aboveGroundGfa || null)}</td>
                  <td>{formatGfa(item.fullDemandGfa)}</td>
                  <td>{item.demandGapGfa === null ? "-" : `${item.demandGapGfa >= 0 ? "+" : ""}${formatGfa(item.demandGapGfa)}`}</td>
                  <td><span className={`report-status ${statusClass(item.demandFit)}`}>{demandFitLabel(item.demandFit)}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="report-section">
          <div className="report-section-head"><div><span>COST</span><br /><strong>개발규모별 총 공사비</strong></div></div>
          <table className="report-table">
            <thead><tr><th>개발안</th><th>총 공사 GFA</th><th>적용 표준공사비</th><th>Construction CAPEX</th></tr></thead>
            <tbody>{analysis.capacities.map((item) => <tr key={item.key}><td>{item.label}</td><td>{formatGfa(item.totalConstructionGfa)}</td><td>{assumptions.constructionCostPerSqm ? `${assumptions.constructionCostPerSqm.toLocaleString("ko-KR")}원/㎡` : "DB 연결/입력 필요"}</td><td>{formatWon(item.constructionCapex)}</td></tr>)}</tbody>
          </table>
        </div>

        <div className="report-note">PUBLIC은 Required GFA, COMMERCIAL은 Supportable GFA로 계산합니다. 현재 화면의 입력칸은 수요엔진 DB/API가 연결되면 자동값으로 대체되며, 원자료와 기준일을 함께 저장하도록 설계합니다.</div>
        <div className="report-page-number">2 / 3</div>
      </section>

      <section className="report-page">
        <div className="report-kicker">03 · PPP FEASIBILITY / GO-NO GO</div>
        <h2 className="report-title">사업성 매트릭스와 사업추진 여부</h2>
        <p className="report-subtitle">토지매입비 0, 공시지가 기준 연 1% 토지사용료, 사업기간 30·40·50년을 공통조건으로 비교합니다.</p>

        <div className="report-grid three">
          <div className="report-card"><h3>토지</h3><div className="report-metric"><span>공시지가 기준 가치</span><strong>{formatWon(officialLandValue)}</strong></div><div className="report-metric"><span>연 사용료율</span><strong>1.00%</strong></div><div className="report-metric"><span>연 사용료</span><strong>{formatWon(analysis.annualLandFee)}</strong></div></div>
          <div className="report-card"><h3>BTO / BOT</h3><p>Minimum DSCR 기준</p><div className="report-metric"><span>PF PASS</span><strong>≥ 1.20</strong></div><div className="report-metric"><span>STRONG</span><strong>≥ 1.30</strong></div></div>
          <div className="report-card"><h3>REITs</h3><p>Project IRR 기준</p><div className="report-metric"><span>PASS</span><strong>≥ 6.0%</strong></div><div className="report-metric"><span>출자자 요구수익률</span><strong>{assumptions.investorRequiredReturnPct ? `${assumptions.investorRequiredReturnPct}%` : "별도 입력"}</strong></div></div>
        </div>

        <div className="report-section">
          <div className="report-section-head"><div><span>BTO / BOT MATRIX</span><br /><strong>Minimum DSCR</strong></div></div>
          <MatrixTable mode="BTO" analysis={analysis} />
        </div>

        <div className="report-section">
          <div className="report-section-head"><div><span>REITs MATRIX</span><br /><strong>Project IRR</strong></div></div>
          <MatrixTable mode="REITS" analysis={analysis} />
        </div>

        <div className="report-section report-verdict">
          <span className={`report-status ${finalDecision.status === "PASS" ? "pass" : finalDecision.status === "FAIL" ? "fail" : "review"}`}>{finalDecision.status}</span>
          <strong>{finalDecision.title}</strong>
          <p>{finalDecision.detail}</p>
          {recommendation && (
            <p><b>우선 검토 조합:</b> {recommendation.scenarioLabel} 개발안 / {recommendation.term}년 · BTO/BOT {recommendation.btoBotStatus} · REITs {recommendation.reitsStatus}</p>
          )}
        </div>

        <div className="report-note">사업기간 종료 시 건물·시설 기부채납, Terminal Value = 0을 전제로 합니다. 실제 PF 가능 여부는 금융기관 약정, 담보·보증, 금리, Debt sizing 및 시설별 현금흐름 정밀검토 후 확정합니다.</div>
        <div className="report-footer-note">데이터 자동연결 예정: 표준공사비, 상업용부동산 시세·리서치/IM DB, 시장금리, 시설별 수요 DB, 지하비율 Benchmark DB.</div>
        <div className="report-page-number">3 / 3</div>
      </section>
    </main>
  );
}

function Field({ label, value, onChange }: { label: string; value: number | null; onChange: (value: string) => void }) {
  return (
    <div className="report-field">
      <label>{label}</label>
      <input inputMode="decimal" value={value ?? ""} onChange={(event) => onChange(event.target.value)} placeholder="자동연결 / 직접입력" />
    </div>
  );
}

function MatrixTable({ mode, analysis }: { mode: "BTO" | "REITS"; analysis: ReturnType<typeof buildIntegratedAnalysis> }) {
  return (
    <table className="report-table">
      <thead><tr><th>개발규모</th>{CONCESSION_TERMS.map((term) => <th key={term}>{term}년</th>)}</tr></thead>
      <tbody>
        {DEVELOPMENT_SCENARIOS.map((scenario) => (
          <tr key={scenario.key}>
            <td>{scenario.label}</td>
            {CONCESSION_TERMS.map((term) => {
              const cell = analysis.financialMatrix.find((item) => item.scenarioKey === scenario.key && item.term === term);
              if (!cell) return <td key={term}>-</td>;
              const status = mode === "BTO" ? cell.btoBotStatus : cell.reitsStatus;
              return (
                <td key={term}>
                  <span className="matrix-value">{mode === "BTO" ? (cell.dscr?.toFixed(2) ?? "-") : pct(cell.projectIrr)}</span>
                  <span className={`report-status ${statusClass(status)}`}>{status}</span>
                  {mode === "REITS" && cell.investorReturnSatisfied !== null && <div className="matrix-sub">출자자 기준 {cell.investorReturnSatisfied ? "충족" : "미충족"}</div>}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
