/**
 * 상한용적률 인센티브 산정 모듈 (비협상 트랙)
 *
 * 근거: 서울특별시 「도시계획변경 사전협상제도 업무편람」(2025.07.19)
 *       제1권 1-3-5 ~ 1-3-6, 제3장 3-1-1 ~ 3-1-4
 *       「서울시 지구단위계획 수립기준」 / 「공공시설등 기부채납 용적률 인센티브 운영기준」
 *
 * ─────────────────────────────────────────────────────────────
 * 사전협상 트랙과 방향이 반대다.
 *
 *   협상  : 용도지역 변경  →  공공기여 의무량 산출 (편람 4.31~4.39)
 *   비협상: 기부채납 제공  →  용적률 인센티브 획득 (편람 3-1-1)
 *
 * 상한용적률 산정식 (편람 3-1-1)
 *
 *   상한용적률 = 허용(기준)용적률
 *                × (1 + 1.3 × 가중치 × α토지
 *                     + (0.7~1.2) × α건축물
 *                     + (0.7~1.0) × α현금)
 *
 *   α = 제공하는 면적 / 공공시설등 부지 제공 후 대지면적   (편람 1-3-5)
 *   가중치 = 공공시설등 제공부지 허용용적률 / 사업부지 허용용적률  (편람 1-3-6)
 * ─────────────────────────────────────────────────────────────
 */

/** 사전협상 대상 최소 면적 (㎡) — 편람: 5천㎡ 이상 유휴부지·대규모 시설 이전부지 */
export const NEGOTIATION_MIN_SITE_AREA_SQM = 5000;

/** 토지 기부채납 계수 (편람 3-1-1 고정) */
export const LAND_COEFFICIENT = 1.3;

/** 건축물 설치비용 환산 계수 범위 (편람 3-1-1) */
export const BUILDING_COEFFICIENT_RANGE = { min: 0.7, max: 1.2, default: 1.0 } as const;

/** 현금 환산 계수 범위 (편람 3-1-1) */
export const CASH_COEFFICIENT_RANGE = { min: 0.7, max: 1.0, default: 1.0 } as const;

export type FarIncentiveInput = {
  /** 사업부지 면적 (㎡) — 기부채납 제공 전 */
  siteAreaSqm: number | null;
  /** 허용(기준)용적률 (%) — 편람 3-1-2 */
  allowableFarPct: number | null;

  /** 토지·대지지분으로 제공하는 면적 (㎡) */
  landContributionSqm?: number | null;
  /** 건축물 설치비용 환산부지 면적 (㎡) */
  buildingContributionSqm?: number | null;
  /** 현금 환산부지 면적 (㎡) */
  cashContributionSqm?: number | null;

  /** 공공시설등 제공부지의 허용(기준)용적률 (%) — 가중치 산정용 */
  contributionSiteFarPct?: number | null;
  /** 가중치 직접 지정. 지정 시 위 값보다 우선 */
  overrideWeight?: number | null;

  /** 건축물 환산 계수 (0.7~1.2). 미지정 시 1.0 */
  buildingCoefficient?: number | null;
  /** 현금 환산 계수 (0.7~1.0). 미지정 시 1.0 */
  cashCoefficient?: number | null;

  /** 법정 상한용적률 (%). 지정 시 결과를 이 값으로 제한 */
  statutoryCapFarPct?: number | null;
};

export type FarIncentiveResult = {
  /** 가중치 */
  weight: number;
  alphaLand: number;
  alphaBuilding: number;
  alphaCash: number;
  /** 기부채납 제공 후 대지면적 (㎡) */
  netSiteAreaSqm: number | null;
  /** 인센티브 배수 (1 + ...) */
  incentiveMultiplier: number | null;
  /** 상한용적률 (%) */
  maxFarPct: number | null;
  /** 증가한 용적률 (%p) */
  farGainPct: number | null;
  /** 상한 적용으로 잘린 경우 true */
  cappedByStatute: boolean;
  /** 제공 후 대지 기준 확보 연면적 (㎡) */
  achievableGfaSqm: number | null;
  basis: string[];
  unavailableReason: string | null;
};

function positive(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isFinite(value) || value <= 0) return null;
  return value;
}

