export const CONCESSION_TERMS = [30, 40, 50] as const;

export const DEVELOPMENT_SCENARIOS = [
  { key: "CONSERVATIVE", label: "보수", factor: 0.8 },
  { key: "BASE", label: "중간", factor: 0.9 },
  { key: "POSITIVE", label: "긍정", factor: 1 },
] as const;

export const COMMERCIAL_CATEGORIES = [
  { key: "OFFICE", label: "오피스 (OFFICE)" },
  { key: "RETAIL", label: "리테일 (RETAIL)" },
  { key: "LOGISTICS_WAREHOUSE", label: "물류/창고 (LOGISTICS & WAREHOUSE)" },
  { key: "RESIDENTIAL", label: "주거 (RESIDENTIAL)" },
  { key: "HOSPITALITY", label: "숙박 (HOSPITALITY)" },
  { key: "HEALTHCARE", label: "의료/헬스케어 (HEALTHCARE)" },
  { key: "EDUCATION_RESEARCH", label: "교육/연구 (EDUCATION & RESEARCH)" },
  { key: "INDUSTRIAL_MANUFACTURING", label: "산업/제조 (INDUSTRIAL & MANUFACTURING)" },
  { key: "DATA_CENTER", label: "데이터센터 (DATA CENTER)" },
  { key: "MIXED_USE", label: "복합용도 (MIXED-USE)" },
] as const;

export type CommercialCategoryKey = (typeof COMMERCIAL_CATEGORIES)[number]["key"];
export type DevelopmentScenarioKey = (typeof DEVELOPMENT_SCENARIOS)[number]["key"];
export type ConcessionTerm = (typeof CONCESSION_TERMS)[number];

export type FinancialAssumptions = {
  basementRatioPct: number | null;
  constructionCostPerSqm: number | null;
  monthlyRentPerSqm: number | null;
  occupancyPct: number;
  opexPct: number | null;
  referenceRatePct: number | null;
  pfSpreadPct: number | null;
  debtRatioPct: number | null;
  debtTenorYears: number | null;
  investorRequiredReturnPct: number | null;
  otherAnnualRevenue: number | null;
};

export type DemandInputs = {
  publicRequiredGfa: number | null;
  commercialSupportableGfa: Partial<Record<CommercialCategoryKey, number | null>>;
};

export type ScenarioCapacity = {
  key: DevelopmentScenarioKey;
  label: string;
  factor: number;
  aboveGroundGfa: number;
  undergroundGfa: number | null;
  totalConstructionGfa: number | null;
  fullDemandGfa: number | null;
  demandGapGfa: number | null;
  demandFit: "SHORT" | "EXACT" | "EXCESS" | "REVIEW";
  selectedCommercialGfa: number | null;
  constructionCapex: number | null;
  totalProjectCost: number | null;
};

export type FacilityOperatingLine = {
  facilityCode: string;
  ratioPct: number;
  allocatedGfaSqm: number;
  revenueAreaSqm: number;
  monthlyRentPerSqm: number;
  occupancyRate: number;
  annualRevenue: number;
  opexPct: number;
  annualOpex: number;
};

export type FinancialCell = {
  scenarioKey: DevelopmentScenarioKey;
  scenarioLabel: string;
  term: ConcessionTerm;
  annualLandFee: number | null;
  annualRevenue: number | null;
  annualOpex: number | null;
  annualProjectCashflow: number | null;
  debtAmount: number | null;
  annualDebtService: number | null;
  dscr: number | null;
  btoBotStatus: "FAIL" | "CONDITIONAL" | "PASS" | "STRONG" | "REVIEW";
  projectIrr: number | null;
  reitsStatus: "FAIL" | "CONDITIONAL" | "PASS" | "REVIEW";
  /** DSCR·IRR 기준을 종합한 최종 적격성 판정 (worst-of: 하나라도 불가면 불가) */
  overallEligibility: "NOT_ELIGIBLE" | "CONDITIONAL" | "ELIGIBLE" | "REVIEW";
  investorReturnSatisfied: boolean | null;
  facilityOperatingLines: FacilityOperatingLine[];
};

