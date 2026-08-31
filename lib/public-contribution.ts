/**
 * 공공기여 산정 모듈
 *
 * 근거: 서울특별시 「도시계획변경 사전협상제도 업무편람」(2025.07.19)
 *       제1권 4.31 ~ 4.39 / 서울특별시 도시계획조례 제20조
 *
 * 특허 10-2026-0144458 청구항 9·10·14·16 대응.
 *
 * ─────────────────────────────────────────────────────────────
 * 산정 순서 (편람 4.37 → 4.38 → 4.39)
 *
 *   ① 공공기여 기준 대지면적
 *      = [{1 − (도시계획시설 건축연면적 / 건축 총연면적)}
 *         × (계획용적률 / 당해 용도지역 법정최대용적률)] × 부지면적
 *
 *   ② 공공기여 토지면적 = 기준 대지면적 × 공공기여율
 *
 *   ③ 총 공공기여량 = 공공기여 토지면적 × ㎡당 종후 감정평가액
 *
 * 이전 버전은 지가 탄력성을 임의로 가정했으나, 편람에 확정 산정식이
 * 있으므로 전부 폐기하고 이 방식으로 대체했다.
 * ─────────────────────────────────────────────────────────────
 */

/** 용도지역 변경 유형 (편람 4.31 표 1) */
export type ZoneChangeKey =
  | "JUN_TO_COMMERCIAL"
  | "R3_TO_COMMERCIAL"
  | "R2_TO_COMMERCIAL"
  | "R1_TO_COMMERCIAL";

/** 도시계획시설 폐지(복합화) 유형 (편람 4.31 표 2, 6장) */
export type FacilityAbolitionKey =
  | "ABOLITION_R_TO_COMMERCIAL"
  | "ABOLITION_R_TO_JUN"
  | "ABOLITION_NO_ZONE_CHANGE"
  | "RAILWAY_COMPLEX";

/** 편람 4.31 표 1) 용도지역 변경에 따른 공공기여율 */
export const ZONE_CHANGE_RATES: Record<ZoneChangeKey, { label: string; ratePct: number }> = {
  JUN_TO_COMMERCIAL: { label: "준주거지역 → 일반상업지역", ratePct: 30 },
  R3_TO_COMMERCIAL: { label: "제3종일반주거지역 → 일반상업지역", ratePct: 40 },
  R2_TO_COMMERCIAL: { label: "제2종일반주거지역 → 일반상업지역", ratePct: 45 },
  R1_TO_COMMERCIAL: { label: "제1종일반주거지역 → 일반상업지역", ratePct: 48 },
};

/** 편람 4.31 표 2) 도시계획시설 폐지(복합화)에 따른 공공기여율 */
export const FACILITY_ABOLITION_RATES: Record<
  FacilityAbolitionKey,
  { label: string; ratePct: number }
> = {
  ABOLITION_R_TO_COMMERCIAL: { label: "시설폐지 · 일반주거 → 일반상업", ratePct: 35 },
  ABOLITION_R_TO_JUN: { label: "시설폐지 · 일반주거 → 준주거", ratePct: 25 },
  ABOLITION_NO_ZONE_CHANGE: { label: "시설폐지 · 용도지역 변경 없음", ratePct: 20 },
  RAILWAY_COMPLEX: { label: "철도역사 복합개발", ratePct: 10 },
};

/** 편람 4.32 — 시설폐지와 용도지역 상향이 중첩되면 합산 후 5%p 감 */
export const OVERLAP_DEDUCTION_PCT = 5;

/** 원칙 적용분 — 증가된 용적률의 6/10 (편람 4.31) */
export const DEFAULT_UPLIFT_SHARE = 6 / 10;

/** 균형발전형 사전협상 보정 구간 (편람 4.31) */
export const BALANCED_DEVELOPMENT_TIERS = [
  { nonResidentialPctFrom: 50, upliftShare: 5 / 10 },
  { nonResidentialPctFrom: 60, upliftShare: 4 / 10 },
  { nonResidentialPctFrom: 70, upliftShare: 3 / 10 },
] as const;

