/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

// STEP 2 · 자동 조회값
// 2026-09-03 확정 구조에 따라 기존 Part 1의 REGULATION · USE · CAPACITY를
// STEP 2로 옮긴 컴포넌트. 탭으로 나누지 않고, 필지가 정해주는 값을 한 번에 조회해
// 위에서 아래로 보여준다(시안: 왼쪽 "자동 · 필지가 정해줍니다" 열).
//
// STEP 1(SiteAnalyzer)이 sessionStorage["inrealtylab.step1"]에 남긴
// { pnus, siteAreaSqm, center }를 읽어 동작한다.

import { useEffect, useMemo, useState } from "react";

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

function decisionTone(decision: AllowedUseDecision): "ok" | "pending" | "warn" | "neutral" {
  if (decision === "ALLOWED") return "ok";
  if (decision === "CONDITIONAL" || decision === "PROHIBITED") return "warn";
  if (decision === "REVIEW") return "pending";
  return "neutral";
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

  useEffect(() => {
    setSnapshot(readSnapshot());
  }, []);

  useEffect(() => {
    if (!snapshot || !snapshot.center) {
      if (snapshot) setLoading(false);
      return;
    }

    let cancelled = false;
    const { center, pnus, siteAreaSqm } = snapshot;

    (async () => {
      setLoading(true);
      let loadedRegulation: RegulationData | null = null;

      try {
        const response = await fetch(
          `/api/regulation?lon=${encodeURIComponent(center.lon)}&lat=${encodeURIComponent(center.lat)}&pnu=${encodeURIComponent(pnus[0])}`
        );
        const data = await response.json();
        if (!response.ok || !data.ok) throw new Error(data?.message ?? "규제정보 조회에 실패했습니다.");
        loadedRegulation = data.regulation as RegulationData;
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
            })
          );
        } catch {
          // 스토리지를 못 쓰면 STEP 3에서 값을 직접 입력하게 된다.
        }
      } catch (error) {
        if (!cancelled) setRegulationError(error instanceof Error ? error.message : "규제정보 조회에 실패했습니다.");
      }

      // 허용용도는 용도지역이 확인된 뒤에만 의미가 있다.
      if (loadedRegulation) {
        try {
          const zoneName = loadedRegulation.primaryZone ?? loadedRegulation.useZones[0]?.name ?? "";
          const legalGfa = loadedRegulation.statutoryLimit
            ? siteAreaSqm * (loadedRegulation.statutoryLimit.farMax / 100)
            : null;
          const gfaParam = legalGfa && legalGfa > 0 ? `&aboveGroundGfaSqm=${encodeURIComponent(legalGfa)}` : "";
          const response = await fetch(
            `/api/allowed-use?pnu=${encodeURIComponent(pnus[0])}&zoneName=${encodeURIComponent(zoneName)}&scenarioCode=BASE&siteAreaSqm=${encodeURIComponent(siteAreaSqm)}${gfaParam}`
          );
          const data = await response.json();
          if (!response.ok || !data.ok) throw new Error(data?.message ?? "건축 가능시설 조회에 실패했습니다.");
          if (!cancelled) {
            setAllowedUse({
              facilities: data.facilities ?? [],
              caveats: data.caveats ?? [],
              zone: data.zone,
              diagnostics: data.diagnostics,
              source: data.source,
            });
            setOrdinanceLimit((data.ordinanceLimit as OrdinanceLimit | null) ?? null);
          }
          // 프로그램 구성(ProgramChoice)이 고를 수 있는 시설과 면적 상한을 걸러낼 때 쓴다.
          const facilities: AllowedUseFacility[] = data.facilities ?? [];
          const allowedKeys = facilities
            .filter(
              (facility) =>
                facility.decision === "ALLOWED" ||
                facility.decision === "CONDITIONAL" ||
                facility.decision === "REVIEW"
            )
            .map((facility) => facility.key);
          // 조례가 정한 용도별 바닥면적 상한. 이게 없으면 제2종일반주거에
          // 오피스 3,700㎡ 같은 애초에 불가능한 규모를 제안하게 된다.
          const useLimits: Record<string, { decision: AllowedUseDecision; maxGfaSqm: number | null }> = {};
          for (const facility of facilities) {
            useLimits[facility.key] = {
              decision: facility.decision,
              maxGfaSqm: facility.maxGfaSqm ?? null,
            };
          }
          try {
            sessionStorage.setItem("inrealtylab.step2AllowedUse", JSON.stringify(allowedKeys));
            sessionStorage.setItem("inrealtylab.step2UseLimits", JSON.stringify(useLimits));
          } catch {
            // 스토리지를 못 쓰면 프로그램 구성에서 안내가 뜬다.
          }
          // 허용용도 조회는 비동기라 ProgramChoice가 먼저 뜬다. 끝났다고 알려준다.
          window.dispatchEvent(
            new CustomEvent("inrealtylab:allowedUse", { detail: { keys: allowedKeys, limits: useLimits } })
          );
        } catch (error) {
          if (!cancelled) setAllowedUseError(error instanceof Error ? error.message : "건축 가능시설 조회에 실패했습니다.");
        }
      }

      if (!cancelled) setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [snapshot]);

  const totalArea = snapshot?.siteAreaSqm ?? 0;

  // 국가 시행령 상한과 지자체 조례 상한 중 더 엄격한 값이 실제 상한이다.
  // 조례를 안 보면 제2종일반주거를 250%로 잡아 연면적이 25% 과대 계산된다.
  const effectiveLimit = useMemo(() => {
    const national = regulation?.statutoryLimit;
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
  }, [regulation, ordinanceLimit]);

  // 조례 상한이 국가 상한보다 낮으면 STEP 3이 읽는 스냅샷도 그 값으로 덮어쓴다.
  useEffect(() => {
    if (!effectiveLimit || !snapshot) return;
    try {
      const previous = sessionStorage.getItem("inrealtylab.part1Snapshot");
      sessionStorage.setItem(
        "inrealtylab.part1Snapshot",
        JSON.stringify({
          ...(previous ? JSON.parse(previous) : {}),
          statutoryBcrMaxPct: effectiveLimit.bcrMax,
          statutoryFarMaxPct: effectiveLimit.farMax,
          limitLegalBasis: effectiveLimit.legalBasis,
        })
      );
    } catch {
      // 스토리지를 못 쓰면 STEP 3에서 값을 직접 입력하게 된다.
    }
  }, [effectiveLimit, snapshot]);

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

  if (!snapshot) {
    return (
      <section className="control-section">
        <div className="control-section-title"><span>STEP 2 · 자동</span><strong>필지가 정해주는 값</strong></div>
        <div className="regime-note">
          현황분석에서 필지를 선택하면 용도지역·건폐율·용적률과 지을 수 있는 용도를 여기에서 자동으로 조회합니다.
        </div>
      </section>
    );
  }

  if (!snapshot.center) {
    return (
      <section className="control-section">
        <div className="control-section-title"><span>STEP 2 · 자동</span><strong>필지가 정해주는 값</strong></div>
        <div className="control-warning">
          선택 필지의 위치 정보가 없어 규제정보를 조회하지 못했습니다. 현황분석 화면에서 필지를 다시 선택해 주세요.
        </div>
      </section>
    );
  }

  return (
    <section className="control-section">
      <div className="control-section-title">
        <span>STEP 2 · 자동</span>
        <strong>필지가 정해주는 값</strong>
      </div>
      <div className="regime-note">고를 수 있는 값이 아니라 조회된 값입니다. 대지 {formatArea(totalArea)} 기준.</div>

      {loading && <div className="regime-note">공공데이터를 조회하고 있습니다...</div>}

      {/* ── 법적 규제 ── */}
      {regulationError && <div className="control-error">{regulationError}</div>}
      {regulation && (
        <>
          <div className="metric-grid">
            <div><span>주요 용도지역</span><strong>{regulation.primaryZone ?? "확인 필요"}</strong></div>
            <div>
              <span>건폐율 상한</span>
              <strong>{effectiveLimit ? formatPct(effectiveLimit.bcrMax) : "-"}</strong>
            </div>
            <div>
              <span>용적률 상한</span>
              <strong>{effectiveLimit ? formatPct(effectiveLimit.farMax) : "-"}</strong>
            </div>
          </div>

          <div className="regulation-groups">
            <RegulationGroup title="용도지역" items={regulation.useZones} />
            <RegulationGroup title="용도지구" items={regulation.districts} />
            <RegulationGroup title="용도구역" items={regulation.areas} />
            <RegulationGroup title="지구단위계획" items={regulation.districtPlans} />
            <RegulationGroup title="개발행위 제한" items={regulation.developmentRestrictions} />
            <RegulationGroup title="토지거래허가" items={regulation.landTransactionPermit} />
          </div>

          {regulation.statutoryLimit && effectiveLimit && (
            <div className="source-note">
              <strong>{effectiveLimit.legalBasis}</strong>
              <span>시행기준 {regulation.statutoryLimit.effectiveDate}</span>
              <p>{regulation.statutoryLimit.scope}</p>
              {(effectiveLimit.bindsBcr || effectiveLimit.bindsFar) && (
                <p>
                  국가 시행령 상한(건폐율 {formatPct(effectiveLimit.nationalBcr)} · 용적률{" "}
                  {formatPct(effectiveLimit.nationalFar)})보다 조례가 더 엄격해 조례 값을 적용했습니다.
                </p>
              )}
            </div>
          )}
          {regulation.warnings.map((warning) => <div className="control-warning" key={warning}>{warning}</div>)}
        </>
      )}

      {/* ── 지을 수 있는 용도 ── */}
      <div className="control-section-title" style={{ marginTop: 26 }}>
        <span>지을 수 있는 용도</span>
        <strong>지을 수 있는 용도</strong>
      </div>
      {allowedUseError && <div className="control-error">{allowedUseError}</div>}
      {allowedUse && (
        <>
          <div className="metric-grid">
            <div><span>기준 용도지역</span><strong>{regulation?.primaryZone ?? "추가확인"}</strong></div>
            <div><span>건축 가능 용도</span><strong>{allowedUse.diagnostics.matchedFacilityCount}/{allowedUse.facilities.length}</strong></div>
            <div><span>기준일</span><strong>{allowedUse.source.baseDate}</strong></div>
          </div>

          <AllowedUseGroup title="업무시설" facilities={allowedUse.facilities.filter((facility) => facility.group === "OFFICE")} />
          <AllowedUseGroup title="판매·근린생활시설" facilities={allowedUse.facilities.filter((facility) => facility.group === "RETAIL")} />
          <AllowedUseGroup title="기타 수익시설" facilities={allowedUse.facilities.filter((facility) => !["OFFICE", "RETAIL", "PUBLIC"].includes(facility.group))} />
          <AllowedUseGroup title="공공·필수시설" facilities={allowedUse.facilities.filter((facility) => facility.group === "PUBLIC")} />

          {allowedUse.caveats?.length ? (
            <div className="control-warning">
              <strong>항 단서</strong>
              <ul className="unresolved-list" style={{ marginTop: 8 }}>
                {allowedUse.caveats.map((caveat) => (
                  <li key={caveat}>{caveat}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="source-note">
            <strong>{allowedUse.source.name}</strong>
            <span>기준일 {allowedUse.source.baseDate} · 조문 {allowedUse.diagnostics.activityCatalogCount}행</span>
            <p>{allowedUse.source.note}</p>
          </div>

          {regulation?.districtPlans.length ? (
            <div className="control-warning">
              지구단위계획구역이 중첩되어 있습니다. 여기의 행위제한 1차 판정 외에 지구단위계획 결정도서의 허용용도·불허용도를 반드시 추가 확인해야 합니다.
            </div>
          ) : null}
          {snapshot.pnus.length > 1 && (
            <div className="control-warning">현재 용도 판정은 대표 필지 1개 기준입니다. 복수 필지의 용도지역이 다르면 필지별 판정으로 확장해야 합니다.</div>
          )}
        </>
      )}

      {/* ── 개발가능 규모 ── */}
      <div className="control-section-title" style={{ marginTop: 26 }}>
        <span>개발가능 규모</span>
        <strong>개발가능 규모</strong>
      </div>
      {regulation && effectiveLimit && statutoryCapacity ? (
        <>
          <div className="capacity-basis">
            <span>현재 계산 기준</span>
            <strong>{regulation.primaryZone ?? regulation.statutoryLimit?.zoneName ?? "-"}</strong>
            <p>대지 {formatArea(totalArea)} · BCR {formatPct(effectiveLimit.bcrMax)} · FAR {formatPct(effectiveLimit.farMax)}</p>
          </div>

          <div className="metric-grid capacity-metrics">
            <div>
              <span>적용 대지면적</span>
              <strong>{formatArea(totalArea)}</strong>
              <small>{(totalArea / 3.305785).toLocaleString("ko-KR", { maximumFractionDigits: 1 })}평</small>
            </div>
            <div>
              <span>법정 최대 건축면적</span>
              <strong>{formatArea(statutoryCapacity.footprint)}</strong>
              <small>BCR {formatPct(effectiveLimit.bcrMax)}</small>
            </div>
            <div>
              <span>법정 최대 연면적</span>
              <strong>{formatArea(statutoryCapacity.grossFloorArea)}</strong>
              <small>FAR {formatPct(effectiveLimit.farMax)}</small>
            </div>
          </div>

          <div className="capacity-subtitle">
            <strong>규모 시나리오</strong>
            <span>보수/기준안은 사업검토 가정이며 법적 기준이 아닙니다.</span>
          </div>

          <div className="scenario-list">
            {capacityScenarios.map((scenario) => (
              <article className={`scenario-card ${scenario.status === "STATUTORY" ? "statutory" : ""}`} key={scenario.name}>
                <div className="scenario-head">
                  <strong>{scenario.name}</strong>
                  <span>{scenario.note}</span>
                </div>
                <dl>
                  <div><dt>건폐율</dt><dd>{formatPct(scenario.bcr)}</dd></div>
                  <div><dt>용적률</dt><dd>{formatPct(scenario.far)}</dd></div>
                  <div><dt>건축면적</dt><dd>{formatArea(scenario.footprint)}</dd></div>
                  <div><dt>연면적</dt><dd>{formatArea(scenario.grossFloorArea)}</dd></div>
                  <div><dt>연면적(평)</dt><dd>{scenario.grossFloorAreaPyeong.toLocaleString("ko-KR", { maximumFractionDigits: 1 })}평</dd></div>
                  <div><dt>단순 환산층수</dt><dd>{scenario.equivalentFloors.toLocaleString("ko-KR", { maximumFractionDigits: 1 })}층</dd></div>
                </dl>
              </article>
            ))}
          </div>

          <div className="capacity-subtitle">
            <strong>규제 반영 상태</strong>
            <span>어떤 값이 계산에 들어갔는지 추적합니다.</span>
          </div>
          <div className="capacity-status-list">
            <CapacityStatus label="대지면적" status="반영" tone="ok" detail="VWorld 지적 필지" />
            <CapacityStatus label="용도지역" status="반영" tone="ok" detail={regulation.primaryZone ?? "세부지역 확인 필요"} />
            <CapacityStatus label="건축 가능시설" status={allowedUse ? "판정" : "미조회"} tone={allowedUse ? "ok" : "pending"} detail={allowedUse ? allowedUse.source.name : "판정 실패"} />
            <CapacityStatus
              label="국가 건폐율·용적률"
              status="반영"
              tone="ok"
              detail={regulation.statutoryLimit?.legalBasis ?? "국토계획법 시행령"}
            />
            <CapacityStatus
              label="조례 건폐율·용적률"
              status={ordinanceLimit ? "반영" : "미반영"}
              tone={ordinanceLimit ? "ok" : "pending"}
              detail={
                ordinanceLimit
                  ? `${ordinanceLimit.legalBasis} · 건폐율 ${ordinanceLimit.bcrMaxPct ?? "-"}% · 용적률 ${ordinanceLimit.farMaxPct ?? "-"}%`
                  : "해당 지자체 조례 상한 미확보 — 국가 상한으로 계산"
              }
            />
            <CapacityStatus
              label="지자체 조례"
              status={allowedUse?.diagnostics.hasLocalLayer ? "반영" : "미반영"}
              tone={allowedUse?.diagnostics.hasLocalLayer ? "ok" : "pending"}
              detail={
                allowedUse?.diagnostics.hasLocalLayer
                  ? `조례 별표 ${allowedUse.diagnostics.localRuleCount ?? 0}개 항목 반영`
                  : "해당 지자체 조례 별표 미확보 — 조례 위임 항목은 추가확인"
              }
            />
            <CapacityStatus
              label="지구단위계획 세부지침"
              status={regulation.districtPlans.length ? "검토 필요" : "중첩 없음"}
              tone={regulation.districtPlans.length ? "warn" : "neutral"}
              detail={regulation.districtPlans.length ? regulation.districtPlans.map((item) => item.name).join(", ") : "공간중첩 기준"}
            />
            <CapacityStatus label="인센티브 / 특례" status="미반영" tone="pending" detail="승인된 Regulation Rule만 향후 자동 적용" />
          </div>

          <div className="control-warning">
            단순 환산층수는 연면적 ÷ 건축면적의 기초 지표입니다. 실제 층수는 높이, 일조, 도로, 주차, 코어·공용부, 용적률 산입 제외면적, 지구단위계획 및 개별법 검토 후 달라집니다.
          </div>
        </>
      ) : !loading && (
        <div className="regime-note">세부 용도지역과 건폐율·용적률 기준이 확인되어야 규모를 계산할 수 있습니다.</div>
      )}
    </section>
  );
}

function RegulationGroup({ title, items }: { title: string; items: RegulationHit[] }) {
  return (
    <section className="regulation-group">
      <div className="regulation-group-head"><strong>{title}</strong><span>{items.length}건</span></div>
      {items.length ? (
        <ul>{items.map((item, index) => <li key={`${item.layer}-${item.name}-${index}`}><span>{item.name}</span><small>{item.label}</small></li>)}</ul>
      ) : (
        <p>중첩 없음</p>
      )}
    </section>
  );
}

function AllowedUseGroup({ title, facilities }: { title: string; facilities: AllowedUseFacility[] }) {
  return (
    <section className="regulation-group">
      <div className="regulation-group-head"><strong>{title}</strong><span>{facilities.length}개</span></div>
      {facilities.length ? (
        <div className="capacity-status-list">
          {facilities.map((facility) => (
            <CapacityStatus
              key={facility.key}
              label={facility.label}
              status={decisionLabel(facility.decision)}
              tone={decisionTone(facility.decision)}
              detail={[
                facility.maxGfaSqm ? `상한 ${facility.maxGfaSqm.toLocaleString("ko-KR")}㎡` : null,
                facility.reason,
              ]
                .filter(Boolean)
                .join(" · ")}
            />
          ))}
        </div>
      ) : (
        <p>대상 시설 없음</p>
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
    <div className="capacity-status-row">
      <div>
        <strong>{label}</strong>
        <small>{detail}</small>
      </div>
      <span className={`status-chip ${tone}`}>{status}</span>
    </div>
  );
}
