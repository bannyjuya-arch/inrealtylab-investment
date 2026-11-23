/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

// STEP 2 자동 조회값
// 2026-09-03 확정 구조에 따라 기존 Part 1의 REGULATION · USE · CAPACITY를
// STEP 2로 옮긴 컴포넌트. 탭으로 나누지 않고, 필지가 정해주는 값을 한 번에 조회해
// 위에서 아래로 보여준다(시안: 왼쪽 "자동 · 필지가 정해줍니다" 열).
//
// STEP 1(SiteAnalyzer)이 sessionStorage["inrealtylab.step1"]에 남긴
// { pnus, siteAreaSqm, center }를 읽어 동작한다.

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { ZONE_OVERRIDE_OPTIONS, findNationalZoneLimit } from "@/lib/zone-limits";

const STEP1_KEY = "inrealtylab.step1";

type RegulationHit = {
  layer: string;
  category: string;
  label: string;
  name: string;
  designationYear?: string | null;
  designationNumber?: string | null;
};

type RegulationData = {
  primaryZone: string | null;
  useZones: RegulationHit[];
  districts: RegulationHit[];
  areas: RegulationHit[];
  districtPlans: RegulationHit[];
  developmentRestrictions: RegulationHit[];
  landTransactionPermit: RegulationHit[];
  statutoryLimit: null | {
    zoneName: string;
    bcrMax: number;
    farMin: number;
    farMax: number;
    legalBasis: string;
    effectiveDate: string;
    scope: string;
  };
  warnings: string[];
  layerErrors: Array<{ layer: string; label: string; message: string }>;
};

type AllowedUseDecision = "ALLOWED" | "CONDITIONAL" | "PROHIBITED" | "REVIEW";

type AllowedUseFacility = {
  key: string;
  label: string;
  group: string;
  decision: AllowedUseDecision;
  reason: string;
  confidence: number;
  activityCode: string | null;
  activityName: string | null;
  maxGfaSqm?: number | null;
  // 2026-11-23: 표 표시용 구조화 값 (/api/allowed-use)
  conditionText?: string;
  basis?: string;
};

type AllowedUseData = {
  facilities: AllowedUseFacility[];
  caveats?: string[];
  zone?: { ucode: string; name: string; listType: "POSITIVE" | "NEGATIVE" };
  diagnostics: {
    activityCatalogCount: number;
    matchedFacilityCount: number;
    nationalRuleCount?: number;
    localRuleCount?: number;
    hasLocalLayer?: boolean;
  };
  source: { code: string; name: string; endpoints: string[]; baseDate: string; queriedAt: string; note: string };
  /** 이 결과가 어느 용도지역으로 조회한 것인지. 시나리오 전환 중 이전 결과와 섞이지 않게 한다. */
  forZone?: string;
};

type OrdinanceLimit = {
  bcrMaxPct: number | null;
  farMaxPct: number | null;
  farMaxPctSpecial: number | null;
  specialScope: string | null;
  legalBasis: string;
  note: string | null;
  baseDate: string | null;
};

export type Step1Snapshot = {
  pnus: string[];
  siteAreaSqm: number;
  center: { lon: number; lat: number } | null;
};

function formatPct(value: number) {
  return `${value.toLocaleString("ko-KR", { maximumFractionDigits: 1 })}%`;
}

function formatArea(value: number) {
  return `${Math.round(value).toLocaleString("ko-KR")}㎡`;
}

function decisionLabel(decision: AllowedUseDecision) {
  if (decision === "ALLOWED") return "가능";
  if (decision === "CONDITIONAL") return "조건부";
  if (decision === "PROHIBITED") return "불가";
  return "추가확인";
}