export type IntegratedAnalysis = {
  totalCommercialSupportableGfa: number | null;
  fullDemandGfa: number | null;
  annualLandFee: number | null;
  capacities: ScenarioCapacity[];
  financialMatrix: FinancialCell[];
};

type LinkedPart1Scenario = {
  label?: string | null;
  grossFloorAreaSqm?: number | null;
};

type CommercialAllocationSnapshot = {
  complete?: boolean;
  commercialPoolGfaSqm?: number | null;
  facilities?: Array<{
    facilityCode?: string;
    ratioPct?: number;
  }>;
};

const TOTAL_PROJECT_COST_FACTOR = 1.2;
const DEFAULT_PF_RATE_PCT = 7.0;
const DEFAULT_LTC_PCT = 75;
const MIN_LTC_PCT = 70;
const MAX_LTC_PCT = 80;
const LEASE_OCCUPANCY_RATE = 0.95;
const PILOT_COMMERCIAL_RATIO = 0.60;

/**
 * 2026-08-25 확정: BTO 사업성분석 적격성 판정기준.
 * 목표수익률(허들레이트)은 1차적으로 시설유형 구분 없이 전체 공통값을 쓰고,
 * DB(part3_underwriting_default 등)가 축적되면 시설유형별로 세분화할 예정.
 * "조건부 가능" 구간은 목표수익률 대비 1~2%p 미달 구간(최대 2%p까지), 그 이상
 * 미달하거나 DSCR이 원리금 상환 자체가 안 되는 수준(1.0 미만)이면 "불가".
 */
const IRR_TARGET_PCT = 6.5;
const IRR_CONDITIONAL_FLOOR_PCT = IRR_TARGET_PCT - 2; // 4.5% 미만이면 불가
const DSCR_PASS_MIN = 1.2;
const DSCR_CONDITIONAL_FLOOR = 1.0; // 1.0 미만이면 불가 (원리금 상환 자체 불가)
const DSCR_STRONG_MIN = 1.3;

const FACILITY_REVENUE_POLICY: Record<string, { efficiency: number; opexPct: number; leaseBased: boolean }> = {
  C01_OFFICE: { efficiency: 0.5245, opexPct: 36, leaseBased: true },
  C02_RETAIL: { efficiency: 0.80, opexPct: 30, leaseBased: true },
  C03_HOSPITALITY: { efficiency: 0.5631067961, opexPct: 30, leaseBased: false },
  C04_LIVING: { efficiency: 0.70, opexPct: 30, leaseBased: true },
  C05_HEALTHCARE: { efficiency: 0.4938271605, opexPct: 30, leaseBased: false },
  C06_EDUCATION: { efficiency: 0.7018, opexPct: 30, leaseBased: false },
  C07_CULTURE_ENTERTAINMENT: { efficiency: 0.75, opexPct: 30, leaseBased: false },
  C08_RND_LAB: { efficiency: 0.5714285714, opexPct: 30, leaseBased: false },
  C09_LOGISTICS: { efficiency: 1.0, opexPct: 30, leaseBased: false },
  C10_DIGITAL_INFRA: { efficiency: 0.1733333333, opexPct: 30, leaseBased: false },
};

function nonNegative(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return Math.max(0, value);
}

function readLinkedPart1Scenarios(): LinkedPart1Scenario[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.sessionStorage.getItem("inrealtylab.part1Snapshot");
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { scenarios?: LinkedPart1Scenario[] };
    return Array.isArray(parsed.scenarios) ? parsed.scenarios : [];
  } catch {
    return [];
  }
}

function readCommercialAllocation(): CommercialAllocationSnapshot | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem("inrealtylab.commercialAllocation");
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CommercialAllocationSnapshot;
    return parsed && Array.isArray(parsed.facilities) ? parsed : null;
  } catch {
    return null;
  }
}

