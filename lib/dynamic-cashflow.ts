/**
 * 동적 현금흐름 · 스트레스 테스트 모듈
 *
 * 특허 10-2026-0144458 청구항 12·14·15 대응.
 *
 *   청구항 12 : 공시지가 변동폭 기반 지료 변동성 → 사업기간 전체 동적 현금흐름
 *   청구항 14 : 연도별 DSCR 산출 (최저 DSCR 이 실제 금융 심사 기준)
 *   청구항 15 : 금리 변동 시나리오 스트레스 테스트 → 잔존 자산 가치 지표
 *
 * 기존 integrated-report.ts 는 사업기간 내내 동일한 연간 현금흐름을 반복한다.
 *   Array.from({ length: term }, () => annualProjectCashflow)
 * 그 결과 지료가 매년 고정되고 DSCR 이 단일 값으로만 나온다.
 * 이 모듈은 연도별 시계열을 만들어 그 한계를 없앤다.
 */

import { calculateIrr } from "./integrated-report";

/** 공시지가 연평균 변동률 기본값 (%). 실제 지역 시계열로 대체할 것. */
export const DEFAULT_LAND_VALUE_GROWTH_PCT = 2.5;

/** 임대료 연간 상승률 기본값 (%) */
export const DEFAULT_RENT_ESCALATION_PCT = 2.0;

/** 운영비 연간 상승률 기본값 (%) */
export const DEFAULT_OPEX_ESCALATION_PCT = 2.5;

/** 토지사용료 요율 (%). 국유재산법 시행령상 최저 요율 기준. */
export const DEFAULT_LAND_FEE_RATE_PCT = 5.0;

/** 건축물 내용연수 (년). 잔존가치 산정 기준. */
export const BUILDING_USEFUL_LIFE_YEARS = 50;

/** 금리 스트레스 시나리오 (기준금리 대비 bp) */
export const STRESS_SCENARIOS = [
  { key: "BASE", label: "기준", deltaBp: 0 },
  { key: "MILD", label: "+100bp", deltaBp: 100 },
  { key: "SEVERE", label: "+200bp", deltaBp: 200 },
] as const;

export type StressScenarioKey = (typeof STRESS_SCENARIOS)[number]["key"];

/** 사업 종료 시 자산 처리 방식 */
export type ReversionMode =
  | "TRANSFER" // 기부채납 — 사업시행자에게 잔존가치 없음 (BTO/BOT 기본)
  | "RETAIN"; // 자산 보유 — 감가 후 잔존가치 인정

export type DynamicCashflowInput = {
  /** 사업기간 (년) */
  term: number;
  /** 1차연도 임대수입 (원) */
  baseAnnualRevenue: number | null;
  /** 1차연도 운영비 (원) */
  baseAnnualOpex: number | null;
  /** 대지면적 (㎡) */
  siteAreaSqm: number | null;
  /** 개별공시지가 (원/㎡) */
  landValuePerSqm: number | null;
  /** 총사업비 (원) */
  totalProjectCost: number | null;
  /** 순공사비 (원) — 잔존가치 산정 기준 */
  constructionCapex: number | null;
  /** 차입금 (원) */
  debtAmount: number | null;
  /** 적용 금리 (%) */
  ratePct: number | null;

  landFeeRatePct?: number;
  landValueGrowthPct?: number;
  rentEscalationPct?: number;
  opexEscalationPct?: number;
  reversionMode?: ReversionMode;
  usefulLifeYears?: number;
};

export type CashflowYear = {
  year: number;
  revenue: number;
  opex: number;
  landFee: number;
  /** 부채상환 전 현금흐름 */
  cfads: number;
  debtService: number;
  /** 해당 연도 DSCR */
  dscr: number | null;
};

export type DynamicCashflowResult = {
  years: CashflowYear[];
  /** 최저 DSCR — 금융기관 심사의 실질 기준 */
  minDscr: number | null;
  /** 최저 DSCR 이 발생하는 연차 */
  minDscrYear: number | null;
  averageDscr: number | null;
  /** 사업 종료 시 잔존 자산 가치 (원) */
  residualValue: number;
  /** 잔존가치 포함 Project IRR */
  projectIrr: number | null;
  /** 잔존가치 제외 Project IRR — 비교용 */
  projectIrrExcludingResidual: number | null;
  unavailableReason: string | null;
};

export type StressTestRow = {
  key: StressScenarioKey;
  label: string;
  appliedRatePct: number;
  minDscr: number | null;
  projectIrr: number | null;
  /** DSCR 1.20 및 IRR 6% 동시 충족 여부 */
  pass: boolean;
};

function positive(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isFinite(value) || value < 0) return null;
  return value;
}

/** 원리금 균등상환 연간 상환액 */
function annuityPayment(principal: number, annualRate: number, years: number) {
  if (principal <= 0 || years <= 0) return 0;
  if (annualRate <= 0) return principal / years;
  const factor = Math.pow(1 + annualRate, years);
  return (principal * annualRate * factor) / (factor - 1);
}

/**
 * 청구항 12·15 — 사업기간 전체의 연도별 현금흐름을 만든다.
 *
 * 핵심은 지료다. 공공토지 임대 방식에서 토지사용료는 공시지가에 연동되므로
 * 공시지가가 오르면 지료도 매년 재산정된다. 임대수입 상승률보다 공시지가
 * 상승률이 높으면 후반부로 갈수록 현금흐름이 악화되고, 최저 DSCR 이
 * 1차연도가 아니라 만기 직전에 발생한다. 고정 현금흐름 모델은 이 위험을
 * 통째로 놓친다.
 */
