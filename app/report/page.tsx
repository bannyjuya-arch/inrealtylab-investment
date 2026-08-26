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
  pnus?: string[];
  siteAreaSqm?: number | null;
  primaryZone?: string | null;
  statutoryFarMaxPct?: number | null;
  statutoryBcrMaxPct?: number | null;
};

type OwnershipRecord = {
  pnu: string;
  legalDong: string;
  jibun: string;
  areaSqm: number | null;
  officialLandPrice: number | null;
  ownerClass: string;
  ownerSector: "PUBLIC" | "PRIVATE" | "UNKNOWN";
  ownerTypeLabel: string;
};

type OwnershipResponse = {
  ok: boolean;
  message?: string;
  records?: OwnershipRecord[];
  assessment?: { inScope: boolean; unresolved?: string[] };
};

type OwnershipParcel = { pnu: string; result: OwnershipResponse };

type LandPriceResponse = {
  ok: boolean;
  pnu?: string;
  pricePerSqm?: number | null;
  standardYear?: string | null;
  message?: string;
  source?: { name?: string; provider?: string; unit?: string };
};

type LandPriceParcel = { pnu: string; result: LandPriceResponse };

type FloorSummary = {
  basementAreaSqm: number;
  aboveGroundAreaSqm: number;
  basementRatioPct: number | null;
};

type FloorResponse = {
  ok: boolean;
  summary?: FloorSummary;
  message?: string;
  source?: { name?: string; endpoint?: string };
};

type FloorParcel = { pnu: string; result: FloorResponse };

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