function readFacilityRent(facilityCode: string) {
  if (typeof window === "undefined") return 0;
  try {
    const raw = window.sessionStorage.getItem(`inrealtylab.rent.${facilityCode}`);
    if (raw === null) return 0;
    const value = Number(raw);
    return Number.isFinite(value) && value >= 0 ? value : 0;
  } catch {
    return 0;
  }
}

function readSelectedPfRatePct() {
  if (typeof window === "undefined") return DEFAULT_PF_RATE_PCT;
  try {
    const raw = window.sessionStorage.getItem("inrealtylab.pfRatePct");
    if (!raw) return DEFAULT_PF_RATE_PCT;
    const value = Number(raw);
    if (!Number.isFinite(value)) return DEFAULT_PF_RATE_PCT;
    return Math.min(9, Math.max(5, value));
  } catch {
    return DEFAULT_PF_RATE_PCT;
  }
}

function readSelectedLtcPct() {
  if (typeof window === "undefined") return DEFAULT_LTC_PCT;
  try {
    const raw = window.sessionStorage.getItem("inrealtylab.ltcPct");
    const value = Number(raw);
    if (!Number.isFinite(value)) return DEFAULT_LTC_PCT;
    return Math.round(Math.min(MAX_LTC_PCT, Math.max(MIN_LTC_PCT, value)));
  } catch {
    return DEFAULT_LTC_PCT;
  }
}

function sumCommercial(values: DemandInputs["commercialSupportableGfa"]) {
  const numeric = COMMERCIAL_CATEGORIES
    .map((item) => nonNegative(values[item.key]))
    .filter((value): value is number => value !== null);

  if (!numeric.length) return null;
  return numeric.reduce((sum, value) => sum + value, 0);
}

function annuityPayment(principal: number, annualRate: number, years: number) {
  if (principal <= 0 || years <= 0) return 0;
  if (annualRate <= 0) return principal / years;
  const factor = Math.pow(1 + annualRate, years);
  return principal * ((annualRate * factor) / (factor - 1));
}

function npv(rate: number, cashflows: number[]) {
  return cashflows.reduce((sum, value, year) => sum + value / Math.pow(1 + rate, year), 0);
}

export function calculateIrr(cashflows: number[]) {
  if (cashflows.length < 2 || !cashflows.some((value) => value < 0) || !cashflows.some((value) => value > 0)) {
    return null;
  }

  let low = -0.99;
  let high = 1;
  let lowNpv = npv(low, cashflows);
  let highNpv = npv(high, cashflows);

  while (lowNpv * highNpv > 0 && high < 10) {
    high *= 2;
    highNpv = npv(high, cashflows);
  }

  if (lowNpv * highNpv > 0) return null;

  for (let index = 0; index < 160; index += 1) {
    const mid = (low + high) / 2;
    const midNpv = npv(mid, cashflows);
    if (Math.abs(midNpv) < 0.000001) return mid;

    if (lowNpv * midNpv <= 0) {
      high = mid;
      highNpv = midNpv;
    } else {
      low = mid;
      lowNpv = midNpv;
    }
  }

  return (low + high) / 2;
}

function classifyDscr(dscr: number | null): FinancialCell["btoBotStatus"] {
  if (dscr === null || !Number.isFinite(dscr)) return "REVIEW";
  if (dscr < DSCR_CONDITIONAL_FLOOR) return "FAIL";
  if (dscr < DSCR_PASS_MIN) return "CONDITIONAL";
  if (dscr < DSCR_STRONG_MIN) return "PASS";
  return "STRONG";
}

function classifyIrr(irr: number | null): FinancialCell["reitsStatus"] {
  if (irr === null || !Number.isFinite(irr)) return "REVIEW";
  if (irr < IRR_CONDITIONAL_FLOOR_PCT / 100) return "FAIL";
  if (irr < IRR_TARGET_PCT / 100) return "CONDITIONAL";
  return "PASS";
}

