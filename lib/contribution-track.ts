/**
 * 공공기여 트랙 분기
 *
 * 부지마다 사전협상 대상 여부가 다르므로 두 트랙을 하나의 입력으로 받아
 * 분기 처리한다. 근거는 모두 서울시 「도시계획변경 사전협상제도 업무편람」(2025.07.19).
 *
 *   NEGOTIATION     사전협상 대상 (5천㎡ 이상 유휴부지·대규모 시설 이전부지)
 *                   용도지역 변경 → 공공기여 의무량 산출 (편람 4.31~4.39)
 *
 *   FAR_INCENTIVE   비협상 (지구단위계획)
 *                   기부채납 제공 → 상한용적률 인센티브 (편람 3-1-1)
 */

import {
  calculatePublicContribution,
  toFacilityGfa,
  toContributionPct,
  type PublicContributionInput,
  type PublicContributionResult,
} from "./public-contribution";
import {
  calculateFarIncentive,
  suggestNegotiationTrack,
  type FarIncentiveInput,
  type FarIncentiveResult,
} from "./far-incentive";

export type ContributionTrack = "NEGOTIATION" | "FAR_INCENTIVE";

export type ContributionTrackInput = {
  /**
   * 사전협상 대상 여부. 사용자가 직접 지정한다.
   * 면적요건은 자동 판정되지만 "유휴부지·대규모 시설 이전부지" 해당 여부는
   * 자동 판단할 수 없으므로 이 값이 최종 기준이다.
   */
  isNegotiationTrack: boolean;
  /** 공공기여를 건축물 내 시설로 제공할 때의 조성원가 (원/㎡) */
  facilityCostPerSqm?: number | null;
  /** 지상 연면적 (㎡) — 공공기여 비율 환산용 */
  aboveGroundGfaSqm?: number | null;
  negotiation?: PublicContributionInput;
  farIncentive?: FarIncentiveInput;
};

export type ContributionTrackResult = {
  track: ContributionTrack;
  trackLabel: string;
  /** 면적요건 자동 판정 결과 — 사용자 선택과 어긋나면 경고로 쓴다 */
  areaThreshold: { meetsAreaThreshold: boolean; note: string };
  /** 사용자 선택과 면적요건이 어긋날 때의 안내. 없으면 null */
  trackWarning: string | null;

  negotiation: PublicContributionResult | null;
  farIncentive: FarIncentiveResult | null;

  /** 두 트랙 공통 — 공공기여로 확보해야 할 연면적 (㎡) */
  publicGfaSqm: number | null;
  /** 지상 연면적 대비 비율 (%) */
  publicContributionPct: number | null;
  /** 보고서에 실을 산출 근거 */
  basis: string[];
  unavailableReason: string | null;
};

export function resolveContribution(input: ContributionTrackInput): ContributionTrackResult {
  const siteAreaSqm =
    input.negotiation?.siteAreaSqm ?? input.farIncentive?.siteAreaSqm ?? null;
  const areaThreshold = suggestNegotiationTrack(siteAreaSqm);

  let trackWarning: string | null = null;
  if (input.isNegotiationTrack && !areaThreshold.meetsAreaThreshold && siteAreaSqm !== null) {
    trackWarning =
      "사전협상 대상으로 지정되었으나 면적요건(5,000㎡ 이상)에 미달합니다. 대상 여부를 확인하세요.";
  }
  if (!input.isNegotiationTrack && areaThreshold.meetsAreaThreshold) {
    trackWarning =
      "면적요건(5,000㎡ 이상)을 충족합니다. 유휴부지·대규모 시설 이전부지에 해당하면 사전협상 대상일 수 있습니다.";
  }

  if (input.isNegotiationTrack) {
    if (!input.negotiation) {
      return {
        track: "NEGOTIATION",
        trackLabel: "사전협상",
        areaThreshold,
        trackWarning,
        negotiation: null,
        farIncentive: null,
        publicGfaSqm: null,
        publicContributionPct: null,
        basis: [],
        unavailableReason: "사전협상 산정에 필요한 입력이 없습니다.",
      };
    }

    const result = calculatePublicContribution(input.negotiation);
    const publicGfaSqm = toFacilityGfa(
      result.totalContributionAmount,
      input.facilityCostPerSqm ?? null
    );

    return {
      track: "NEGOTIATION",
      trackLabel: "사전협상",
      areaThreshold,
      trackWarning,
      negotiation: result,
      farIncentive: null,
      publicGfaSqm,
      publicContributionPct: toContributionPct(publicGfaSqm, input.aboveGroundGfaSqm ?? null),
      basis: result.basis,
      unavailableReason: result.unavailableReason,
    };
  }

  if (!input.farIncentive) {
    return {
      track: "FAR_INCENTIVE",
      trackLabel: "지구단위계획 인센티브",
      areaThreshold,
      trackWarning,
      negotiation: null,
      farIncentive: null,
      publicGfaSqm: null,
      publicContributionPct: null,
      basis: [],
      unavailableReason: "상한용적률 인센티브 산정에 필요한 입력이 없습니다.",
    };
  }

  const result = calculateFarIncentive(input.farIncentive);
  // 비협상 트랙에서 공공기여 연면적은 건축물 환산부지에 허용용적률을 곱해 본다
  const buildingSqm = input.farIncentive.buildingContributionSqm ?? 0;
  const allowableFar = input.farIncentive.allowableFarPct ?? 0;
  const publicGfaSqm = buildingSqm > 0 && allowableFar > 0
    ? Math.round(buildingSqm * (allowableFar / 100))
    : null;

  return {
    track: "FAR_INCENTIVE",
    trackLabel: "지구단위계획 인센티브",
    areaThreshold,
    trackWarning,
    negotiation: null,
    farIncentive: result,
    publicGfaSqm,
    publicContributionPct: toContributionPct(publicGfaSqm, input.aboveGroundGfaSqm ?? null),
    basis: result.basis,
    unavailableReason: result.unavailableReason,
  };
}