export type PublicContributionInput = {
  /** 부지면적 (㎡) */
  siteAreaSqm: number | null;
  /** 계획용적률 (%). 없으면 법정최대용적률 (편람 4.37 단서) */
  plannedFarPct?: number | null;
  /** 당해(종후) 용도지역 법정최대용적률 (%) */
  statutoryMaxFarPct: number | null;
  /** 종후 감정평가액 (원/㎡). 공시지가가 아님에 유의 */
  postValuationPerSqm: number | null;

  zoneChange?: ZoneChangeKey | null;
  facilityAbolition?: FacilityAbolitionKey | null;
  /** 협상 확정 공공기여율 (%). 표 값보다 우선 */
  overrideRatePct?: number | null;

  /** 도시계획시설 건축연면적 (㎡) — 복합화 시 (편람 4.37) */
  facilityGfaSqm?: number | null;
  /** 건축 총연면적 (㎡) */
  totalGfaSqm?: number | null;

  /** 시설결정 당시 용도지역이 변경된 경우 1/2 적용 (편람 4.31 각주) */
  halveZoneChangeRate?: boolean;

  /** 비주거시설(준주택 제외) 설치비율 (%) */
  nonResidentialRatioPct?: number | null;
  /** 균형발전형 사전협상 여부 */
  isBalancedDevelopment?: boolean;

  /** 공익사업 감면 (%p). 협상조정협의회 결정사항 (편람 4.33·4.34) */
  publicInterestReductionPct?: number | null;
};

export type PublicContributionResult = {
  appliedRatePct: number | null;
  /** 공공기여 기준 대지면적 (㎡) — 편람 4.37 */
  baseSiteAreaSqm: number | null;
  /** 공공기여 토지면적 (㎡) — 편람 4.38 */
  contributionLandAreaSqm: number | null;
  /** 총 공공기여량 (원) — 편람 4.39 */
  totalContributionAmount: number | null;
  /** 토지가치 적용 기준 (증가 용적률 대비 몫) */
  upliftShare: number;
  basis: string[];
  unavailableReason: string | null;
};

function positive(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isFinite(value) || value <= 0) return null;
  return value;
}

/**
 * 균형발전형 사전협상의 토지가치 적용 기준.
 * 비주거 50/60/70% 이상에서 각각 5/10, 4/10, 3/10. 구간 사이는 직선보간.
 */
export function resolveUpliftShare(
  isBalancedDevelopment: boolean,
  nonResidentialRatioPct: number | null | undefined
): number {
  if (!isBalancedDevelopment) return DEFAULT_UPLIFT_SHARE;
  const ratio = positive(nonResidentialRatioPct);
  if (ratio === null || ratio < 50) return DEFAULT_UPLIFT_SHARE;
  if (ratio >= 70) return 3 / 10;

  const lower = ratio < 60 ? BALANCED_DEVELOPMENT_TIERS[0] : BALANCED_DEVELOPMENT_TIERS[1];
  const upper = ratio < 60 ? BALANCED_DEVELOPMENT_TIERS[1] : BALANCED_DEVELOPMENT_TIERS[2];
  const span = upper.nonResidentialPctFrom - lower.nonResidentialPctFrom;
  const t = (ratio - lower.nonResidentialPctFrom) / span;
  return lower.upliftShare + (upper.upliftShare - lower.upliftShare) * t;
}