/** 2026-08-25 확정 종합판정 매트릭스: 둘 다 가능해야 가능, 하나라도 불가면 불가. */
function combineEligibility(
  dscrStatus: FinancialCell["btoBotStatus"],
  irrStatus: FinancialCell["reitsStatus"]
): FinancialCell["overallEligibility"] {
  const tier = (status: string): "NOT_ELIGIBLE" | "CONDITIONAL" | "ELIGIBLE" | "REVIEW" => {
    if (status === "FAIL") return "NOT_ELIGIBLE";
    if (status === "CONDITIONAL") return "CONDITIONAL";
    if (status === "REVIEW") return "REVIEW";
    return "ELIGIBLE"; // PASS, STRONG
  };
  const rank: Record<string, number> = { ELIGIBLE: 0, CONDITIONAL: 1, REVIEW: 1, NOT_ELIGIBLE: 2 };
  const dscrTier = tier(dscrStatus);
  const irrTier = tier(irrStatus);
  const worst = rank[dscrTier] >= rank[irrTier] ? dscrTier : irrTier;
  return worst;
}

function buildFacilityOperatingLines(selectedCommercialGfa: number | null) {
  if (selectedCommercialGfa === null) return null;
  const allocation = readCommercialAllocation();
  // 2026-08-26 확정: COMMERCIAL PROGRAM(수익시설 비율 배분) 화면을 관리자 전용으로 숨기면서,
  // 외부 사용자는 배분을 저장할 방법이 없어 매출·DSCR·IRR이 전부 계산 불가(REVIEW)로 남는
  // 문제가 있었다. 배분 데이터가 없으면 시범검토 기본 시설(OFFICE) 100% 배분을 기본값으로
  // 사용해 최소한의 사업성 판정이 항상 나오게 한다. 관리자가 실제 배분을 저장하면
  // 그 값이 우선 적용된다.
  const facilities = allocation?.complete && allocation.facilities?.length
    ? allocation.facilities
    : [{ facilityCode: "C01_OFFICE", ratioPct: 100 }];

  return facilities.map((facility): FacilityOperatingLine => {
    const facilityCode = String(facility.facilityCode ?? "");
    const ratioPct = Math.max(0, Math.min(100, Number(facility.ratioPct ?? 0)));
    const allocatedGfaSqm = selectedCommercialGfa * ratioPct / 100;
    const policy = FACILITY_REVENUE_POLICY[facilityCode] ?? { efficiency: 1, opexPct: 30, leaseBased: false };
    const revenueAreaSqm = allocatedGfaSqm * policy.efficiency;
    const monthlyRentPerSqm = readFacilityRent(facilityCode);
    const occupancyRate = policy.leaseBased && monthlyRentPerSqm > 0 ? LEASE_OCCUPANCY_RATE : 1;
    const annualRevenue = revenueAreaSqm * monthlyRentPerSqm * 12 * occupancyRate;
    const annualOpex = annualRevenue * policy.opexPct / 100;

    return {
      facilityCode,
      ratioPct,
      allocatedGfaSqm,
      revenueAreaSqm,
      monthlyRentPerSqm,
      occupancyRate,
      annualRevenue,
      opexPct: policy.opexPct,
      annualOpex,
    };
  });
}