function nonNegative(value: number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  if (!Number.isFinite(value) || value < 0) return 0;
  return value;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

/**
 * 사전협상 대상 여부 판단 보조.
 * 편람: 5천㎡ 이상 유휴부지 또는 대규모 시설 이전부지.
 * 면적은 자동 판정되나 "유휴부지·이전부지" 요건은 자동 판단이 불가하므로
 * 최종 결정은 사용자 입력(isNegotiationTrack)을 따른다.
 */
export function suggestNegotiationTrack(siteAreaSqm: number | null): {
  meetsAreaThreshold: boolean;
  note: string;
} {
  const area = positive(siteAreaSqm);
  if (area === null) {
    return { meetsAreaThreshold: false, note: "부지면적이 확인되지 않아 판단할 수 없습니다." };
  }
  if (area >= NEGOTIATION_MIN_SITE_AREA_SQM) {
    return {
      meetsAreaThreshold: true,
      note: `부지면적 ${Math.round(area).toLocaleString("ko-KR")}㎡ — 사전협상 면적요건(5,000㎡ 이상) 충족. 유휴부지·대규모 시설 이전부지 해당 여부는 별도 확인이 필요합니다.`,
    };
  }
  return {
    meetsAreaThreshold: false,
    note: `부지면적 ${Math.round(area).toLocaleString("ko-KR")}㎡ — 사전협상 면적요건(5,000㎡ 이상) 미달. 지구단위계획 인센티브 트랙으로 검토합니다.`,
  };
}

/** 편람 1-3-6 — 가중치 = 제공부지 허용용적률 / 사업부지 허용용적률 */
export function resolveWeight(input: FarIncentiveInput): number {
  const override = input.overrideWeight;
  if (override !== null && override !== undefined && Number.isFinite(override) && override > 0) {
    return override;
  }
  const contributionFar = positive(input.contributionSiteFarPct);
  const siteFar = positive(input.allowableFarPct);
  if (contributionFar === null || siteFar === null) return 1.0;
  return contributionFar / siteFar;
}

/**
 * 편람 3-1-1 — 상한용적률 인센티브 산정.
 *
 * α 분모가 "제공 후 대지면적"임에 유의한다. 토지를 많이 낼수록 분모가
 * 작아져 α가 커지므로, 인센티브가 체증한다.
 */
export function calculateFarIncentive(input: FarIncentiveInput): FarIncentiveResult {
  const empty: FarIncentiveResult = {
    weight: 1,
    alphaLand: 0,
    alphaBuilding: 0,
    alphaCash: 0,
    netSiteAreaSqm: null,
    incentiveMultiplier: null,
    maxFarPct: null,
    farGainPct: null,
    cappedByStatute: false,
    achievableGfaSqm: null,
    basis: [],
    unavailableReason: null,
  };

  const siteArea = positive(input.siteAreaSqm);
  const allowableFar = positive(input.allowableFarPct);
  if (siteArea === null) return { ...empty, unavailableReason: "사업부지 면적이 확인되지 않았습니다." };
  if (allowableFar === null) {
    return { ...empty, unavailableReason: "허용(기준)용적률이 확인되지 않았습니다." };
  }

  const land = nonNegative(input.landContributionSqm);
  const building = nonNegative(input.buildingContributionSqm);
  const cash = nonNegative(input.cashContributionSqm);

  // 편람 1-3-5 — 분모는 토지·대지지분 제공 후 대지면적
  const netSiteAreaSqm = siteArea - land;
  if (netSiteAreaSqm <= 0) {
    return { ...empty, unavailableReason: "토지 기부채납 면적이 사업부지 면적 이상입니다." };
  }

  const alphaLand = land / netSiteAreaSqm;
  const alphaBuilding = building / netSiteAreaSqm;
  const alphaCash = cash / netSiteAreaSqm;

  const weight = resolveWeight(input);
  const buildingCoef = clamp(
    input.buildingCoefficient ?? BUILDING_COEFFICIENT_RANGE.default,
    BUILDING_COEFFICIENT_RANGE.min,
    BUILDING_COEFFICIENT_RANGE.max
  );
  const cashCoef = clamp(
    input.cashCoefficient ?? CASH_COEFFICIENT_RANGE.default,
    CASH_COEFFICIENT_RANGE.min,
    CASH_COEFFICIENT_RANGE.max
  );

  const incentiveMultiplier =
    1 + LAND_COEFFICIENT * weight * alphaLand + buildingCoef * alphaBuilding + cashCoef * alphaCash;

  let maxFarPct = allowableFar * incentiveMultiplier;
  let cappedByStatute = false;
  const cap = positive(input.statutoryCapFarPct);
  if (cap !== null && maxFarPct > cap) {
    maxFarPct = cap;
    cappedByStatute = true;
  }

  const round = (n: number) => Math.round(n).toLocaleString("ko-KR");
  const basis: string[] = [
    `허용(기준)용적률 ${allowableFar}% (편람 3-1-2)`,
    `제공 후 대지면적 ${round(netSiteAreaSqm)}㎡ = 사업부지 ${round(siteArea)}㎡ − 토지제공 ${round(land)}㎡`,
  ];
  if (land > 0) {
    basis.push(
      `α토지 ${alphaLand.toFixed(4)} × 계수 ${LAND_COEFFICIENT} × 가중치 ${weight.toFixed(3)}`
    );
  }
  if (building > 0) basis.push(`α건축물 ${alphaBuilding.toFixed(4)} × 계수 ${buildingCoef}`);
  if (cash > 0) basis.push(`α현금 ${alphaCash.toFixed(4)} × 계수 ${cashCoef}`);
  basis.push(
    `상한용적률 = ${allowableFar}% × ${incentiveMultiplier.toFixed(4)} = ${maxFarPct.toFixed(1)}% (편람 3-1-1)`
  );
  if (cappedByStatute) basis.push(`법정 상한 ${cap}% 적용으로 제한`);

  return {
    weight,
    alphaLand,
    alphaBuilding,
    alphaCash,
    netSiteAreaSqm,
    incentiveMultiplier,
    maxFarPct,
    farGainPct: maxFarPct - allowableFar,
    cappedByStatute,
    achievableGfaSqm: Math.round(netSiteAreaSqm * (maxFarPct / 100)),
    basis,
    unavailableReason: null,
  };
}

/**
 * 목표 상한용적률에 도달하는 데 필요한 토지 기부채납 면적을 역산한다.
 * 건축물·현금 제공이 없다고 가정.
 *
 *   목표배수 = 1 + 1.3 × 가중치 × land / (site − land)
 *   ⇒ land = site × k / (1.3 × weight + k),  k = 목표배수 − 1
 */
export function requiredLandContributionFor(
  targetFarPct: number | null,
  input: FarIncentiveInput
): number | null {
  const target = positive(targetFarPct);
  const siteArea = positive(input.siteAreaSqm);
  const allowableFar = positive(input.allowableFarPct);
  if (target === null || siteArea === null || allowableFar === null) return null;
  if (target <= allowableFar) return 0;

  const k = target / allowableFar - 1;
  const weight = resolveWeight(input);
  const denominator = LAND_COEFFICIENT * weight + k;
  if (denominator <= 0) return null;

  return Math.round((siteArea * k) / denominator);
}