/** 편람 4.31·4.32 — 적용 공공기여율 결정 */
export function resolveContributionRatePct(input: PublicContributionInput): {
  ratePct: number | null;
  notes: string[];
} {
  const notes: string[] = [];

  const override = input.overrideRatePct;
  if (override !== null && override !== undefined && Number.isFinite(override)) {
    notes.push(`협상 확정 공공기여율 ${override}% 적용`);
    return { ratePct: override, notes };
  }

  let zoneRate: number | null = null;
  if (input.zoneChange) {
    const entry = ZONE_CHANGE_RATES[input.zoneChange];
    zoneRate = entry.ratePct;
    if (input.halveZoneChangeRate) {
      zoneRate = zoneRate / 2;
      notes.push(`${entry.label} ${entry.ratePct}% → 1/2 적용 ${zoneRate}% (시설결정 당시 용도지역 변경)`);
    } else {
      notes.push(`${entry.label} ${zoneRate}% (편람 4.31)`);
    }
  }

  let abolitionRate: number | null = null;
  if (input.facilityAbolition) {
    const entry = FACILITY_ABOLITION_RATES[input.facilityAbolition];
    abolitionRate = entry.ratePct;
    notes.push(`${entry.label} ${abolitionRate}% (편람 4.31)`);
  }

  if (zoneRate === null && abolitionRate === null) return { ratePct: null, notes };

  if (zoneRate !== null && abolitionRate !== null) {
    const combined = zoneRate + abolitionRate - OVERLAP_DEDUCTION_PCT;
    notes.push(`중첩 적용 · 합산 후 ${OVERLAP_DEDUCTION_PCT}%p 감 = ${combined}% (편람 4.32)`);
    return { ratePct: combined, notes };
  }

  return { ratePct: zoneRate ?? abolitionRate, notes };
}

/** 편람 4.37 — 공공기여 기준 대지면적 */
export function calculateBaseSiteArea(input: PublicContributionInput): number | null {
  const siteArea = positive(input.siteAreaSqm);
  const statutoryFar = positive(input.statutoryMaxFarPct);
  if (siteArea === null || statutoryFar === null) return null;

  const facilityGfa = positive(input.facilityGfaSqm);
  const totalGfa = positive(input.totalGfaSqm);
  const facilityShare =
    facilityGfa !== null && totalGfa !== null ? Math.min(1, facilityGfa / totalGfa) : 0;

  const plannedFar = positive(input.plannedFarPct) ?? statutoryFar;
  const farRatio = plannedFar / statutoryFar;

  return (1 - facilityShare) * farRatio * siteArea;
}

/** 편람 4.37 → 4.38 → 4.39 전체 산정 */
export function calculatePublicContribution(
  input: PublicContributionInput
): PublicContributionResult {
  const upliftShare = resolveUpliftShare(
    input.isBalancedDevelopment ?? false,
    input.nonResidentialRatioPct
  );

  const empty: PublicContributionResult = {
    appliedRatePct: null,
    baseSiteAreaSqm: null,
    contributionLandAreaSqm: null,
    totalContributionAmount: null,
    upliftShare,
    basis: [],
    unavailableReason: null,
  };

  if (positive(input.siteAreaSqm) === null) {
    return { ...empty, unavailableReason: "부지면적이 확인되지 않았습니다." };
  }
  if (positive(input.statutoryMaxFarPct) === null) {
    return { ...empty, unavailableReason: "법정최대용적률이 확인되지 않았습니다." };
  }

  const { ratePct: rawRate, notes } = resolveContributionRatePct(input);
  if (rawRate === null) {
    return {
      ...empty,
      unavailableReason:
        "용도지역 변경 또는 시설폐지 유형이 지정되지 않아 공공기여율을 정할 수 없습니다.",
    };
  }

  const reduction = input.publicInterestReductionPct ?? 0;
  const appliedRatePct = Math.max(0, rawRate - reduction);
  if (reduction > 0) {
    notes.push(`공익사업 감면 ${reduction}%p 적용 → ${appliedRatePct}% (편람 4.33)`);
  }

  const baseSiteAreaSqm = calculateBaseSiteArea(input);
  if (baseSiteAreaSqm === null) {
    return { ...empty, appliedRatePct, basis: notes, unavailableReason: "기준 대지면적을 산정할 수 없습니다." };
  }

  const contributionLandAreaSqm = baseSiteAreaSqm * (appliedRatePct / 100);
  const round = (n: number) => Math.round(n).toLocaleString("ko-KR");

  const basis = [
    `공공기여 기준 대지면적 ${round(baseSiteAreaSqm)}㎡ (편람 4.37)`,
    ...notes,
    `공공기여 토지면적 = ${round(baseSiteAreaSqm)}㎡ × ${appliedRatePct}% = ${round(contributionLandAreaSqm)}㎡ (편람 4.38)`,
  ];

  const valuation = positive(input.postValuationPerSqm);
  if (valuation === null) {
    return {
      appliedRatePct,
      baseSiteAreaSqm,
      contributionLandAreaSqm,
      totalContributionAmount: null,
      upliftShare,
      basis,
      unavailableReason: "종후 감정평가액이 없어 총 공공기여량을 산정하지 못했습니다.",
    };
  }

  const totalContributionAmount = contributionLandAreaSqm * valuation;
  basis.push(
    `총 공공기여량 = ${round(contributionLandAreaSqm)}㎡ × ${valuation.toLocaleString("ko-KR")}원/㎡ (편람 4.39)`
  );

  return {
    appliedRatePct,
    baseSiteAreaSqm,
    contributionLandAreaSqm,
    totalContributionAmount,
    upliftShare,
    basis,
    unavailableReason: null,
  };
}

