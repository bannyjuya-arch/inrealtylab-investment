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
  btoBotStatus: "FAIL" | "PASS" | "STRONG" | "REVIEW";
  projectIrr: number | null;
  reitsStatus: "FAIL" | "PASS" | "REVIEW";
  investorReturnSatisfied: boolean | null;
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
  if (dscr < 1.2) return "FAIL";
  if (dscr < 1.3) return "PASS";
  return "STRONG";
}

function classifyIrr(irr: number | null): FinancialCell["reitsStatus"] {
  if (irr === null || !Number.isFinite(irr)) return "REVIEW";
  return irr >= 0.06 ? "PASS" : "FAIL";
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
      ? "REVIEW"
      : demandGapGfa < 0
        ? "SHORT"
        : demandGapGfa === 0
          ? "EXACT"
          : "EXCESS";

    const selectedCommercialGfa = publicRequiredGfa === null || commercialSupportableGfa === null
      ? null
      : Math.min(commercialSupportableGfa, Math.max(0, aboveGroundGfa - publicRequiredGfa));

    const constructionCapex = totalConstructionGfa === null || costPerSqm === null
      ? null
      : totalConstructionGfa * costPerSqm;

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
    };
  });

  const monthlyRent = nonNegative(input.assumptions.monthlyRentPerSqm);
  const occupancy = Math.min(95, Math.max(80, input.assumptions.occupancyPct)) / 100;
  const opexPct = nonNegative(input.assumptions.opexPct);
  const referenceRate = nonNegative(input.assumptions.referenceRatePct);
  const pfSpread = nonNegative(input.assumptions.pfSpreadPct);
  const debtRatio = nonNegative(input.assumptions.debtRatioPct);
  const debtTenor = nonNegative(input.assumptions.debtTenorYears);
  const investorRequiredReturn = nonNegative(input.assumptions.investorRequiredReturnPct);
  const otherAnnualRevenue = nonNegative(input.assumptions.otherAnnualRevenue) ?? 0;

  const financialMatrix = capacities.flatMap((capacity) => CONCESSION_TERMS.map((term): FinancialCell => {
    const annualRevenue = capacity.selectedCommercialGfa === null || monthlyRent === null
      ? null
      : capacity.selectedCommercialGfa * monthlyRent * 12 * occupancy + otherAnnualRevenue;
    const annualOpex = annualRevenue === null || opexPct === null ? null : annualRevenue * (opexPct / 100);
    const annualProjectCashflow = annualRevenue === null || annualOpex === null || annualLandFee === null
      ? null
      : annualRevenue - annualOpex - annualLandFee;

    const debtAmount = capacity.constructionCapex === null || debtRatio === null
      ? null
      : capacity.constructionCapex * (debtRatio / 100);
    const appliedRate = referenceRate === null || pfSpread === null ? null : (referenceRate + pfSpread) / 100;
    const effectiveDebtTenor = debtTenor === null ? null : Math.max(1, Math.min(term, Math.round(debtTenor)));
    const annualDebtService = debtAmount === null || appliedRate === null || effectiveDebtTenor === null
      ? null
      : annuityPayment(debtAmount, appliedRate, effectiveDebtTenor);
    const dscr = annualProjectCashflow === null || annualDebtService === null || annualDebtService <= 0
      ? null
      : annualProjectCashflow / annualDebtService;

    const projectIrr = capacity.constructionCapex === null || annualProjectCashflow === null
      ? null
      : calculateIrr([
          -capacity.constructionCapex,
          ...Array.from({ length: term }, () => annualProjectCashflow),
        ]);

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
      btoBotStatus: classifyDscr(dscr),
      projectIrr,
      reitsStatus: classifyIrr(projectIrr),
      investorReturnSatisfied: projectIrr === null || investorRequiredReturn === null
        ? null
        : projectIrr >= investorRequiredReturn / 100,
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