function parseNumber(value: string) {
  if (!value.trim()) return null;
  const parsed = Number(value.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function irrText(value: number | null) {
  return value === null ? "-" : `${(value * 100).toFixed(2)}%`;
}

function statusTone(value: string) {
  if (value === "PASS" || value === "ELIGIBLE") return "pass";
  if (value === "STRONG") return "strong";
  if (value === "CONDITIONAL") return "conditional";
  if (value === "FAIL" || value === "NOT_ELIGIBLE") return "fail";
  if (value === "SHORT") return "short";
  if (value === "EXCESS") return "excess";
  if (value === "EXACT") return "fit";
  return "review";
}

function parsePnuForBuildingHub(pnu: string) {
  if (!/^\d{19}$/.test(pnu)) return null;
  const landFlag = pnu.slice(10, 11);
  const platGbCd = landFlag === "2" ? "1" : "0";
  return {
    sigunguCd: pnu.slice(0, 5),
    bjdongCd: pnu.slice(5, 10),
    platGbCd,
    bun: pnu.slice(11, 15),
    ji: pnu.slice(15, 19),
  };
}

export default function ReportPage() {
  const [snapshot, setSnapshot] = useState<Part1Snapshot>({});
  const [ownership, setOwnership] = useState<OwnershipParcel[]>([]);
  const [landPrices, setLandPrices] = useState<LandPriceParcel[]>([]);
  const [floorData, setFloorData] = useState<FloorParcel[]>([]);
  const [basementAutoApplied, setBasementAutoApplied] = useState(false);
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
    const pnus = [...new Set((params.get("pnus") ?? params.get("pnu") ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter((item) => /^\d{19}$/.test(item)))];

    if (!pnus.length) return;

    Promise.all(
      pnus.map(async (pnu) => {
        try {
          const response = await fetch(`/api/ownership?pnu=${encodeURIComponent(pnu)}`, { cache: "no-store" });
          return { pnu, result: (await response.json()) as OwnershipResponse };
        } catch (error) {
          return { pnu, result: { ok: false, message: error instanceof Error ? error.message : "소유정보 조회 실패" } };
        }
      })
    ).then(setOwnership);

    Promise.all(
      pnus.map(async (pnu) => {
        try {
          const response = await fetch(`/api/land-price?pnu=${encodeURIComponent(pnu)}`, { cache: "no-store" });
          return { pnu, result: (await response.json()) as LandPriceResponse };
        } catch (error) {
          return { pnu, result: { ok: false, message: error instanceof Error ? error.message : "개별공시지가 조회 실패" } };
        }
      })
    ).then(setLandPrices);

    Promise.all(
      pnus.map(async (pnu) => {
        const parsed = parsePnuForBuildingHub(pnu);
        if (!parsed) return { pnu, result: { ok: false, message: "PNU 해석 실패" } as FloorResponse };
        const query = new URLSearchParams(parsed);
        try {
          const response = await fetch(`/api/building-hub/floors?${query.toString()}`, { cache: "no-store" });
          return { pnu, result: (await response.json()) as FloorResponse };
        } catch (error) {
          return { pnu, result: { ok: false, message: error instanceof Error ? error.message : "건축HUB 층별 조회 실패" } };
        }
      })
    ).then(setFloorData);
  }, []);

  const records = useMemo(() => ownership.flatMap((item) => item.result.records ?? []), [ownership]);
  const siteAreaSqm = snapshot.siteAreaSqm ?? (records.length ? records.reduce((sum, row) => sum + (row.areaSqm ?? 0), 0) : null);

  const landPriceByPnu = useMemo(() => new Map(
    landPrices
      .filter((item) => item.result.ok && item.result.pricePerSqm !== null && item.result.pricePerSqm !== undefined)
      .map((item) => [item.pnu, item.result.pricePerSqm as number])
  ), [landPrices]);

  const landPriceYears = useMemo(() => [...new Set(
    landPrices.map((item) => item.result.standardYear).filter((value): value is string => Boolean(value))
  )], [landPrices]);

 const officialLandValue = useMemo(() => {
  if (!landPriceByPnu.size) {
    const usable = records.filter((row) => row.areaSqm !== null && row.officialLandPrice !== null);
    if (!usable.length) return null;
    const unique = new Map<string, OwnershipRecord>();
    for (const row of usable) if (!unique.has(row.pnu)) unique.set(row.pnu, row);
    return [...unique.values()].reduce((sum, row) => sum + (row.areaSqm ?? 0) * (row.officialLandPrice ?? 0), 0);
  }

  const areaByPnu = new Map<string, number>();
  for (const row of records) {
    if (row.areaSqm !== null && row.areaSqm > 0 && !areaByPnu.has(row.pnu)) areaByPnu.set(row.pnu, row.areaSqm);
  }

  let total = 0;
  let matched = 0;
  for (const [pnu, price] of landPriceByPnu) {
    const area = areaByPnu.get(pnu);
    if (area === undefined) continue;
    total += area * price;
    matched += 1;
  }

  // 필지별 면적(ownership API)이 전부 확보된 경우 → 필지별 가중합이 가장 정확하니 그대로 사용
  if (matched === landPriceByPnu.size) return total;

  // 필지별 면적 매칭에 실패했더라도, 조회된 공시지가 단가가 전부 동일하면
  // 통합 대지면적(siteAreaSqm) × 단가로 근사 계산한다.
  // (인접 필지는 같은 법정동/고시구역이면 개별공시지가가 동일한 경우가 흔함)
  const prices = [...landPriceByPnu.values()];
  const allSamePrice = prices.every((p) => p === prices[0]);
  if (allSamePrice && siteAreaSqm !== null) {
    return siteAreaSqm * prices[0];
  }

  return matched ? total : null;
}, [landPriceByPnu, records, siteAreaSqm]);

  const basementReference = useMemo(() => {
    const valid = floorData
      .map((item) => item.result.summary)
      .filter((summary): summary is FloorSummary => Boolean(summary && summary.aboveGroundAreaSqm > 0 && summary.basementRatioPct !== null));
    if (!valid.length) return null;
    const above = valid.reduce((sum, item) => sum + item.aboveGroundAreaSqm, 0);
    const below = valid.reduce((sum, item) => sum + item.basementAreaSqm, 0);
    return {
      ratioPct: above > 0 ? (below / above) * 100 : null,
      basementAreaSqm: below,
      aboveGroundAreaSqm: above,
      sampleCount: valid.length,
    };
  }, [floorData]);

  useEffect(() => {
    if (basementAutoApplied || assumptions.basementRatioPct !== null || basementReference?.ratioPct === null || basementReference?.ratioPct === undefined) return;
    setAssumptions((current) => current.basementRatioPct === null
      ? { ...current, basementRatioPct: Number(basementReference.ratioPct?.toFixed(2)) }
      : current);
    setBasementAutoApplied(true);
  }, [basementAutoApplied, assumptions.basementRatioPct, basementReference]);

  const analysis = useMemo(() => buildIntegratedAnalysis({
    siteAreaSqm,
    farMaxPct: snapshot.statutoryFarMaxPct ?? null,
    officialLandValue,
    demand,
    assumptions,
  }), [siteAreaSqm, snapshot.statutoryFarMaxPct, officialLandValue, demand, assumptions]);

  const ownershipGate = useMemo(() => {
    if (!ownership.length) return "REVIEW";
    if (ownership.some((item) => !item.result.ok)) return "REVIEW";
    if (records.some((row) => row.ownerSector === "PRIVATE")) return "FAIL";
    if (ownership.every((item) => item.result.assessment?.inScope)) return "PASS";
    return "REVIEW";
  }, [ownership, records]);

  const recommendation = useMemo(() => {
    const rank: Record<string, number> = { BASE: 0, CONSERVATIVE: 1, POSITIVE: 2 };
    const pick = (status: "ELIGIBLE" | "CONDITIONAL") =>
      analysis.financialMatrix
        .filter((cell) => {
          const capacity = analysis.capacities.find((item) => item.key === cell.scenarioKey);
          if (!capacity || capacity.demandFit === "SHORT" || capacity.demandFit === "REVIEW") return false;
          return cell.overallEligibility === status;
        })
        .sort((a, b) => (rank[a.scenarioKey] - rank[b.scenarioKey]) || (a.term - b.term))[0] ?? null;
    // 2026-08-25 확정: IRR·DSCR을 모두 충족하는(가능) 조합을 우선 추천하고,
    // 없으면 조건부 가능 조합을 대신 보여준다(불가 조합만 있는 경우는 추천하지 않음).
    return pick("ELIGIBLE") ?? pick("CONDITIONAL");
  }, [analysis]);

  const finalDecision = ownershipGate === "FAIL"
    ? { status: "FAIL", title: "사업추진 대상 제외", text: "민간소유가 포함되어 현재 공공부지 PPP 검토대상에서 제외됩니다." }
    : ownershipGate !== "PASS"
      ? { status: "REVIEW", title: "소유·협의구조 확인 필요", text: "공공소유 및 재산관리·의사결정권자 확인 후 후속 판단이 가능합니다." }
      : analysis.fullDemandGfa === null
        ? { status: "REVIEW", title: "수요 DB 연결 필요", text: "PUBLIC Required GFA와 COMMERCIAL Supportable GFA가 채워지면 면적 적합성을 판정합니다." }
        : recommendation
          ? recommendation.overallEligibility === "ELIGIBLE"
            ? { status: "PASS", title: "사업추진 검토 가능", text: `${recommendation.scenarioLabel} 개발안 / ${recommendation.term}년 조합이 수요 적합성과 목표수익률·DSCR 기준을 모두 충족합니다.` }
            : { status: "CONDITIONAL", title: "조건부 사업추진 검토", text: `${recommendation.scenarioLabel} 개발안 / ${recommendation.term}년 조합이 목표수익률 또는 DSCR 기준에 근접했으나 완전히 충족하지는 못했습니다. 용적률 인센티브·임대료·금리 조정 등 조건 조정 검토가 필요합니다.` }
          : { status: "REVIEW", title: "조건 조정 필요", text: "현재 입력조건에서는 수요와 금융기준을 동시에 충족하는 조합이 없습니다." };

  const address = records[0] ? `${records[0].legalDong} ${records[0].jibun}`.trim() : "선택 대지";
  const parcelCount = snapshot.pnus?.length ?? ownership.length;

  function setAssumption(key: keyof FinancialAssumptions, value: string | number) {
    const numeric = typeof value === "number" ? value : parseNumber(value);
    if (key === "basementRatioPct") setBasementAutoApplied(true);
    setAssumptions((current) => ({ ...current, [key]: numeric }));
  }

  function setCommercial(key: CommercialCategoryKey, value: string) {
    setDemand((current) => ({
      ...current,
      commercialSupportableGfa: { ...current.commercialSupportableGfa, [key]: parseNumber(value) },
    }));
  }

  return (
    <main className="report-shell">
      <div className="report-toolbar no-print">
        <div><strong>INRealtyLab · Integrated Executive Review</strong><div className="report-source">Part 1 → Part 2 → Part 3</div></div>
        <div className="report-toolbar-actions"><button className="report-btn" onClick={() => window.history.back()}>이전</button><button className="report-btn primary" onClick={() => window.print()}>3장 보고서 인쇄 / PDF</button></div>
      </div>

      <section className="report-page">
        <div className="report-kicker">01 · SITE / LEGAL STATUS</div>
        <h1 className="report-title">{address} 사업추진 약식검토</h1>
        <p className="report-subtitle">지도·대지현황·법적 개발가능 규모</p>
        <div className="report-grid">
          <div className="report-map-placeholder"><div><strong>선택 필지 지도영역</strong><span>Part 1 선택필지 {parcelCount || "-"}개 · PNU 기반 연계</span></div></div>
          <div className="report-card"><h3>대지 개요</h3>
            <Metric label="대지면적" value={formatGfa(siteAreaSqm)} />
            <Metric label="용도지역" value={snapshot.primaryZone ?? "확인 필요"} />
            <Metric label="건폐율 상한" value={formatPercent(snapshot.statutoryBcrMaxPct ?? null)} />
            <Metric label="용적률 상한" value={formatPercent(snapshot.statutoryFarMaxPct ?? null)} />
            <Metric label={`공시지가 기준 토지가치${landPriceYears.length ? ` (${landPriceYears.join("/")}년)` : ""}`} value={formatWon(officialLandValue)} />
            <Metric label="연 토지사용료 5%" value={formatWon(analysis.annualLandFee)} />
            <div className="report-source" style={{ marginTop: 8 }}>
              {landPriceByPnu.size ? "국토교통부 개별공시지가정보 자동조회" : "공시지가 자동조회값 없음 — 확인 필요"}
            </div>
          </div>
        </div>
        <div className="report-section"><div className="report-section-head"><div><span>PART 1</span><br /><strong>개발가능 규모</strong></div></div>
          <table className="report-table"><thead><tr><th>구분</th>{DEVELOPMENT_SCENARIOS.map((s) => <th key={s.key}>{s.label}</th>)}</tr></thead><tbody>
            <tr><td className="left">지상 개발가능 GFA</td>{analysis.capacities.map((c) => <td key={c.key}>{formatGfa(c.aboveGroundGfa || null)}</td>)}</tr>
            <tr><td className="left">지하 GFA</td>{analysis.capacities.map((c) => <td key={c.key}>{formatGfa(c.undergroundGfa)}</td>)}</tr>
            <tr><td className="left">총 공사 GFA</td>{analysis.capacities.map((c) => <td key={c.key}>{formatGfa(c.totalConstructionGfa)}</td>)}</tr>
          </tbody></table>
          <div className="report-note" style={{ marginTop: 10 }}>
            {basementReference?.ratioPct !== null && basementReference?.ratioPct !== undefined
              ? `지하 GFA는 건축HUB 층별개요의 기존 건축물 참고비율 ${basementReference.ratioPct.toFixed(1)}%를 초기값으로 적용했습니다. 미래 계획 지하규모의 확정값이 아니며 직접 수정할 수 있습니다.`
              : "건축HUB에서 유효한 지상·지하 층별 면적을 찾지 못해 지하 비율은 자동 추정하지 않았습니다."}
          </div>
        </div>
        <div className="report-section no-print"><div className="report-section-head"><div><span>ASSUMPTIONS</span><br /><strong>사업비·운영·금융 입력</strong></div></div>
          <div className="report-form-grid">
            <Field label="지하/지상 비율 %" value={assumptions.basementRatioPct} onChange={(v) => setAssumption("basementRatioPct", v)} />
            <Field label="표준공사비 원/㎡" value={assumptions.constructionCostPerSqm} onChange={(v) => setAssumption("constructionCostPerSqm", v)} />
            <Field label="시장 임대료 원/㎡·월" value={assumptions.monthlyRentPerSqm} onChange={(v) => setAssumption("monthlyRentPerSqm", v)} />
            <Field label="OPEX / 매출 %" value={assumptions.opexPct} onChange={(v) => setAssumption("opexPct", v)} />
            <Field label="시장 기준금리 %" value={assumptions.referenceRatePct} onChange={(v) => setAssumption("referenceRatePct", v)} />
            <Field label="PF Spread %" value={assumptions.pfSpreadPct} onChange={(v) => setAssumption("pfSpreadPct", v)} />
            <Field label="Debt Ratio %" value={assumptions.debtRatioPct} onChange={(v) => setAssumption("debtRatioPct", v)} />
            <Field label="Debt Tenor 년" value={assumptions.debtTenorYears} onChange={(v) => setAssumption("debtTenorYears", v)} />
            <Field label="출자자 요구수익률 %" value={assumptions.investorRequiredReturnPct} onChange={(v) => setAssumption("investorRequiredReturnPct", v)} />
          </div>
          <div className="report-field" style={{ marginTop: 12 }}><label>가동률 {assumptions.occupancyPct}% · 80~95%, 1% 단위</label><input type="range" min={80} max={95} step={1} value={assumptions.occupancyPct} onChange={(e) => setAssumption("occupancyPct", Number(e.target.value))} /></div>
        </div>
        <div className="report-page-number">1 / 3</div>
      </section>

      <section className="report-page">
        <div className="report-kicker">02 · OWNERSHIP / DEMAND</div>
        <h2 className="report-title">소유·협의대상과 시설수요</h2>
        <div className="report-grid">
          <div className="report-card"><h3>소유권 Gate</h3><Metric label="판정" value={ownershipGate} />{records.map((row, i) => <div className="report-owner-row" key={`${row.pnu}-${i}`}><strong>{row.ownerTypeLabel} · {row.ownerClass}</strong><span>{row.legalDong} {row.jibun}</span></div>)}</div>
          <div className="report-card"><h3>협의대상자</h3><p>1차 · 토지 소유기관</p><p>2차 · 재산관리관·관리권자·운영주체</p><p>3차 · 관리·처분·개발 의사결정권자</p><div className="report-warning">공개 소유정보로 실제 기관명·재산관리관이 확정되지 않으면 “확인 필요”로 유지합니다.</div></div>
        </div>
        <div className="report-section no-print"><div className="report-section-head"><div><span>DEMAND ENGINE</span><br /><strong>시설별 연면적 DB 연결 슬롯</strong></div></div>
          <div className="report-demand-grid"><Field label="PUBLIC Required GFA ㎡" value={demand.publicRequiredGfa} onChange={(v) => setDemand((c) => ({ ...c, publicRequiredGfa: parseNumber(v) }))} />{COMMERCIAL_CATEGORIES.map((item) => <Field key={item.key} label={`${item.label} ㎡`} value={demand.commercialSupportableGfa[item.key] ?? null} onChange={(v) => setCommercial(item.key, v)} />)}</div>
        </div>
        <div className="report-section"><div className="report-section-head"><div><span>DEMAND FIT</span><br /><strong>개발가능 면적 vs 수요시설 면적</strong></div></div>
          <table className="report-table"><thead><tr><th>개발안</th><th>지상 GFA</th><th>수요 GFA</th><th>차이</th><th>판정</th></tr></thead><tbody>{analysis.capacities.map((c) => <tr key={c.key}><td>{c.label}</td><td>{formatGfa(c.aboveGroundGfa || null)}</td><td>{formatGfa(c.fullDemandGfa)}</td><td>{c.demandGapGfa === null ? "-" : `${c.demandGapGfa >= 0 ? "+" : ""}${formatGfa(c.demandGapGfa)}`}</td><td><span className={`report-status ${statusTone(c.demandFit)}`}>{c.demandFit}</span></td></tr>)}</tbody></table>
        </div>
        <div className="report-section"><div className="report-section-head"><div><span>COST</span><br /><strong>개발규모별 공사비</strong></div></div>
          <table className="report-table"><thead><tr><th>개발안</th><th>총 공사 GFA</th><th>Construction CAPEX</th></tr></thead><tbody>{analysis.capacities.map((c) => <tr key={c.key}><td>{c.label}</td><td>{formatGfa(c.totalConstructionGfa)}</td><td>{formatWon(c.constructionCapex)}</td></tr>)}</tbody></table>
        </div>
        <div className="report-page-number">2 / 3</div>
      </section>

      <section className="report-page">
        <div className="report-kicker">03 · PPP FEASIBILITY / GO-NO GO</div>
        <h2 className="report-title">사업성 매트릭스와 추진여부</h2>
        <p className="report-subtitle">토지매입비 0 · 공시지가 기준 연 5% 사용료 · 30/40/50년 · 종료 후 기부채납</p>
        <div className="report-grid three">
          <div className="report-card"><h3>토지</h3><Metric label="토지가치" value={formatWon(officialLandValue)} /><Metric label="연 사용료" value={formatWon(analysis.annualLandFee)} /></div>
          <div className="report-card"><h3>BTO / BOT</h3><Metric label="PASS" value="Min DSCR ≥ 1.20" /><Metric label="CONDITIONAL" value="1.00 ≤ Min DSCR < 1.20" /><Metric label="STRONG" value="Min DSCR ≥ 1.30" /></div>
          <div className="report-card"><h3>REITs</h3><Metric label="PASS" value="Project IRR ≥ 6.5%" /><Metric label="CONDITIONAL" value="4.50% ≤ IRR < 6.5%" /><Metric label="출자자 요구" value={assumptions.investorRequiredReturnPct ? `${assumptions.investorRequiredReturnPct}%` : "별도 입력"} /></div>
        </div>
        <div className="report-section"><div className="report-section-head"><div><span>BTO / BOT</span><br /><strong>Minimum DSCR Matrix</strong></div></div><Matrix mode="BTO" analysis={analysis} /></div>
        <div className="report-section"><div className="report-section-head"><div><span>REITs</span><br /><strong>Project IRR Matrix</strong></div></div><Matrix mode="REITS" analysis={analysis} /></div>
        <div className="report-section report-verdict"><span className={`report-status ${statusTone(finalDecision.status)}`}>{finalDecision.status}</span><strong>{finalDecision.title}</strong><p>{finalDecision.text}</p>{recommendation && <p><b>우선 검토:</b> {recommendation.scenarioLabel} / {recommendation.term}년 · BTO/BOT {recommendation.btoBotStatus} · REITs {recommendation.reitsStatus}</p>}</div>
        <div className="report-note">실제 PF 가능 여부는 개별 금융기관 약정과 Debt sizing, 실제 임대료·OPEX·금리·Lifecycle CAPEX를 반영해 확정합니다. REITs의 6.5%는 INRealtyLab 내부 Project IRR 판정기준(공통 목표수익률)이며, DSCR·IRR 중 하나라도 CONDITIONAL/FAIL이면 종합판정도 그에 따라 조건부 가능/불가로 표시됩니다.</div>
        <div className="report-page-number">3 / 3</div>
      </section>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="report-metric"><span>{label}</span><strong>{value}</strong></div>;
}

function Field({ label, value, onChange }: { label: string; value: number | null; onChange: (value: string) => void }) {
  return <div className="report-field"><label>{label}</label><input inputMode="decimal" value={value ?? ""} onChange={(e) => onChange(e.target.value)} placeholder="자동연결 / 직접입력" /></div>;
}

function Matrix({ mode, analysis }: { mode: "BTO" | "REITS"; analysis: ReturnType<typeof buildIntegratedAnalysis> }) {
  return <table className="report-table"><thead><tr><th>개발규모</th>{CONCESSION_TERMS.map((term) => <th key={term}>{term}년</th>)}</tr></thead><tbody>{DEVELOPMENT_SCENARIOS.map((scenario) => <tr key={scenario.key}><td>{scenario.label}</td>{CONCESSION_TERMS.map((term) => { const cell = analysis.financialMatrix.find((item) => item.scenarioKey === scenario.key && item.term === term); if (!cell) return <td key={term}>-</td>; const status = mode === "BTO" ? cell.btoBotStatus : cell.reitsStatus; return <td key={term}><span className="matrix-value">{mode === "BTO" ? (cell.dscr?.toFixed(2) ?? "-") : irrText(cell.projectIrr)}</span><span className={`report-status ${statusTone(status)}`}>{status}</span>{mode === "REITS" && cell.investorReturnSatisfied !== null && <div className="matrix-sub">출자자 {cell.investorReturnSatisfied ? "충족" : "미충족"}</div>}</td>; })}</tr>)}</tbody></table>;
}
