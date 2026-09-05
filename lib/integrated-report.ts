export const CONCESSION_TERMS = [30, 40, 50] as const;

export const DEVELOPMENT_SCENARIOS = [
  { key: "CONSERVATIVE", label: "보수", factor: 0.8 },
  { key: "BASE", label: "중간", factor: 0.9 },
  { key: "POSITIVE", label: "긍정", factor: 1 },
] as const;

// 시설 분류의 단일 기준은 Supabase facility_master.facility_code다.
// 2026-09-05 정리 전에는 세 벌이 따로 돌고 있었다.
//   STEP 2 ProgramChoice: "C01" (facility_master.category_code)
//   STEP 3 수요 입력:      "OFFICE"·"RESIDENTIAL"·"MIXED_USE" 등 자체 어휘
//   임대료·수익정책:        "C01_OFFICE" (facility_master.facility_code)
// 세 벌이 달라서 STEP 2에서 고른 시설 구성이 STEP 3 계산에 전혀 도달하지 못했다.
// 여기서는 facility_code 한 벌만 쓴다.
export const COMMERCIAL_CATEGORIES = [
  { key: "C01_OFFICE", label: "오피스 (OFFICE)" },
  { key: "C02_RETAIL", label: "리테일 (RETAIL)" },
  { key: "C03_HOSPITALITY", label: "호스피탈리티 (HOSPITALITY)" },
  { key: "C04_LIVING", label: "리빙·임대주택 (LIVING)" },
  { key: "C05_HEALTHCARE", label: "헬스케어 (HEALTHCARE)" },
  { key: "C06_EDUCATION", label: "교육 (EDUCATION)" },
  { key: "C07_CULTURE_ENTERTAINMENT", label: "문화·엔터테인먼트 (CULTURE)" },
  { key: "C08_RND_LAB", label: "R&D·랩 (R&D / LAB)" },
  { key: "C09_LOGISTICS", label: "물류 (LOGISTICS)" },
  { key: "C10_DIGITAL_INFRA", label: "디지털 인프라 (DIGITAL INFRA)" },
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
  trustFee: number | null;
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

/** STEP 2에서 고른 사업구조. /api/structure-policy가 돌려주는 값을 그대로 받는다. */
export type StructurePolicy = {
  structureCode: string;
  structureName: string;
  structureGroup: string;
  terminalValuePolicy: string;
  usesExitCapRate: boolean;
  dscrRequired: boolean;
  dscrMin: number | null;
  propertyTaxApplies: boolean | null;
  ownershipDuringOperation: string | null;
  /** 신탁보수 요율(%). 부동산신탁업무보수규정 기준. 신탁 구조가 아니면 null. */
  trustFeeRatePct?: number | null;
  /** 그 요율을 무엇에 곱하는지. 지금은 건설비(Construction CAPEX) 기준만 계산한다. */
  trustFeeBase?: string | null;
  trustFeeBasis?: string | null;
};

/** 금융 가정이 어디서 온 값인지. 화면에서 근거를 표시하기 위해 함께 돌려준다. */
export type AssumptionBasis = "USER" | "BENCHMARK" | "FALLBACK";

export type FinanceBasis = {
  appliedRatePct: number;
  rateBasis: AssumptionBasis;
  ltcPct: number;
  ltcBasis: AssumptionBasis;
};

export type IntegratedAnalysis = {
  totalCommercialSupportableGfa: number | null;
  fullDemandGfa: number | null;
  annualLandFee: number | null;
  capacities: ScenarioCapacity[];
  financialMatrix: FinancialCell[];
  financeBasis: FinanceBasis;
  structure: StructurePolicy | null;
  dscrPassMin: number;
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

/**
 * 2026-09-04: 대출금리 7.0% · LTC 75%를 상수로 박아두고 있었는데 둘 다 출처가 없었다.
 * 게다가 appliedRatePct 계산이 `selectedPfRate ?? (referenceRate + pfSpread)` 형태라
 * readSelectedPfRatePct()가 항상 숫자를 돌려주는 한 DB 기준값 경로는 한 번도 실행되지 않았다.
 *
 * 이제 세션에 사용자가 고른 값이 있을 때만 그 값을 쓰고, 없으면 화면이 /api/underwriting-defaults로
 * 채워 넣은 assumptions(한국은행 기준금리 + PF 스프레드, 전문가 설문 LTV)를 쓴다.
 * 둘 다 없을 때만 아래 최후 기본값으로 떨어지며, 그 사실이 판정 결과에 표시된다.
 */
const FALLBACK_PF_RATE_PCT = 7.0;
const FALLBACK_LTC_PCT = 65;
const MIN_LTC_PCT = 40;
const MAX_LTC_PCT = 85;
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

/** facility_master.category_code("C01")로 저장된 예전 값을 facility_code로 올린다. */
function normalizeFacilityCode(code: string): string {
  const legacy: Record<string, string> = {
    C01: "C01_OFFICE", C02: "C02_RETAIL", C03: "C03_HOSPITALITY", C04: "C04_LIVING",
    C05: "C05_HEALTHCARE", C06: "C06_EDUCATION", C07: "C07_CULTURE_ENTERTAINMENT",
    C08: "C08_RND_LAB", C09: "C09_LOGISTICS", C10: "C10_DIGITAL_INFRA",
  };
  return legacy[code] ?? code;
}

/**
 * STEP 2에서 고른 수익시설 배분을 읽는다.
 *
 * 2026-09-05까지 이 함수는 아무도 쓰지 않는 키(inrealtylab.commercialAllocation)를 보고 있었다.
 * ProgramChoice는 inrealtylab.step2Program에 저장하고 있었기 때문에, 사용자가 STEP 2에서
 * 무엇을 고르든 STEP 3은 항상 "오피스 100%" 기본값으로 계산했다.
 * 두 키를 모두 읽고, 시설코드도 한 벌로 맞춘다.
 */
function readCommercialAllocation(): CommercialAllocationSnapshot | null {
  if (typeof window === "undefined") return null;

  const fromAllocation = () => {
    const raw = window.sessionStorage.getItem("inrealtylab.commercialAllocation");
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CommercialAllocationSnapshot;
    if (!parsed || !Array.isArray(parsed.facilities) || !parsed.facilities.length) return null;
    return {
      ...parsed,
      facilities: parsed.facilities.map((item) => ({
        facilityCode: normalizeFacilityCode(String(item.facilityCode ?? "")),
        ratioPct: Number(item.ratioPct ?? 0),
      })),
    } satisfies CommercialAllocationSnapshot;
  };

  const fromProgram = () => {
    const raw = window.sessionStorage.getItem("inrealtylab.step2Program");
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { commercial?: Record<string, number> };
    const entries = Object.entries(parsed?.commercial ?? {}).filter(([, pct]) => Number(pct) > 0);
    if (!entries.length) return null;
    return {
      complete: true,
      facilities: entries.map(([code, pct]) => ({
        facilityCode: normalizeFacilityCode(code),
        ratioPct: Number(pct),
      })),
    } satisfies CommercialAllocationSnapshot;
  };

  try {
    return fromAllocation() ?? fromProgram();
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

/** 사용자가 화면에서 직접 고른 금리. 고르지 않았으면 null을 돌려줘야 DB 기준값이 쓰인다. */
function readSelectedPfRatePct(): number | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem("inrealtylab.pfRatePct");
    if (!raw) return null;
    const value = Number(raw);
    if (!Number.isFinite(value)) return null;
    return Math.min(15, Math.max(0, value));
  } catch {
    return null;
  }
}

/** 사용자가 직접 고른 LTC. 고르지 않았으면 null. */
function readSelectedLtcPct(): number | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem("inrealtylab.ltcPct");
    if (!raw) return null;
    const value = Number(raw);
    if (!Number.isFinite(value)) return null;
    return Math.round(Math.min(MAX_LTC_PCT, Math.max(MIN_LTC_PCT, value)));
  } catch {
    return null;
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

function classifyDscr(dscr: number | null, passMin: number = DSCR_PASS_MIN): FinancialCell["btoBotStatus"] {
  if (dscr === null || !Number.isFinite(dscr)) return "REVIEW";
  if (dscr < DSCR_CONDITIONAL_FLOOR) return "FAIL";
  if (dscr < passMin) return "CONDITIONAL";
  if (dscr < passMin + (DSCR_STRONG_MIN - DSCR_PASS_MIN)) return "PASS";
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
    const facilityCode = normalizeFacilityCode(String(facility.facilityCode ?? ""));
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
  /** STEP 2에서 고른 사업구조. 없으면 예전처럼 공통 기준으로 계산한다. */
  structure?: StructurePolicy | null;
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

    // 신탁 구조면 신탁보수를 사업비에 얹는다.
    // 부동산신탁업무보수규정 별표7 차입형토지신탁 개발보수 = 건설비 × 3/100 이내.
    // 나머지 보수(분양·성과)는 분양가액 기준이라 임대·운영형 사업에는 적용하지 않는다.
    const trustFeeRate = input.structure?.trustFeeRatePct ?? null;
    const trustFee = trustFeeRate === null || constructionCapex === null
      ? null
      : constructionCapex * trustFeeRate / 100;

    const totalProjectCost = constructionCapex === null
      ? null
      : constructionCapex * TOTAL_PROJECT_COST_FACTOR + (trustFee ?? 0);

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
      trustFee,
      totalProjectCost,
    };
  });

  const legacyMonthlyRent = nonNegative(input.assumptions.monthlyRentPerSqm);
  const legacyOpexPct = nonNegative(input.assumptions.opexPct);
  const referenceRate = nonNegative(input.assumptions.referenceRatePct);
  const pfSpread = nonNegative(input.assumptions.pfSpreadPct);
  // 사업구조가 정한 DSCR 기준이 있으면 그 값을 쓴다. 없으면 Part 3 공통 기본값 1.20.
  const structure = input.structure ?? null;
  const dscrPassMin =
    structure && typeof structure.dscrMin === "number" && structure.dscrMin > 0
      ? structure.dscrMin
      : DSCR_PASS_MIN;

  // 우선순위: 사용자가 화면에서 고른 값 → DB 기준값으로 채워진 assumptions → 최후 기본값
  const selectedPfRate = readSelectedPfRatePct();
  const derivedRatePct =
    referenceRate === null || pfSpread === null ? null : referenceRate + pfSpread;
  const appliedRatePctBase = selectedPfRate ?? derivedRatePct ?? FALLBACK_PF_RATE_PCT;
  const rateBasis: "USER" | "BENCHMARK" | "FALLBACK" =
    selectedPfRate !== null ? "USER" : derivedRatePct !== null ? "BENCHMARK" : "FALLBACK";

  const selectedLtc = readSelectedLtcPct();
  const assumedDebtRatio = nonNegative(input.assumptions.debtRatioPct);
  const selectedLtcPct = selectedLtc ?? assumedDebtRatio ?? FALLBACK_LTC_PCT;
  const ltcBasis: "USER" | "BENCHMARK" | "FALLBACK" =
    selectedLtc !== null ? "USER" : assumedDebtRatio !== null ? "BENCHMARK" : "FALLBACK";
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
    const appliedRatePct = appliedRatePctBase;
    const appliedRate = appliedRatePct / 100;
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

    const btoBotStatus = classifyDscr(dscr, dscrPassMin);
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
    financeBasis: {
      appliedRatePct: appliedRatePctBase,
      rateBasis,
      ltcPct: selectedLtcPct,
      ltcBasis,
    },
    structure,
    dscrPassMin,
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