function readSnapshot(): Step1Snapshot | null {
  try {
    const raw = sessionStorage.getItem(STEP1_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Step1Snapshot>;
    if (!Array.isArray(parsed.pnus) || !parsed.pnus.length) return null;
    return {
      pnus: parsed.pnus,
      siteAreaSqm: Number(parsed.siteAreaSqm) || 0,
      center: parsed.center ?? null,
    };
  } catch {
    return null;
  }
}

export default function SiteProgram() {
  const [snapshot, setSnapshot] = useState<Step1Snapshot | null>(null);
  const [regulation, setRegulation] = useState<RegulationData | null>(null);
  const [regulationError, setRegulationError] = useState("");
  const [allowedUse, setAllowedUse] = useState<AllowedUseData | null>(null);
  const [ordinanceLimit, setOrdinanceLimit] = useState<OrdinanceLimit | null>(null);
  const [allowedUseError, setAllowedUseError] = useState("");
  const [loading, setLoading] = useState(true);
  // STEP2는 원래 "고를 수 있는 값이 아니라 조회된 값"만 보여준다. 다만 종상향 등
  // 전제로 사업성을 검토하고 싶을 때를 위해, 조회된 용도지역과 별개로 딱 이 값만
  // 가정해서 아래 규모·허용용도·STEP3 사업성까지 재계산하는 시나리오 입력을 둔다
  // (2026-09-07). null이면 조회값을 그대로 쓴다.
  const [zoneOverride, setZoneOverride] = useState<string | null>(null);

  useEffect(() => {
    setSnapshot(readSnapshot());
  }, []);

  // ── 실제 조회값: VWorld 공간중첩으로 이 필지의 진짜 용도지역을 가져온다. ──
  // 시나리오 가정과 무관하게 항상 "사실"만 담는다.
  useEffect(() => {
    if (!snapshot || !snapshot.center) {
      if (snapshot) setLoading(false);
      return;
    }

    let cancelled = false;
    const { center, pnus, siteAreaSqm } = snapshot;

    (async () => {
      setLoading(true);
      try {
        const response = await fetch(
          `/api/regulation?lon=${encodeURIComponent(center.lon)}&lat=${encodeURIComponent(center.lat)}&pnu=${encodeURIComponent(pnus[0])}`
        );
        const data = await response.json();
        if (!response.ok || !data.ok) throw new Error(data?.message ?? "규제정보 조회 실패");
        const loadedRegulation = data.regulation as RegulationData;
        if (!cancelled) setRegulation(loadedRegulation);
        // STEP 3 보고서가 읽는 스냅샷에 용도지역·법정상한을 채워 넣는다.
        // 예전에는 Part 1의 CAPACITY 탭에서 긁어 담던 값이다(2026-09-03).
        try {
          const previous = sessionStorage.getItem("inrealtylab.part1Snapshot");
          sessionStorage.setItem(
            "inrealtylab.part1Snapshot",
            JSON.stringify({
              ...(previous ? JSON.parse(previous) : {}),
              pnus,
              siteAreaSqm,
              primaryZone: loadedRegulation.primaryZone,
              statutoryBcrMaxPct: loadedRegulation.statutoryLimit?.bcrMax ?? null,
              statutoryFarMaxPct: loadedRegulation.statutoryLimit?.farMax ?? null,
              zoneIsOverride: false,
              actualPrimaryZone: loadedRegulation.primaryZone,
            })
          );
        } catch {
          // 스토리지를 못 쓰면 STEP 3에서 값을 직접 입력하게 된다.
        }
      } catch (error) {
        if (!cancelled) setRegulationError(error instanceof Error ? error.message : "규제정보 조회 실패");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [snapshot]);

  const totalArea = snapshot?.siteAreaSqm ?? 0;

  // ── 유효 용도지역: 시나리오 가정이 있으면 그 값, 없으면 실제 조회값. ──
  // 이 값이 바뀌면 허용용도·개발가능규모·STEP3 사업성이 전부 다시 계산된다.
  const effectiveZoneName = zoneOverride ?? regulation?.primaryZone ?? regulation?.useZones[0]?.name ?? null;

  // 유효 용도지역의 국가 법정상한. 조회값 그대로면 VWorld 공간중첩 결과를,
  // 가정 시나리오면 zone-limits 참조표를 쓴다. 두 경로 모두 legalBasis를 채워
  // effectiveLimit 계산이 출처를 구분 없이 참조할 수 있게 한다.
  const nationalLimitForEffectiveZone = useMemo(() => {
    if (zoneOverride) {
      const found = findNationalZoneLimit(zoneOverride);
      if (!found) return null;
      return {
        bcrMax: found.bcrMax,
        farMax: found.farMax,
        legalBasis: "국토의 계획 및 이용에 관한 법률 시행령 제84조·제85조 (용도지역 가정 시나리오)",
      };
    }
    return regulation?.statutoryLimit
      ? {
          bcrMax: regulation.statutoryLimit.bcrMax,
          farMax: regulation.statutoryLimit.farMax,
          legalBasis: regulation.statutoryLimit.legalBasis,
        }
      : null;
  }, [zoneOverride, regulation]);

  // ── 허용용도 + 조례 상한: 유효 용도지역이 바뀔 때마다 다시 조회한다. ──
  useEffect(() => {
    if (!snapshot || !effectiveZoneName) return;
    const { pnus, siteAreaSqm } = snapshot;
    let cancelled = false;

    // 용도지역이 바뀌는 순간 이전 지역의 조례 상한·허용용도를 먼저 비운다.
    // 안 비우면 새 조회가 실패했을 때 이전 지역 값이 남아 엉뚱한 조합으로 섞인다.
    setOrdinanceLimit(null);
    setAllowedUse(null);
    setAllowedUseError("");

    (async () => {
      try {
        const legalGfa = nationalLimitForEffectiveZone
          ? siteAreaSqm * (nationalLimitForEffectiveZone.farMax / 100)
          : null;
        const gfaParam = legalGfa && legalGfa > 0 ? `&aboveGroundGfaSqm=${encodeURIComponent(legalGfa)}` : "";
        const response = await fetch(
          `/api/allowed-use?pnu=${encodeURIComponent(pnus[0])}&zoneName=${encodeURIComponent(effectiveZoneName)}&scenarioCode=BASE&siteAreaSqm=${encodeURIComponent(siteAreaSqm)}${gfaParam}`
        );
        const data = await response.json();
        if (!response.ok || !data.ok) throw new Error(data?.message ?? "건축 가능 용도 조회 실패");
        if (!cancelled) {
          setAllowedUseError("");
          setAllowedUse({
            facilities: data.facilities ?? [],
            caveats: data.caveats ?? [],
            zone: data.zone,
            diagnostics: data.diagnostics,
            source: data.source,
            forZone: effectiveZoneName,
          });
          setOrdinanceLimit((data.ordinanceLimit as OrdinanceLimit | null) ?? null);
        }
        // 2026-11-23: 하위 단계(STEP 2-3, 2-4)에 알리는 일은 아래 "스냅샷 저장 + 알림" effect로 옮겼다.
        // 여기서 바로 알리면 새 용도지역의 용적률이 스냅샷에 저장되기 전이라 이전 값이 전달됐다.
      } catch (error) {
        if (!cancelled) setAllowedUseError(error instanceof Error ? error.message : "건축 가능 용도 조회 실패");
      }
    })();

    return () => {
      cancelled = true;
    };
    // nationalLimitForEffectiveZone은 zoneOverride/regulation에서 파생되는 객체라
    // effectiveZoneName과 항상 같이 바뀐다 — 별도 의존성으로 넣으면 매 렌더 재조회된다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot, effectiveZoneName]);

  // 국가 시행령 상한과 지자체 조례 상한 중 더 엄격한 값이 실제 상한이다.
  // 조례를 안 보면 제2종일반주거를 250%로 잡아 연면적이 25% 과대 계산된다.
  const effectiveLimit = useMemo(() => {
    const national = nationalLimitForEffectiveZone;
    if (!national) return null;
    const bcrCandidates = [national.bcrMax, ordinanceLimit?.bcrMaxPct].filter(
      (value): value is number => typeof value === "number" && value > 0
    );
    const farCandidates = [national.farMax, ordinanceLimit?.farMaxPct].filter(
      (value): value is number => typeof value === "number" && value > 0
    );
    const bcrMax = Math.min(...bcrCandidates);
    const farMax = Math.min(...farCandidates);
    const bindsBcr = ordinanceLimit?.bcrMaxPct != null && ordinanceLimit.bcrMaxPct < national.bcrMax;
    const bindsFar = ordinanceLimit?.farMaxPct != null && ordinanceLimit.farMaxPct < national.farMax;
    return {
      bcrMax,
      farMax,
      bindsBcr,
      bindsFar,
      legalBasis: bindsBcr || bindsFar ? ordinanceLimit!.legalBasis : national.legalBasis,
      nationalBcr: national.bcrMax,
      nationalFar: national.farMax,
    };
  }, [nationalLimitForEffectiveZone, ordinanceLimit]);

  // 스냅샷 저장 + 하위 단계 알림 (2026-11-23 수정)
  // 순서가 중요하다: 현재 용도지역의 허용용도와 조례 상한이 모두 도착한 뒤에만
  //   ① STEP 3와 하위 단계가 읽는 스냅샷(용도지역, 건폐율, 용적률)을 저장하고
  //   ② 그 다음에 inrealtylab:allowedUse 이벤트를 보낸다.
  // 예전에는 조회 직후 이벤트를 먼저 보내고 스냅샷은 다음 렌더에서 저장해서, 용도지역을 바꿔도
  // 시설 구성(ProgramChoice)과 수요 산출(FacilityProgramPanel)이 이전 용적률을 읽었다.
  // 전환 중의 중간 상태(새 용도지역 + 이전 조례 상한)도 저장하지 않는다.
  const lastNotifiedKey = useRef("");
  useEffect(() => {
    if (!effectiveLimit || !snapshot || !effectiveZoneName) return;
    const loadedForZone = allowedUse?.forZone === effectiveZoneName;
    if (!loadedForZone && !allowedUseError) return;
    try {
      const previous = sessionStorage.getItem("inrealtylab.part1Snapshot");
      sessionStorage.setItem(
        "inrealtylab.part1Snapshot",
        JSON.stringify({
          ...(previous ? JSON.parse(previous) : {}),
          primaryZone: effectiveZoneName,
          statutoryBcrMaxPct: effectiveLimit.bcrMax,
          statutoryFarMaxPct: effectiveLimit.farMax,
          limitLegalBasis: effectiveLimit.legalBasis,
          zoneIsOverride: !!zoneOverride,
          actualPrimaryZone: regulation?.primaryZone ?? null,
        })
      );
    } catch {
      // 스토리지를 못 쓰면 STEP 3에서 값을 직접 입력하게 된다.
    }
    if (!loadedForZone || !allowedUse) return;

    const aboveGroundGfaSqm = snapshot.siteAreaSqm * (effectiveLimit.farMax / 100);
    const notifyKey = `${effectiveZoneName}|${effectiveLimit.farMax}|${Math.round(aboveGroundGfaSqm)}`;
    if (notifyKey === lastNotifiedKey.current) return;
    lastNotifiedKey.current = notifyKey;

    // 프로그램 구성(ProgramChoice)이 고를 수 있는 시설과 면적 상한을 걸러낼 때 쓴다.
    const allowedKeys = allowedUse.facilities
      .filter((facility) => facility.decision !== "PROHIBITED")
      .map((facility) => facility.key);
    // 조례가 정한 용도별 바닥면적 상한. 이게 없으면 제2종일반주거에
    // 오피스 3,700㎡ 같은 애초에 불가능한 규모를 제안하게 된다.
    const useLimits: Record<string, { decision: AllowedUseDecision; maxGfaSqm: number | null }> = {};
    for (const facility of allowedUse.facilities) {
      useLimits[facility.key] = { decision: facility.decision, maxGfaSqm: facility.maxGfaSqm ?? null };
    }
    try {
      sessionStorage.setItem("inrealtylab.step2AllowedUse", JSON.stringify(allowedKeys));
      sessionStorage.setItem("inrealtylab.step2UseLimits", JSON.stringify(useLimits));
    } catch {
      // 스토리지를 못 쓰면 프로그램 구성에서 안내가 뜬다.
    }
    window.dispatchEvent(
      new CustomEvent("inrealtylab:allowedUse", {
        detail: { keys: allowedKeys, limits: useLimits, zoneName: effectiveZoneName, aboveGroundGfaSqm },
      })
    );
  }, [effectiveLimit, snapshot, effectiveZoneName, zoneOverride, regulation, allowedUse, allowedUseError]);

  const statutoryCapacity = useMemo(() => {
    if (!effectiveLimit || totalArea <= 0) return null;
    return {
      footprint: totalArea * (effectiveLimit.bcrMax / 100),
      grossFloorArea: totalArea * (effectiveLimit.farMax / 100),
    };
  }, [effectiveLimit, totalArea]);

  const capacityScenarios = useMemo(() => {
    const limit = effectiveLimit;
    if (!limit || totalArea <= 0) return [];
    return [
      { name: "보수 검토", bcr: limit.bcrMax * 0.8, far: limit.farMax * 0.8, note: "법정상한의 80% 사업검토 가정", status: "ASSUMPTION" },
      { name: "기준 검토", bcr: limit.bcrMax * 0.9, far: limit.farMax * 0.9, note: "법정상한의 90% 사업검토 가정", status: "ASSUMPTION" },
      { name: "법정 최대", bcr: limit.bcrMax, far: limit.farMax, note: limit.legalBasis, status: "STATUTORY" },
    ].map((item) => {
      const footprint = totalArea * (item.bcr / 100);
      const grossFloorArea = totalArea * (item.far / 100);
      return {
        ...item,
        footprint,
        grossFloorArea,
        equivalentFloors: footprint > 0 ? grossFloorArea / footprint : 0,
        grossFloorAreaPyeong: grossFloorArea / 3.305785,
      };
    });
  }, [effectiveLimit, totalArea]);


  // ── 화면 표시용 정리 (2026-11-23 개편) ──
  // 같은 이름이 여러 번 잡히는 VWorld 중첩 결과(도시지역 3회, 토지거래허가구역 2회 등)를 이름 기준으로 한 번만 보여준다.
  const uniqueNames = (items: RegulationHit[]) => Array.from(new Set(items.map((item) => item.name)));

  const decisionOrder: AllowedUseDecision[] = ["ALLOWED", "CONDITIONAL", "REVIEW", "PROHIBITED"];
  const decisionGroupTitle: Record<AllowedUseDecision, string> = {
    ALLOWED: "가능 (조례 없이 건축)",
    CONDITIONAL: "조건부 (조례 열거 범위, 면적 및 접도 조건 안에서만)",
    REVIEW: "추가확인 (지자체 조례 확인 필요)",
    PROHIBITED: "불가",
  };
  const facilitiesByDecision = (decision: AllowedUseDecision) =>
    (allowedUse?.facilities ?? []).filter((facility) => facility.decision === decision);
  const decisionCounts = decisionOrder
    .map((decision) => ({ decision, count: facilitiesByDecision(decision).length }))
    .filter((item) => item.count > 0);

  const pyeong = (sqm: number) => `${Math.round(sqm / 3.305785).toLocaleString("ko-KR")}평`;
  const equivalentFloors = capacityScenarios[0]?.equivalentFloors ?? 0;

  if (!snapshot) {
    return (
      <section className="control-section">
        <div className="control-section-title"><span>STEP 2-1 필지 조회값</span><strong>법규 조건 및 개발 규모</strong></div>
        <div className="regime-note">
          현황분석에서 필지 선택 시 용도지역, 건폐율, 용적률 및 건축 가능 용도 자동 조회
        </div>
      </section>
    );
  }

  if (!snapshot.center) {
    return (
      <section className="control-section">
        <div className="control-section-title"><span>STEP 2-1 필지 조회값</span><strong>법규 조건 및 개발 규모</strong></div>
        <div className="control-warning">
          선택 필지 위치정보 없음. 현황분석 화면에서 필지 재선택 필요
        </div>
      </section>
    );
  }

  const regulationChips = regulation
    ? [
        { title: "용도지구", names: uniqueNames(regulation.districts), warn: false },
        { title: "용도구역", names: uniqueNames(regulation.areas), warn: true },
        { title: "지구단위계획", names: uniqueNames(regulation.districtPlans), warn: true },
        { title: "개발행위 제한", names: uniqueNames(regulation.developmentRestrictions), warn: true },
        { title: "토지거래허가구역", names: uniqueNames(regulation.landTransactionPermit), warn: true },
      ]
    : [];

  return (
    <section className="control-section s2">
      <div className="s2-head">
        <div className="control-section-title" style={{ marginBottom: 0 }}>
          <span>STEP 2-1 필지 조회값</span>
          <strong>법규 조건 및 개발 규모</strong>
        </div>
        <div className={`s2-zone${zoneOverride ? " active" : ""}`}>
          <label htmlFor="zone-override-select">용도지역 시나리오 (종상향 검토 시 변경)</label>
          <div className="s2-zone-row">
            <select
              id="zone-override-select"
              value={zoneOverride ?? ""}
              onChange={(event) => setZoneOverride(event.target.value || null)}
            >
              <option value="">실제 조회값 사용{regulation?.primaryZone ? ` (${regulation.primaryZone})` : ""}</option>
              {ZONE_OVERRIDE_OPTIONS.map((zoneName) => (
                <option key={zoneName} value={zoneName}>{zoneName}</option>
              ))}
            </select>
            {zoneOverride && (
              <button type="button" onClick={() => setZoneOverride(null)}>되돌리기</button>
            )}
          </div>
        </div>
      </div>

      {zoneOverride && (
        <div className="s2-override-note">
          <strong>시나리오 적용 중</strong> 실제 용도지역은 {regulation?.primaryZone ?? "확인 필요"}. 아래 값과 STEP 3 사업성은 전부{" "}
          {zoneOverride} 가정 기준이며 법적으로 확정된 값이 아님
        </div>
      )}

      {loading && <div className="regime-note">공공데이터 조회 중</div>}
      {regulationError && <div className="control-error">{regulationError}</div>}

      {/* ── 핵심 수치 ── */}
      {regulation && (
        <div className="s2-kpis">
          <div>
            <span>대지면적</span>
            <strong>{formatArea(totalArea)}</strong>
            <small>{pyeong(totalArea)}</small>
          </div>
          <div>
            <span>용도지역{zoneOverride ? " (가정)" : ""}</span>
            <strong className="s2-kpi-text">{effectiveZoneName ?? "확인 필요"}</strong>
            <small>{zoneOverride ? `실제 ${regulation.primaryZone ?? "확인 필요"}` : "VWorld 공간중첩"}</small>
          </div>
          <div>
            <span>건폐율 상한</span>
            <strong>{effectiveLimit ? formatPct(effectiveLimit.bcrMax) : "-"}</strong>
            <small>
              {effectiveLimit?.bindsBcr ? `조례 적용 (시행령 ${formatPct(effectiveLimit.nationalBcr)})` : ordinanceLimit ? "시행령, 조례 동일" : "시행령 기준"}
            </small>
          </div>
          <div>
            <span>용적률 상한</span>
            <strong>{effectiveLimit ? formatPct(effectiveLimit.farMax) : "-"}</strong>
            <small>
              {effectiveLimit?.bindsFar ? `조례 적용 (시행령 ${formatPct(effectiveLimit.nationalFar)})` : ordinanceLimit ? "시행령, 조례 동일" : "시행령 기준"}
            </small>
          </div>
          <div className="s2-kpi-key">
            <span>법정 최대 연면적</span>
            <strong>{statutoryCapacity ? formatArea(statutoryCapacity.grossFloorArea) : "-"}</strong>
            <small>
              {statutoryCapacity ? `${pyeong(statutoryCapacity.grossFloorArea)}, 건축면적 ${formatArea(statutoryCapacity.footprint)}` : "상한 확인 후 계산"}
            </small>
          </div>
        </div>
      )}

      {/* ── 규제 중첩 ── */}
      {regulation && (
        <div className="s2-block">
          <div className="s2-block-head">
            <strong>규제 중첩 현황</strong>
            <span>{effectiveLimit ? `${effectiveLimit.legalBasis.replace(/\s*[·ㆍ]\s*/g, ", ")}, 시행기준 ${regulation.statutoryLimit?.effectiveDate ?? "-"}` : ""}</span>
          </div>
          <div className="s2-chips">
            {regulationChips.map((chip) =>
              chip.names.length ? (
                <span key={chip.title} className={`s2-chip${chip.warn ? " warn" : " on"}`}>
                  {chip.title === "토지거래허가구역" ? "토지거래허가구역 해당" : `${chip.title}: ${chip.names.join(", ")}`}
                </span>
              ) : (
                <span key={chip.title} className="s2-chip"><i aria-hidden="true" />{chip.title} 없음</span>
              )
            )}
          </div>
          {regulation.warnings.map((warning) => <div className="control-warning" key={warning}>{warning}</div>)}
        </div>
      )}

      {/* ── 지을 수 있는 용도 ── */}
      <div className="s2-block">
        <div className="s2-block-head">
          <strong>건축 가능 용도</strong>
          {allowedUse && (
            <span>
              {allowedUse.facilities.length}개 용도 중 {allowedUse.diagnostics.matchedFacilityCount}개 건축 가능, 기준일 {allowedUse.source.baseDate}
            </span>
          )}
        </div>
        {allowedUseError && <div className="control-error">{allowedUseError}</div>}
        {allowedUse && (
          <>
            <div className="s2-counts">
              {decisionCounts.map((item) => (
                <span key={item.decision} className={`s2-badge ${item.decision.toLowerCase()}`}>
                  {decisionLabel(item.decision)} {item.count}
                </span>
              ))}
            </div>
            <div className="s2-table-wrap">
              <table className="s2-table">
                <thead>
                  <tr>
                    <th style={{ width: 78 }}>판정</th>
                    <th>용도</th>
                    <th>바닥면적 상한</th>
                    <th>조건</th>
                    <th>근거</th>
                  </tr>
                </thead>
                <tbody>
                  {decisionOrder.map((decision) => {
                    const rows = facilitiesByDecision(decision);
                    if (!rows.length) return null;
                    return (
                      <Fragment key={decision}>
                        <tr className="s2-group-row"><td colSpan={5}>{decisionGroupTitle[decision]}</td></tr>
                        {rows.map((facility) => (
                          <tr key={facility.key}>
                            <td><span className={`s2-badge ${decision.toLowerCase()}`}>{decisionLabel(decision)}</span></td>
                            <td className="s2-use">{facility.label}</td>
                            <td className="s2-num">{facility.maxGfaSqm ? `${facility.maxGfaSqm.toLocaleString("ko-KR")}㎡ 미만` : "-"}</td>
                            <td>{facility.conditionText || "-"}</td>
                            <td className="s2-ref">{facility.basis || "-"}</td>
                          </tr>
                        ))}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <ul className="s2-foot">
              {statutoryCapacity && (
                <li>
                  바닥면적 상한은 해당 용도 합계 기준. 상한이 있는 용도는 단독으로 법정 최대 연면적({formatArea(statutoryCapacity.grossFloorArea)})을 채울 수 없음
                </li>
              )}
              <li>{allowedUse.source.name}. {allowedUse.source.note}</li>
            </ul>

            {allowedUse.caveats?.length ? (
              <details className="s2-details">
                <summary>층수 단서 {allowedUse.caveats.length}건 보기</summary>
                <ul>
                  {allowedUse.caveats.map((caveat) => (
                    <li key={caveat}>{caveat.replace(/\s*[·ㆍ]\s*/g, ", ")}</li>
                  ))}
                </ul>
              </details>
            ) : null}

            {regulation?.districtPlans.length ? (
              <div className="control-warning">
                지구단위계획구역 중첩. 결정도서의 허용용도와 불허용도를 반드시 추가 확인해야 함
              </div>
            ) : null}
            {snapshot.pnus.length > 1 && (
              <div className="control-warning">용도 판정은 대표 필지 1개 기준. 필지별 용도지역이 다르면 필지별 판정 필요</div>
            )}
          </>
        )}
      </div>

      {/* ── 개발가능 규모 + 반영 상태 ── */}
      {regulation && effectiveLimit && statutoryCapacity ? (
        <div className="s2-split">
          <div className="s2-block s2-capacity">
            <div className="s2-block-head">
              <strong>개발 가능 규모</strong>
              <span>보수, 기준안은 사업검토 가정이며 법적 기준 아님</span>
            </div>
            <div className="s2-table-wrap">
              <table className="s2-table s2-scenario">
                <thead>
                  <tr>
                    <th>구분</th>
                    {capacityScenarios.map((scenario) => (
                      <th key={scenario.name} className={scenario.status === "STATUTORY" ? "key" : undefined}>
                        {scenario.status === "STATUTORY" ? "법정 최대" : scenario.name === "보수 검토" ? "보수 (법정 80%)" : "기준 (법정 90%)"}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr><td>건폐율</td>{capacityScenarios.map((s) => <td key={s.name} className={s.status === "STATUTORY" ? "key" : undefined}>{formatPct(s.bcr)}</td>)}</tr>
                  <tr><td>용적률</td>{capacityScenarios.map((s) => <td key={s.name} className={s.status === "STATUTORY" ? "key" : undefined}>{formatPct(s.far)}</td>)}</tr>
                  <tr><td>건축면적</td>{capacityScenarios.map((s) => <td key={s.name} className={s.status === "STATUTORY" ? "key" : undefined}>{formatArea(s.footprint)}</td>)}</tr>
                  <tr><td>연면적</td>{capacityScenarios.map((s) => <td key={s.name} className={s.status === "STATUTORY" ? "key" : undefined}>{formatArea(s.grossFloorArea)}</td>)}</tr>
                  <tr><td>연면적 (평)</td>{capacityScenarios.map((s) => <td key={s.name} className={s.status === "STATUTORY" ? "key" : undefined}>{pyeong(s.grossFloorArea)}</td>)}</tr>
                </tbody>
              </table>
            </div>
            <ul className="s2-foot">
              <li>
                단순 환산층수 {equivalentFloors.toLocaleString("ko-KR", { maximumFractionDigits: 1 })}층 (연면적 / 건축면적, 세 안 동일). 실제 층수는
                높이, 일조, 도로, 주차, 코어 및 산입 제외면적, 개별법 검토 후 확정
              </li>
            </ul>
          </div>

          <div className="s2-block s2-status">
            <div className="s2-block-head"><strong>규제 반영 현황</strong></div>
            <CapacityStatus label="대지면적" status="반영" tone="ok" detail="VWorld 지적 필지" />
            <CapacityStatus
              label="용도지역"
              status={zoneOverride ? "가정 적용" : "반영"}
              tone={zoneOverride ? "warn" : "ok"}
              detail={zoneOverride ? `${effectiveZoneName} 가정 (실제 ${regulation.primaryZone ?? "확인 필요"})` : regulation.primaryZone ?? "세부지역 확인 필요"}
            />
            <CapacityStatus
              label="건축 가능시설"
              status={allowedUse ? "판정" : "미조회"}
              tone={allowedUse ? "ok" : "pending"}
              detail={allowedUse ? "시행령 별표, 조례 별표" : "판정 실패"}
            />
            <CapacityStatus
              label="건폐율, 용적률"
              status={ordinanceLimit ? "조례까지 반영" : "시행령만 반영"}
              tone={ordinanceLimit ? "ok" : "pending"}
              detail={
                ordinanceLimit
                  ? `${ordinanceLimit.legalBasis.replace(/\s*[·ㆍ]\s*/g, ", ")} (${ordinanceLimit.bcrMaxPct ?? "-"}%, ${ordinanceLimit.farMaxPct ?? "-"}%)`
                  : "지자체 조례 상한 미확보"
              }
            />
            <CapacityStatus
              label="조례 별표"
              status={allowedUse?.diagnostics.hasLocalLayer ? "반영" : "미반영"}
              tone={allowedUse?.diagnostics.hasLocalLayer ? "ok" : "pending"}
              detail={
                allowedUse?.diagnostics.hasLocalLayer
                  ? `${allowedUse.diagnostics.localRuleCount ?? 0}개 항목`
                  : "조례 위임 항목은 추가확인"
              }
            />
            <CapacityStatus
              label="지구단위계획"
              status={regulation.districtPlans.length ? "검토 필요" : "중첩 없음"}
              tone={regulation.districtPlans.length ? "warn" : "neutral"}
              detail={regulation.districtPlans.length ? uniqueNames(regulation.districtPlans).join(", ") : "공간중첩 기준"}
            />
            <CapacityStatus label="인센티브, 특례" status="미반영" tone="pending" detail="승인된 규칙만 향후 자동 적용" />
          </div>
        </div>
      ) : !loading && (
        <div className="regime-note">세부 용도지역 및 건폐율, 용적률 확인 후 규모 산정</div>
      )}
    </section>
  );
}

function CapacityStatus({
  label,
  status,
  tone,
  detail,
}: {
  label: string;
  status: string;
  tone: "ok" | "pending" | "warn" | "neutral";
  detail: string;
}) {
  return (
    <div className="s2-status-row">
      <div>
        <strong>{label}</strong>
        <small>{detail}</small>
      </div>
      <span className={`s2-tag ${tone}`}>{status}</span>
    </div>
  );
}