export function buildIntegratedAnalysis(input: {
  siteAreaSqm: number | null;
  farMaxPct: number | null;
  officialLandValue: number | null;
  demand: DemandInputs;
  assumptions: FinancialAssumptions;
}): IntegratedAnalysis {
  const siteArea = nonNegative(input.siteAreaSqm);
  const farMax = nonNegative(input.farMaxPct);
  const publicRequiredGfa = nonNegative(input.demand.publicRequiredGfa);
  const commercialSupportableGfa = sumCommercial(input.demand.commercialSupportableGfa);
  const allocationSnapshot = readCommercialAllocation();
  const allocationReady = Boolean(allocationSnapshot?.complete && allocationSnapshot.facilities?.length);
  const fullDemandGfa = publicRequiredGfa !== null && commercialSupportableGfa !== null
    ? publicRequiredGfa + commercialSupportableGfa
    : null;

  const basementRatio = nonNegative(input.assumptions.basementRatioPct);
  const costPerSqm = nonNegative(input.assumptions.constructionCostPerSqm);
  const landValue = nonNegative(input.officialLandValue);
  const annualLandFee = landValue === null ? null : landValue * 0.05;
  const linkedPart1Scenarios = readLinkedPart1Scenarios();

  const capacities: ScenarioCapacity[] = DEVELOPMENT_SCENARIOS.map((scenario, index) => {
    const linkedScenario = linkedPart1Scenarios[index];
    const linkedAboveGroundGfa = nonNegative(linkedScenario?.grossFloorAreaSqm);
    const fallbackAboveGroundGfa = siteArea !== null && farMax !== null
      ? siteArea * (farMax / 100) * scenario.factor
      : 0;
    const aboveGroundGfa = linkedAboveGroundGfa ?? fallbackAboveGroundGfa;
    const undergroundGfa = basementRatio === null ? null : aboveGroundGfa * (basementRatio / 100);
    const totalConstructionGfa = undergroundGfa === null ? null : aboveGroundGfa + undergroundGfa;
    const demandGapGfa = fullDemandGfa === null ? null : aboveGroundGfa - fullDemandGfa;
    const demandFit = demandGapGfa === null
      ? allocationReady ? "REVIEW" : "REVIEW"
      : demandGapGfa < 0
        ? "SHORT"
        : demandGapGfa === 0
          ? "EXACT"
          : "EXCESS";

    const selectedCommercialGfa = publicRequiredGfa !== null && commercialSupportableGfa !== null
      ? Math.min(commercialSupportableGfa, Math.max(0, aboveGroundGfa - publicRequiredGfa))
      : allocationReady
        ? Math.min(
            Math.max(0, aboveGroundGfa * PILOT_COMMERCIAL_RATIO),
            nonNegative(allocationSnapshot?.commercialPoolGfaSqm) ?? Math.max(0, aboveGroundGfa * PILOT_COMMERCIAL_RATIO),
          )
        // 2026-08-26 확정: DEMAND ENGINE 슬롯(PUBLIC Required GFA·시설별 연면적)이 전혀
        // 입력되지 않은 상태(신규 부지 최초 진입 등)에서도 최소한의 사업성 판정을 보여줄 수 있도록,
        // allocationReady 경로와 동일한 PILOT_COMMERCIAL_RATIO(60%)를 기본 가정으로 적용한다.
        // 실제 수요 데이터가 입력되면 위 두 조건이 우선 적용되어 이 기본값은 자동으로 대체된다.
        : Math.max(0, aboveGroundGfa * PILOT_COMMERCIAL_RATIO);

    const constructionCapex = totalConstructionGfa === null || costPerSqm === null
      ? null
      : totalConstructionGfa * costPerSqm;
    const totalProjectCost = constructionCapex === null ? null : constructionCapex * TOTAL_PROJECT_COST_FACTOR;

    return {
      key: scenario.key,
      label: linkedScenario?.label?.trim() || scenario.label,
      factor: scenario.factor,
      aboveGroundGfa,
      undergroundGfa,
      totalConstructionGfa,
      fullDemandGfa,
      demandGapGfa,
      demandFit,
      selectedCommercialGfa,
      constructionCapex,
      totalProjectCost,
    };
  });

  const legacyMonthlyRent = nonNegative(input.assumptions.monthlyRentPerSqm);
  const legacyOpexPct = nonNegative(input.assumptions.opexPct);
  const referenceRate = nonNegative(input.assumptions.referenceRatePct);
  const pfSpread = nonNegative(input.assumptions.pfSpreadPct);
  const selectedPfRate = readSelectedPfRatePct();
  const selectedLtcPct = readSelectedLtcPct();
  const investorRequiredReturn = nonNegative(input.assumptions.investorRequiredReturnPct);
  const otherAnnualRevenue = nonNegative(input.assumptions.otherAnnualRevenue) ?? 0;

  const financialMatrix = capacities.flatMap((capacity) => CONCESSION_TERMS.map((term): FinancialCell => {
    const facilityOperatingLines = buildFacilityOperatingLines(capacity.selectedCommercialGfa);
    const facilityAnnualRevenue = facilityOperatingLines
      ? facilityOperatingLines.reduce((sum, item) => sum + item.annualRevenue, 0)
      : null;
    const facilityAnnualOpex = facilityOperatingLines
      ? facilityOperatingLines.reduce((sum, item) => sum + item.annualOpex, 0)
      : null;

    const annualRevenue = facilityAnnualRevenue !== null
      ? facilityAnnualRevenue + otherAnnualRevenue
      : capacity.selectedCommercialGfa === null || legacyMonthlyRent === null
        ? null
        : capacity.selectedCommercialGfa * legacyMonthlyRent * 12 + otherAnnualRevenue;

    const annualOpex = facilityAnnualOpex !== null
      ? facilityAnnualOpex
      : annualRevenue === null || legacyOpexPct === null
        ? null
        : annualRevenue * (legacyOpexPct / 100);

    const annualProjectCashflow = annualRevenue === null || annualOpex === null || annualLandFee === null
      ? null
      : annualRevenue - annualOpex - annualLandFee;

    const debtAmount = capacity.totalProjectCost === null
      ? null
      : capacity.totalProjectCost * (selectedLtcPct / 100);
    const appliedRatePct = selectedPfRate ?? (referenceRate === null || pfSpread === null ? null : referenceRate + pfSpread);
    const appliedRate = appliedRatePct === null ? null : appliedRatePct / 100;
    const annualDebtService = debtAmount === null || appliedRate === null
      ? null
      : annuityPayment(debtAmount, appliedRate, term);
    const dscr = annualProjectCashflow === null || annualDebtService === null || annualDebtService <= 0
      ? null
      : annualProjectCashflow / annualDebtService;

    const projectIrr = capacity.totalProjectCost === null || annualProjectCashflow === null
      ? null
      : calculateIrr([
          -capacity.totalProjectCost,
          ...Array.from({ length: term }, () => annualProjectCashflow),
        ]);

    const btoBotStatus = classifyDscr(dscr);
    const reitsStatus = classifyIrr(projectIrr);

    return {
      scenarioKey: capacity.key,
      scenarioLabel: capacity.label,
      term,
      annualLandFee,
      annualRevenue,
      annualOpex,
      annualProjectCashflow,
      debtAmount,
      annualDebtService,
      dscr,
      btoBotStatus,
      projectIrr,
      reitsStatus,
      overallEligibility: combineEligibility(btoBotStatus, reitsStatus),
      investorReturnSatisfied: projectIrr === null || investorRequiredReturn === null
        ? null
        : projectIrr >= investorRequiredReturn / 100,
      facilityOperatingLines: facilityOperatingLines ?? [],
    };
  }));

  return {
    totalCommercialSupportableGfa: commercialSupportableGfa,
    fullDemandGfa,
    annualLandFee,
    capacities,
    financialMatrix,
  };
}

export function formatWon(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "-";
  if (Math.abs(value) >= 100_000_000) return `${(value / 100_000_000).toLocaleString("ko-KR", { maximumFractionDigits: 1 })}억원`;
  if (Math.abs(value) >= 10_000) return `${(value / 10_000).toLocaleString("ko-KR", { maximumFractionDigits: 1 })}만원`;
  return `${Math.round(value).toLocaleString("ko-KR")}원`;
}

export function formatGfa(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "-";
  return `${Math.round(value).toLocaleString("ko-KR")}㎡`;
}

export function formatPercent(value: number | null | undefined, digits = 1) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "-";
  return `${value.toLocaleString("ko-KR", { maximumFractionDigits: digits })}%`;
}