/**
 * 공공기여를 건축물 내 시설로 제공할 경우의 환산 연면적.
 * 편람 4.41 — 설치비용은 도시계획조례 제21조 등을 준용.
 */
export function toFacilityGfa(
  totalContributionAmount: number | null,
  facilityCostPerSqm: number | null
): number | null {
  const amount = positive(totalContributionAmount);
  const cost = positive(facilityCostPerSqm);
  if (amount === null || cost === null) return null;
  return Math.round(amount / cost);
}

/** 지상 연면적 대비 공공기여 비율 (%) — 청구항 10 연결용 */
export function toContributionPct(
  publicGfaSqm: number | null,
  aboveGroundGfaSqm: number | null
): number | null {
  const required = positive(publicGfaSqm);
  const total = positive(aboveGroundGfaSqm);
  if (required === null || total === null) return null;
  return Math.min(100, (required / total) * 100);
}

export type ContributionSweepPoint = {
  contributionPct: number;
  publicGfaSqm: number;
  commercialGfaSqm: number;
};

/**
 * 청구항 14·16 — 공공기여 비율별 연면적 배분 곡선.
 * 기부채납분도 시공 대상이므로 총공사비는 줄지 않는다.
 * 줄어드는 것은 임대 가능 면적, 즉 수익뿐이다.
 */
export function sweepContributionRatios(
  aboveGroundGfaSqm: number | null,
  options: { maxPct?: number; stepPct?: number } = {}
): ContributionSweepPoint[] {
  const total = positive(aboveGroundGfaSqm);
  if (total === null) return [];

  const maxPct = options.maxPct ?? 50;
  const stepPct = options.stepPct ?? 1;

  const points: ContributionSweepPoint[] = [];
  for (let pct = 0; pct <= maxPct + 1e-9; pct += stepPct) {
    const publicGfaSqm = Math.round(total * (pct / 100));
    points.push({
      contributionPct: Number(pct.toFixed(2)),
      publicGfaSqm,
      commercialGfaSqm: Math.round(total - publicGfaSqm),
    });
  }
  return points;
}

/** PASS 를 유지하는 최대 공공기여 지점 */
export function findBalancePoint<T extends { contributionPct: number }>(
  points: T[],
  isPass: (point: T) => boolean
): T | null {
  let best: T | null = null;
  for (const point of points) {
    if (isPass(point)) best = point;
    else break;
  }
  return best;
}