export function buildDynamicCashflow(input: DynamicCashflowInput): DynamicCashflowResult {
  const empty: DynamicCashflowResult = {
    years: [],
    minDscr: null,
    minDscrYear: null,
    averageDscr: null,
    residualValue: 0,
    projectIrr: null,
    projectIrrExcludingResidual: null,
    unavailableReason: null,
  };

  const term = positive(input.term);
  const baseRevenue = positive(input.baseAnnualRevenue);
  const baseOpex = positive(input.baseAnnualOpex);
  const siteArea = positive(input.siteAreaSqm);
  const landValuePerSqm = positive(input.landValuePerSqm);
  const totalProjectCost = positive(input.totalProjectCost);

  if (!term) return { ...empty, unavailableReason: "사업기간이 없습니다." };
  if (baseRevenue === null) return { ...empty, unavailableReason: "임대수입이 산출되지 않았습니다." };
  if (baseOpex === null) return { ...empty, unavailableReason: "운영비가 산출되지 않았습니다." };
  if (totalProjectCost === null) return { ...empty, unavailableReason: "총사업비가 산출되지 않았습니다." };

  const landFeeRate = (input.landFeeRatePct ?? DEFAULT_LAND_FEE_RATE_PCT) / 100;
  const landGrowth = (input.landValueGrowthPct ?? DEFAULT_LAND_VALUE_GROWTH_PCT) / 100;
  const rentGrowth = (input.rentEscalationPct ?? DEFAULT_RENT_ESCALATION_PCT) / 100;
  const opexGrowth = (input.opexEscalationPct ?? DEFAULT_OPEX_ESCALATION_PCT) / 100;

  const baseLandValue = siteArea !== null && landValuePerSqm !== null ? siteArea * landValuePerSqm : 0;

  const debtAmount = positive(input.debtAmount) ?? 0;
  const rate = positive(input.ratePct);
  const debtService = rate === null ? 0 : annuityPayment(debtAmount, rate / 100, term);

  const years: CashflowYear[] = [];
  for (let year = 1; year <= term; year += 1) {
    const escalation = year - 1;
    const revenue = baseRevenue * Math.pow(1 + rentGrowth, escalation);
    const opex = baseOpex * Math.pow(1 + opexGrowth, escalation);
    // 청구항 12 핵심: 지료가 공시지가 변동에 연동된다
    const landFee = baseLandValue * Math.pow(1 + landGrowth, escalation) * landFeeRate;
    const cfads = revenue - opex - landFee;
    years.push({
      year,
      revenue,
      opex,
      landFee,
      cfads,
      debtService,
      dscr: debtService > 0 ? cfads / debtService : null,
    });
  }

  const dscrValues = years.map((item) => item.dscr).filter((value): value is number => value !== null);
  const minDscr = dscrValues.length ? Math.min(...dscrValues) : null;
  const minDscrYear = minDscr === null ? null : years.find((item) => item.dscr === minDscr)?.year ?? null;
  const averageDscr = dscrValues.length
    ? dscrValues.reduce((sum, value) => sum + value, 0) / dscrValues.length
    : null;

  // 청구항 15 — 잔존 자산 가치
  const reversionMode = input.reversionMode ?? "TRANSFER";
  const usefulLife = input.usefulLifeYears ?? BUILDING_USEFUL_LIFE_YEARS;
  const constructionCapex = positive(input.constructionCapex) ?? 0;
  const residualValue =
    reversionMode === "RETAIN"
      ? constructionCapex * Math.max(0, 1 - term / usefulLife)
      : 0;

  const operatingFlows = years.map((item) => item.cfads);
  const projectIrr = calculateIrr([
    -totalProjectCost,
    ...operatingFlows.slice(0, -1),
    operatingFlows[operatingFlows.length - 1] + residualValue,
  ]);
  const projectIrrExcludingResidual = calculateIrr([-totalProjectCost, ...operatingFlows]);

  return {
    years,
    minDscr,
    minDscrYear,
    averageDscr,
    residualValue,
    projectIrr,
    projectIrrExcludingResidual,
    unavailableReason: null,
  };
}

/**
 * 청구항 15 — 금리 변동 시나리오 스트레스 테스트.
 * 기준금리에 100bp, 200bp 를 얹었을 때도 사업이 성립하는지 본다.
 */
export function runStressTest(
  input: DynamicCashflowInput,
  // 2026-08-25 확정: 공통 목표수익률(허들레이트) 6.5%, DSCR 최소기준 1.2
  thresholds: { minDscr?: number; minIrrPct?: number } = {}
): StressTestRow[] {
  const dscrFloor = thresholds.minDscr ?? 1.2;
  const irrFloor = (thresholds.minIrrPct ?? 6.5) / 100;
  const baseRate = positive(input.ratePct);
  if (baseRate === null) return [];

  return STRESS_SCENARIOS.map((scenario) => {
    const appliedRatePct = baseRate + scenario.deltaBp / 100;
    const result = buildDynamicCashflow({ ...input, ratePct: appliedRatePct });
    const pass =
      result.minDscr !== null &&
      result.projectIrr !== null &&
      result.minDscr >= dscrFloor &&
      result.projectIrr >= irrFloor;

    return {
      key: scenario.key,
      label: scenario.label,
      appliedRatePct,
      minDscr: result.minDscr,
      projectIrr: result.projectIrr,
      pass,
    };
  });
}
