"use client";

// STEP 2 · 프로그램 구성
// 2026-09-03 확정: 사용자가 백지에서 고르는 게 아니라 1차 구성을 제안하고 사용자가 수정한다.
// 손대지 않은 줄은 제안값 그대로 남고, 한 줄을 바꾸면 나머지가 자동 조정돼 합계 100%를 유지한다.
//
// 시설 분류는 Supabase facility_master(C01~C10 / P-NR / P-R)를,
// 허용용도 → 프로그램 코드 매핑은 part1_part3_facility_map을 그대로 따른다.
// SiteProgram이 sessionStorage["inrealtylab.step2AllowedUse"]에 남긴
// 허용 facility_key 목록으로 고를 수 있는 시설을 걸러낸다.

import { useEffect, useMemo, useState } from "react";

const ALLOWED_KEY = "inrealtylab.step2AllowedUse";
const LIMITS_KEY = "inrealtylab.step2UseLimits";
const SNAPSHOT_KEY = "inrealtylab.part1Snapshot";
const STORAGE_KEY = "inrealtylab.step2Program";

// 2026-09-05 정리: 코드를 facility_master.facility_code 한 벌로 통일했다.
// 예전에는 여기만 category_code("C01")를 쓰고 임대료·수익정책은 facility_code("C01_OFFICE")를
// 써서, STEP 2에서 고른 구성이 STEP 3 계산에 연결되지 않았다.
type CommercialCode =
  | "C01_OFFICE" | "C02_RETAIL" | "C03_HOSPITALITY" | "C04_LIVING" | "C05_HEALTHCARE"
  | "C06_EDUCATION" | "C07_CULTURE_ENTERTAINMENT" | "C08_RND_LAB" | "C09_LOGISTICS" | "C10_DIGITAL_INFRA";

type PublicCode = "P_R_PARKING" | "P_R_SENIOR_DAYCARE" | "P_R_PUBLIC_RENTAL_HOUSING" | "P_NR_GENERIC" | "P_NR_LIBRARY" | "P_NR_SENIOR_WELFARE_CENTER" | "P_NR_SOCIAL_WELFARE_CENTER" | "P_NR_PARK";

type CommercialFacility = {
  code: CommercialCode;
  label: string;
  businessModel: string;
  // part1_part3_facility_map 기준. 이 중 하나라도 허용되면 선택 가능.
  allowedFrom: string[];
  priority: number;
};

const COMMERCIAL: CommercialFacility[] = [
  { code: "C01_OFFICE", label: "오피스", businessModel: "임대", allowedFrom: ["OFFICE_GENERAL"], priority: 10 },
  { code: "C02_RETAIL", label: "리테일", businessModel: "임대 · 분양", allowedFrom: ["RETAIL", "NEIGHBORHOOD_1", "NEIGHBORHOOD_2"], priority: 20 },
  { code: "C03_HOSPITALITY", label: "호스피탈리티", businessModel: "운영", allowedFrom: ["HOSPITALITY"], priority: 30 },
  { code: "C04_LIVING", label: "임대주택", businessModel: "임대주택", allowedFrom: ["LIVING"], priority: 40 },
  { code: "C05_HEALTHCARE", label: "실버하우스·헬스케어", businessModel: "운영", allowedFrom: ["MEDICAL"], priority: 50 },
  { code: "C06_EDUCATION", label: "교육", businessModel: "운영", allowedFrom: ["EDUCATION_RESEARCH"], priority: 60 },
  { code: "C07_CULTURE_ENTERTAINMENT", label: "문화 · 엔터테인먼트", businessModel: "운영", allowedFrom: ["CULTURE_ASSEMBLY", "SPORTS"], priority: 70 },
  { code: "C08_RND_LAB", label: "R&D · 랩", businessModel: "임대 · 운영", allowedFrom: ["EDUCATION_RESEARCH"], priority: 80 },
  { code: "C09_LOGISTICS", label: "물류", businessModel: "임대 · 운영", allowedFrom: ["LOGISTICS"], priority: 90 },
  { code: "C10_DIGITAL_INFRA", label: "디지털 인프라", businessModel: "용량 계약", allowedFrom: ["DIGITAL_INFRA"], priority: 100 },
];

const PUBLIC_FACILITIES: Array<{ code: PublicCode; label: string; revenue: boolean }> = [
  { code: "P_R_PARKING", label: "공영주차장", revenue: true },
  { code: "P_R_SENIOR_DAYCARE", label: "시니어 주야간보호시설", revenue: true },
  { code: "P_R_PUBLIC_RENTAL_HOUSING", label: "공공 매입임대주택", revenue: true },
  { code: "P_NR_SOCIAL_WELFARE_CENTER", label: "종합사회복지관", revenue: false },
  { code: "P_NR_SENIOR_WELFARE_CENTER", label: "노인복지관", revenue: false },
  { code: "P_NR_LIBRARY", label: "공공도서관", revenue: false },
  { code: "P_NR_PARK", label: "근린공원", revenue: false },
  { code: "P_NR_GENERIC", label: "그 밖의 공공시설", revenue: false },
];

// part3_program_scenario_policy
// 2026-09-06: 공공:수익 배분 기준을 고정값(60/40/20)에서 "규모 시나리오"(SiteProgram.tsx의
// capacityScenarios) GAP 기반으로 바꿨다.
//   GAP = 법정 최대(용적률 100%) − 기준 검토(용적률의 90%) = 법정상한 대비 10%p
// 대표님 지침: 이 GAP을 공공성 배분의 기준(균형형)으로 삼고, PPP사업의 기본은 수익사업이므로
// 공공성 강화는 거기서 +5%p, 수익성 증가는 −5%p로 시작한다.
// (부지마다 법정 FAR 값 자체는 달라도 90%/100%의 비율 차이는 항상 10%p라 GAP은 10으로 고정된다.)
const SCALE_SCENARIO_GAP_PCT = 10; // SiteProgram.tsx: 기준 검토(90%) ~ 법정 최대(100%)
const BASE_PUBLIC_PCT = SCALE_SCENARIO_GAP_PCT; // 균형형 기준 = 10%
const SCENARIOS = [
  { code: "PUBLIC_FOCUS", name: "공공성 중심", publicPct: BASE_PUBLIC_PCT + 5, commercialPct: 100 - (BASE_PUBLIC_PCT + 5) },
  { code: "BASE", name: "균형형", publicPct: BASE_PUBLIC_PCT, commercialPct: 100 - BASE_PUBLIC_PCT },
  {
    code: "COMMERCIAL_FOCUS",
    name: "수익성 중심",
    publicPct: Math.max(0, BASE_PUBLIC_PCT - 5),
    commercialPct: 100 - Math.max(0, BASE_PUBLIC_PCT - 5),
  },
];

const RECOMMENDED_SCENARIO = "BASE";

type UseLimit = { decision: "ALLOWED" | "CONDITIONAL" | "PROHIBITED" | "REVIEW"; maxGfaSqm: number | null };
type UseLimits = Record<string, UseLimit>;

type DemandScenarioCode = "CONSERVATIVE" | "BASE" | "AGGRESSIVE";

type ProgramSelection = {
  scenarioCode: string;
  commercial: Partial<Record<CommercialCode, number>>;
  publicFacilities: PublicCode[];
  touched: CommercialCode[];
  /** 2026-11-16: 임대주택(C04) 연면적을 정하는 주거 적정수요 시나리오. 없으면 중간(BASE). */
  demandScenario?: DemandScenarioCode;
};

// 2026-11-16: 주거 적정수요(1인가구). /api/housing-demand → Supabase compute_housing_demand.
type HousingDemand = {
  basis: {
    guName: string | null;
    baseDate: string | null;
    ownHouseholds: number | null;
    adjacentHouseholds: number | null;
    adjacentWeightPct: number | null;
    daytimeNetInflow: number | null;
    inflowConversionPct: number | null;
    potentialDemandHouseholds: number | null;
  };
  scenarios: Array<{
    code: DemandScenarioCode;
    name: string;
    capturePct: number | null;
    plannedUnits: number | null;
    demandSharePct: number | null;
    demandCoverageMultiple: number | null;
    appliedGfaSqm: number | null;
  }>;
};

const STEP1_KEY = "inrealtylab.step1";
const DEMAND_SOURCE_KEY = "inrealtylab.demand.source";
const DEMAND_SOURCE = "HOUSING_DEMAND_V1";
const HOUSING_CODE: CommercialCode = "C04_LIVING";
const DEMAND_SCENARIO_LABEL: Record<DemandScenarioCode, string> = { CONSERVATIVE: "보수", BASE: "중간", AGGRESSIVE: "공격" };

function readPrimaryPnu(): string | null {
  try {
    const raw = sessionStorage.getItem(STEP1_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { pnus?: string[] };
    return Array.isArray(parsed.pnus) && parsed.pnus.length ? String(parsed.pnus[0]) : null;
  } catch {
    return null;
  }
}

function formatCount(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value).toLocaleString("ko-KR") : "-";
}

/** 수요 시나리오 연면적을 수익시설 연면적 안으로 자르고, 잘린 만큼 계획 세대도 줄인다. */
function housingPlan(row: HousingDemand["scenarios"][number] | undefined, commercialGfa: number, potential: number | null) {
  if (!row || row.appliedGfaSqm === null || row.appliedGfaSqm <= 0) return null;
  const gfa = commercialGfa > 0 ? Math.min(row.appliedGfaSqm, commercialGfa) : row.appliedGfaSqm;
  const scale = gfa / row.appliedGfaSqm;
  const units = row.plannedUnits === null ? null : Math.floor(row.plannedUnits * scale);
  const share = potential && units ? (units / potential) * 100 : null;
  const multiple = potential && units ? potential / units : null;
  return { gfa, units, share, multiple, cappedByPool: scale < 1 };
}

function formatArea(value: number) {
  return `${Math.round(value).toLocaleString("ko-KR")}㎡`;
}

function readAllowedKeys(): string[] | null {
  try {
    const raw = sessionStorage.getItem(ALLOWED_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as string[]) : null;
  } catch {
    return null;
  }
}

function readUseLimits(): UseLimits {
  try {
    const raw = sessionStorage.getItem(LIMITS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as UseLimits) : {};
  } catch {
    return {};
  }
}

// 한 시설(C코드)은 여러 법정 용도에서 나올 수 있다(예: 리테일 ← 판매시설·제1종근생·제2종근생).
// 그중 가장 넉넉한 상한을 쓴다. 하나라도 상한이 없으면 상한 없음으로 본다.
function capFor(facility: CommercialFacility, allowedKeys: string[], limits: UseLimits): number | null {
  const usable = facility.allowedFrom.filter((key) => allowedKeys.includes(key));
  if (!usable.length) return null;
  let best: number | null = 0;
  for (const key of usable) {
    const cap = limits[key]?.maxGfaSqm ?? null;
    if (cap === null) return null;
    best = Math.max(best ?? 0, cap);
  }
  return best && best > 0 ? best : null;
}

// 상한이 붙은 법정 용도만 골라 보여준다. 예를 들어 리테일은 근생으로 구성하면 상한이 없지만
// 판매시설로 구성하면 조례상 2천㎡ 미만이다. 둘 다 알려줘야 오해가 없다.
function cappedSources(facility: CommercialFacility, allowedKeys: string[], limits: UseLimits) {
  return facility.allowedFrom
    .filter((key) => allowedKeys.includes(key))
    .map((key) => ({ key, cap: limits[key]?.maxGfaSqm ?? null }))
    .filter((item): item is { key: string; cap: number } => typeof item.cap === "number" && item.cap > 0);
}

const USE_LABEL: Record<string, string> = {
  OFFICE_GENERAL: "업무시설",
  PUBLIC_OFFICE: "공공업무시설",
  RETAIL: "판매시설",
  NEIGHBORHOOD_1: "제1종 근린생활시설",
  NEIGHBORHOOD_2: "제2종 근린생활시설",
  HOSPITALITY: "숙박시설",
  LIVING: "공동주택",
  MEDICAL: "의료시설",
  EDUCATION_RESEARCH: "교육연구시설",
  CULTURE_ASSEMBLY: "문화 및 집회시설",
  SPORTS: "운동시설",
  LOGISTICS: "창고시설",
  DIGITAL_INFRA: "방송통신시설",
};

function readAboveGroundGfa(): number {
  try {
    const raw = sessionStorage.getItem(SNAPSHOT_KEY);
    if (!raw) return 0;
    const parsed = JSON.parse(raw) as { siteAreaSqm?: number; statutoryFarMaxPct?: number | null };
    const area = Number(parsed.siteAreaSqm) || 0;
    const far = Number(parsed.statutoryFarMaxPct) || 0;
    return area > 0 && far > 0 ? area * (far / 100) : 0;
  } catch {
    return 0;
  }
}

// 허용된 시설 중 우선순위 상위 둘에 70:30을 제안한다.
// 실제 수요 데이터(demand_observation·facility_demand_weight) 연결은 다음 작업.
function recommend(
  available: CommercialFacility[],
  maxPctOf: (facility: CommercialFacility) => number
): Partial<Record<CommercialCode, number>> {
  if (!available.length) return {};

  const plan: Partial<Record<CommercialCode, number>> = {};
  let remaining = 100;

  // 우선순위 순으로 70:30을 시도하되, 각 시설의 면적 상한을 넘기지 않는다.
  const shares = available.length === 1 ? [100] : [70, 30];
  for (let index = 0; index < shares.length && index < available.length; index += 1) {
    const facility = available[index];
    const value = Math.min(shares[index], maxPctOf(facility), remaining);
    plan[facility.code] = value;
    remaining -= value;
  }

  // 상한 때문에 남은 몫은 아직 여유가 있는 다음 시설들이 이어받는다.
  if (remaining > 0) {
    for (const facility of available) {
      if (remaining <= 0) break;
      const current = plan[facility.code] ?? 0;
      const room = Math.max(0, maxPctOf(facility) - current);
      if (room <= 0) continue;
      const add = Math.min(room, remaining);
      plan[facility.code] = current + add;
      remaining -= add;
    }
  }

  return plan;
}

export default function ProgramChoice() {
  const [allowedKeys, setAllowedKeys] = useState<string[] | null>(null);
  const [useLimits, setUseLimits] = useState<UseLimits>({});
  const [aboveGroundGfa, setAboveGroundGfa] = useState(0);
  const [selection, setSelection] = useState<ProgramSelection | null>(null);
  const [housingDemand, setHousingDemand] = useState<HousingDemand | null>(null);
  const [housingDemandNote, setHousingDemandNote] = useState("");

  useEffect(() => {
    setAllowedKeys(readAllowedKeys());
    setUseLimits(readUseLimits());
    setAboveGroundGfa(readAboveGroundGfa());

    // STEP 2의 허용용도 조회는 비동기라 이 컴포넌트가 뜬 뒤에 끝난다.
    // 끝났다는 신호를 받으면 그때 다시 읽는다.
    function onAllowedUse(event: Event) {
      const detail = (event as CustomEvent).detail;
      if (Array.isArray(detail)) {
        // 예전 형태(키 배열)도 계속 받는다.
        setAllowedKeys(detail as string[]);
        setUseLimits(readUseLimits());
      } else if (detail && typeof detail === "object") {
        if (Array.isArray(detail.keys)) setAllowedKeys(detail.keys as string[]);
        if (detail.limits) setUseLimits(detail.limits as UseLimits);
      }
      setAboveGroundGfa(readAboveGroundGfa());
    }

    window.addEventListener("inrealtylab:allowedUse", onAllowedUse);
    return () => window.removeEventListener("inrealtylab:allowedUse", onAllowedUse);
  }, []);

  const available = useMemo(() => {
    if (!allowedKeys) return [];
    return COMMERCIAL
      .filter((facility) => facility.allowedFrom.some((key) => allowedKeys.includes(key)))
      .sort((a, b) => a.priority - b.priority);
  }, [allowedKeys]);

  const blocked = useMemo(() => {
    if (!allowedKeys) return [];
    return COMMERCIAL.filter((facility) => !facility.allowedFrom.some((key) => allowedKeys.includes(key)));
  }, [allowedKeys]);

  const scenario = SCENARIOS.find((item) => item.code === selection?.scenarioCode) ?? SCENARIOS[1];
  const commercialGfa = aboveGroundGfa * (scenario.commercialPct / 100);
  const publicGfa = aboveGroundGfa * (scenario.publicPct / 100);
  // 조례 상한(㎡)을 수익시설 배분 비율(%)로 환산한다.
  const capsSqm = useMemo(() => {
    const map = new Map<CommercialCode, number | null>();
    if (!allowedKeys) return map;
    for (const facility of COMMERCIAL) map.set(facility.code, capFor(facility, allowedKeys, useLimits));
    return map;
  }, [allowedKeys, useLimits]);

  const maxPctOf = useMemo(() => {
    return (facility: CommercialFacility) => {
      const cap = capsSqm.get(facility.code) ?? null;
      if (cap === null || commercialGfa <= 0) return 100;
      return Math.max(0, Math.min(100, Math.floor((cap / commercialGfa) * 100)));
    };
  }, [capsSqm, commercialGfa]);

  // 1차 제안을 만들거나, 저장해둔 사용자 수정본을 되살린다 — 이건 최초 1회만 해야 하는 일이다.
  // 버그였던 부분: 의존성 배열에 maxPctOf가 들어있었는데, maxPctOf는 commercialGfa가 바뀔 때마다
  // (= 시나리오 카드를 "공공성 중심"/"수익성 중심"으로 바꿀 때마다) 새 함수 참조로 다시 만들어진다.
  // 그러면 이 effect가 다시 실행되면서, 방금 setSelection으로 바꾼 scenarioCode가 sessionStorage에
  // 아직 저장되기 전(=저장 effect가 뒤에 실행되기 전) 시점의 "변경 전" 값을 다시 읽어와 덮어써버려서
  // 카드를 눌러도 원래대로 되돌아가는(화면이 흔들리는 것처럼 보이는) 문제가 있었다.
  // selection이 이미 있으면(=최초 제안/복원이 끝났으면) 다시 실행하지 않도록 가드를 추가한다.
  useEffect(() => {
    if (!allowedKeys || selection) return;
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (raw) {
        setSelection(JSON.parse(raw) as ProgramSelection);
        return;
      }
    } catch {
      // 저장본을 못 읽으면 새로 제안한다.
    }
    setSelection({
      scenarioCode: RECOMMENDED_SCENARIO,
      commercial: recommend(available, maxPctOf),
      publicFacilities: ["P_R_PARKING", "P_NR_SOCIAL_WELFARE_CENTER"],
      touched: [],
    });
  }, [allowedKeys, available, maxPctOf, selection]);

  // 2026-11-16: 임대주택을 고를 수 있는 필지면 주거 적정수요를 불러온다.
  // 최대 연면적은 법정 지상 연면적을 넘기고, 수익시설 연면적 안으로 자르는 건 화면에서 한다.
  const housingAvailable = available.some((facility) => facility.code === HOUSING_CODE);
  useEffect(() => {
    if (!housingAvailable || aboveGroundGfa <= 0) return;
    const pnu = readPrimaryPnu();
    if (!pnu) return;
    let cancelled = false;
    fetch(`/api/housing-demand?pnu=${encodeURIComponent(pnu)}&maxGfa=${Math.round(aboveGroundGfa)}`, { cache: "no-store" })
      .then((response) => response.json())
      .then((data) => {
        if (cancelled) return;
        if (data?.ok) {
          setHousingDemand({ basis: data.basis, scenarios: data.scenarios });
          setHousingDemandNote("");
        } else {
          setHousingDemand(null);
          setHousingDemandNote(data?.message ?? "주거 적정수요를 불러오지 못했습니다.");
        }
      })
      .catch(() => {
        if (!cancelled) setHousingDemandNote("주거 적정수요를 불러오지 못했습니다.");
      });
    return () => {
      cancelled = true;
    };
  }, [housingAvailable, aboveGroundGfa]);

  const demandScenario: DemandScenarioCode = selection?.demandScenario ?? "BASE";
  const housingSelected = Boolean(selection && (selection.commercial[HOUSING_CODE] ?? 0) > 0);
  const potentialDemand = housingDemand?.basis.potentialDemandHouseholds ?? null;
  const activeHousingPlan = housingSelected
    ? housingPlan(housingDemand?.scenarios.find((row) => row.code === demandScenario), commercialGfa, potentialDemand)
    : null;

  useEffect(() => {
    if (!selection) return;
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(selection));

      // STEP 3 엔진이 읽는 형태로도 같이 남긴다.
      // 이 다리가 없어서 지금까지 STEP 2 선택이 사업성 계산에 반영되지 않았다.
      const picked = (Object.entries(selection.commercial) as Array<[CommercialCode, number]>)
        .filter(([, pct]) => Number(pct) > 0);
      const ratioTotal = picked.reduce((sum, [, pct]) => sum + Number(pct), 0);

      if (activeHousingPlan) {
        // 2026-11-16: 수요 연결. 임대주택 연면적은 슬라이더 비율이 아니라 주거 적정수요로 정하고,
        // 나머지 수익시설은 고른 비율대로 수익시설 연면적을 나눠 갖는다.
        // STEP 3(보고서)은 inrealtylab.demand.* 키가 채워져 있어야 수요 기준으로 계산한다.
        // 이 키가 비어 있어서 지금까지 수익시설 연면적이 60% 고정 가정으로만 계산됐다.
        const gfaByCode = new Map<CommercialCode, number>();
        for (const [code, pct] of picked) {
          gfaByCode.set(code, code === HOUSING_CODE ? activeHousingPlan.gfa : commercialGfa * (Number(pct) / 100));
        }
        const gfaTotal = Array.from(gfaByCode.values()).reduce((sum, value) => sum + value, 0);

        for (const facility of COMMERCIAL) {
          const key = `inrealtylab.demand.commercial.${facility.code}`;
          const value = gfaByCode.get(facility.code);
          if (value === undefined) sessionStorage.removeItem(key);
          else sessionStorage.setItem(key, String(Math.round(value)));
        }
        sessionStorage.setItem("inrealtylab.demand.public", String(Math.round(publicGfa)));
        sessionStorage.setItem(DEMAND_SOURCE_KEY, DEMAND_SOURCE);
        sessionStorage.setItem(
          "inrealtylab.housingDemand",
          JSON.stringify({
            segment: "SINGLE_1P",
            scenario: demandScenario,
            basis: housingDemand?.basis ?? null,
            plannedUnits: activeHousingPlan.units,
            gfaSqm: activeHousingPlan.gfa,
            demandSharePct: activeHousingPlan.share,
            demandCoverageMultiple: activeHousingPlan.multiple,
          })
        );

        sessionStorage.setItem(
          "inrealtylab.commercialAllocation",
          JSON.stringify({
            complete: gfaTotal > 0,
            commercialPoolGfaSqm: gfaTotal,
            facilities: Array.from(gfaByCode.entries()).map(([facilityCode, gfa]) => ({
              facilityCode,
              ratioPct: gfaTotal > 0 ? (gfa / gfaTotal) * 100 : 0,
            })),
          })
        );
        return;
      }

      // 임대주택이 빠졌으면, 이 화면이 써 넣었던 수요값만 지운다(관리자가 직접 넣은 값은 그대로 둔다).
      if (sessionStorage.getItem(DEMAND_SOURCE_KEY) === DEMAND_SOURCE) {
        for (const facility of COMMERCIAL) sessionStorage.removeItem(`inrealtylab.demand.commercial.${facility.code}`);
        sessionStorage.removeItem("inrealtylab.demand.public");
        sessionStorage.removeItem(DEMAND_SOURCE_KEY);
        sessionStorage.removeItem("inrealtylab.housingDemand");
      }

      sessionStorage.setItem(
        "inrealtylab.commercialAllocation",
        JSON.stringify({
          // 합계가 100%에 닿아야 배분이 확정된 것으로 본다(반올림 오차 0.5%p 허용).
          complete: picked.length > 0 && Math.abs(ratioTotal - 100) <= 0.5,
          commercialPoolGfaSqm: commercialGfa,
          facilities: picked.map(([facilityCode, ratioPct]) => ({ facilityCode, ratioPct: Number(ratioPct) })),
        })
      );
    } catch {
      // 스토리지를 못 쓰면 STEP 3에서 기본 배분으로 계산한다.
    }
    // activeHousingPlan은 매 렌더 새 객체라 값(gfa)으로 의존한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection, commercialGfa, publicGfa, housingDemand, demandScenario, activeHousingPlan?.gfa]);



  const commercialTotal = useMemo(() => {
    if (!selection) return 0;
    return Object.values(selection.commercial).reduce((sum, value) => sum + (value ?? 0), 0);
  }, [selection]);

  // 한 줄을 바꾸면 나머지 줄들이(이미 손댄 줄 포함) 기존 비율을 유지한 채
  // 남은 몫을 나눠 가져 합계가 항상 100%를 넘지 않도록 한다.
  // (예전 버전은 "손대지 않은 줄"만 조정 대상이라, 두 줄 이상을 직접 수정하면
  //  나머지가 그대로 얼어붙어 합계가 100%를 넘거나 못 미치는 문제가 있었다.)
  function setCommercialPct(code: CommercialCode, nextValue: number) {
    setSelection((current) => {
      if (!current) return current;
      const facility = COMMERCIAL.find((item) => item.code === code);
      const ceiling = facility ? maxPctOf(facility) : 100;
      const value = Math.max(0, Math.min(ceiling, Math.round(nextValue)));
      const touched = current.touched.includes(code) ? current.touched : [...current.touched, code];
      const entries = Object.keys(current.commercial) as CommercialCode[];
      const others = entries.filter((item) => item !== code);
      const remainder = Math.max(0, 100 - value);

      const next: Partial<Record<CommercialCode, number>> = { ...current.commercial, [code]: value };

      if (others.length) {
        const prevTotal = others.reduce((sum, item) => sum + (current.commercial[item] ?? 0), 0);
        let pool = remainder;

        others.forEach((item, index) => {
          const isLast = index === others.length - 1;
          const otherFacility = COMMERCIAL.find((entry) => entry.code === item);
          const itemCeiling = otherFacility ? maxPctOf(otherFacility) : 100;
          const raw = isLast
            ? pool
            : prevTotal > 0
              ? Math.round((remainder * (current.commercial[item] ?? 0)) / prevTotal)
              : Math.round(remainder / others.length);
          const capped = Math.max(0, Math.min(itemCeiling, raw));
          next[item] = capped;
          pool -= capped;
        });

        // 상한에 걸려 다 못 나눠준 몫은 아직 여유가 있는 줄로 마저 배분한다.
        // (그래도 남으면 이 필지의 총 상한이 부족한 것이라 합계가 100% 밑에서 멈춘다 —
        //  100%를 넘기지 않는 쪽이 안전하므로 의도한 동작이다.)
        if (pool > 0) {
          for (const item of others) {
            if (pool <= 0) break;
            const otherFacility = COMMERCIAL.find((entry) => entry.code === item);
            const itemCeiling = otherFacility ? maxPctOf(otherFacility) : 100;
            const already = next[item] ?? 0;
            const room = Math.max(0, itemCeiling - already);
            if (room <= 0) continue;
            const add = Math.min(room, pool);
            next[item] = already + add;
            pool -= add;
          }
        }
      }

      return { ...current, commercial: next, touched };
    });
  }

  function addFacility(code: CommercialCode) {
    setSelection((current) => {
      if (!current || current.commercial[code] !== undefined) return current;
      return { ...current, commercial: { ...current.commercial, [code]: 0 } };
    });
  }

  function removeFacility(code: CommercialCode) {
    setSelection((current) => {
      if (!current) return current;
      const removedPct = current.commercial[code] ?? 0;
      const next = { ...current.commercial };
      delete next[code];
      const remaining = Object.keys(next) as CommercialCode[];

      // 제거한 시설의 비율을 나머지 시설들에게 기존 비율대로 되돌려줘서
      // 합계가 항상 100%를 유지하도록 한다. (예전 버전은 그냥 버려서 합계가 100% 밑으로 떨어졌다.)
      if (removedPct > 0 && remaining.length) {
        const prevTotal = remaining.reduce((sum, item) => sum + (next[item] ?? 0), 0);
        let pool = removedPct;
        remaining.forEach((item, index) => {
          const isLast = index === remaining.length - 1;
          const otherFacility = COMMERCIAL.find((entry) => entry.code === item);
          const itemCeiling = otherFacility ? maxPctOf(otherFacility) : 100;
          const raw = isLast
            ? pool
            : prevTotal > 0
              ? Math.round((removedPct * (next[item] ?? 0)) / prevTotal)
              : Math.round(removedPct / remaining.length);
          const capped = Math.max(0, Math.min(itemCeiling, (next[item] ?? 0) + raw) - (next[item] ?? 0));
          next[item] = (next[item] ?? 0) + capped;
          pool -= capped;
        });
        if (pool > 0) {
          for (const item of remaining) {
            if (pool <= 0) break;
            const otherFacility = COMMERCIAL.find((entry) => entry.code === item);
            const itemCeiling = otherFacility ? maxPctOf(otherFacility) : 100;
            const room = Math.max(0, itemCeiling - (next[item] ?? 0));
            if (room <= 0) continue;
            const add = Math.min(room, pool);
            next[item] = (next[item] ?? 0) + add;
            pool -= add;
          }
        }
      }

      return {
        ...current,
        commercial: next,
        touched: current.touched.filter((item) => item !== code),
      };
    });
  }

  function togglePublic(code: PublicCode) {
    setSelection((current) => {
      if (!current) return current;
      const has = current.publicFacilities.includes(code);
      return {
        ...current,
        publicFacilities: has
          ? current.publicFacilities.filter((item) => item !== code)
          : [...current.publicFacilities, code],
      };
    });
  }

  function resetToRecommended() {
    setSelection({
      scenarioCode: RECOMMENDED_SCENARIO,
      commercial: recommend(available, maxPctOf),
      publicFacilities: ["P_R_PARKING", "P_NR_SOCIAL_WELFARE_CENTER"],
      touched: [],
    });
  }

  if (!allowedKeys) {
    return (
      <section className="control-section">
        <div className="control-section-title"><span>STEP 2 · 선택</span><strong>프로그램 구성</strong></div>
        <div className="regime-note">지을 수 있는 용도가 확인되면 시설 구성을 제안합니다.</div>
      </section>
    );
  }

  if (!selection) return null;

  const selectedCodes = Object.keys(selection.commercial) as CommercialCode[];
  // 허용 용도들의 상한을 다 합쳐도 수익시설 연면적에 못 미치는지 본다.
  const capacityShortfall =
    commercialGfa > 0 &&
    available.length > 0 &&
    available.every((facility) => (capsSqm.get(facility.code) ?? null) !== null) &&
    available.reduce((sum, facility) => sum + (capsSqm.get(facility.code) ?? 0), 0) < commercialGfa;
  const addable = available.filter((facility) => selection.commercial[facility.code] === undefined);
  const totalOk = commercialTotal === 100;

  return (
    <section className="control-section">
      <div className="control-section-title">
        <span>STEP 2 · 선택</span>
        <strong>프로그램 구성</strong>
      </div>

      <div className="choice-head" style={{ marginBottom: 10 }}>
        <em className="choice-proposed">1차 제안</em>
        <button type="button" className="choice-reset" onClick={resetToRecommended}>추천 구성으로 되돌리기</button>
      </div>
      <p className="choice-hint">
        수요를 기준으로 구성을 먼저 제안했습니다. 각 줄을 바꾸면 손대지 않은 줄이 자동으로 조정돼 합계 100%가 유지됩니다.
      </p>

      {/* ── 시나리오 ── */}
      <div className="choice-grid three">
        {SCENARIOS.map((item) => (
          <button
            type="button"
            key={item.code}
            className={`choice-card${selection.scenarioCode === item.code ? " selected" : ""}`}
            onClick={() => setSelection((current) => (current ? { ...current, scenarioCode: item.code } : current))}
          >
            <span className="choice-card-head">
              <i className="choice-radio" />
              <strong>{item.name}</strong>
              {item.code === RECOMMENDED_SCENARIO && <em className="choice-tag">추천</em>}
            </span>
            <span className="choice-desc">공공 {item.publicPct}% : 수익 {item.commercialPct}%</span>
          </button>
        ))}
      </div>

      {/* ── 연면적 분할 ── */}
      {aboveGroundGfa > 0 ? (
        <>
          <div className="program-split">
            <div className="program-split-bar">
              <div className="program-split-public" style={{ width: `${scenario.publicPct}%` }}>
                공공 {scenario.publicPct}% · {formatArea(publicGfa)}
              </div>
              <div className="program-split-commercial" style={{ width: `${scenario.commercialPct}%` }}>
                수익 {scenario.commercialPct}% · {formatArea(commercialGfa)}
              </div>
            </div>
            <div className="program-split-total">지상 연면적 <strong>{formatArea(aboveGroundGfa)}</strong></div>
          </div>
        </>
      ) : (
        <div className="regime-note">용적률 상한이 확인되면 연면적 배분을 계산합니다.</div>
      )}

      {/* ── 주거 적정수요 (2026-11-16) ── */}
      {housingAvailable && (
        <div className="housing-demand">
          <div className="program-head">
            <div><strong>주거 적정수요</strong> <span>1인가구 기준</span></div>
            {!housingSelected && <em className="program-note">임대주택을 넣으면 연면적에 반영됩니다</em>}
          </div>
          {housingDemand ? (
            <>
              <p className="choice-hint">
                잠재 수요 <strong>{formatCount(potentialDemand)}가구</strong> = {housingDemand.basis.guName ?? "소재 자치구"} 1인가구{" "}
                {formatCount(housingDemand.basis.ownHouseholds)} + 인접 자치구 1인가구 {formatCount(housingDemand.basis.adjacentHouseholds)} ×{" "}
                {housingDemand.basis.adjacentWeightPct ?? "-"}% + 평일 주간 순유입인구 {formatCount(housingDemand.basis.daytimeNetInflow)} ×{" "}
                {housingDemand.basis.inflowConversionPct ?? "-"}%
              </p>
              <div className="choice-grid three">
                {housingDemand.scenarios.map((row) => {
                  const plan = housingPlan(row, commercialGfa, potentialDemand);
                  return (
                    <button
                      type="button"
                      key={row.code}
                      className={`choice-card${demandScenario === row.code ? " selected" : ""}`}
                      onClick={() => setSelection((current) => (current ? { ...current, demandScenario: row.code } : current))}
                    >
                      <span className="choice-card-head">
                        <i className="choice-radio" />
                        <strong>{DEMAND_SCENARIO_LABEL[row.code] ?? row.name}</strong>
                        <em className="choice-tag">포착률 {row.capturePct ?? "-"}%</em>
                      </span>
                      <span className="choice-desc">
                        계획 {formatCount(plan?.units)}세대, {plan ? formatArea(plan.gfa) : "-"}
                      </span>
                      <span className="choice-desc">
                        잠재 수요의 {plan?.share !== null && plan?.share !== undefined ? plan.share.toFixed(2) : "-"}%, 수요 여유{" "}
                        {plan?.multiple ? plan.multiple.toFixed(0) : "-"}배
                      </span>
                      {plan?.cappedByPool && <span className="choice-desc">수익시설 연면적 상한 적용</span>}
                    </button>
                  );
                })}
              </div>
              {activeHousingPlan && activeHousingPlan.multiple && (
                <p className="choice-hint">
                  {DEMAND_SCENARIO_LABEL[demandScenario]} 시나리오 계획 {formatCount(activeHousingPlan.units)}세대는 잠재 수요의{" "}
                  {activeHousingPlan.share?.toFixed(2)}%로, 잠재 수요가 계획 세대의 약 {activeHousingPlan.multiple.toFixed(0)}배임.
                </p>
              )}
            </>
          ) : (
            <div className="regime-note">{housingDemandNote || "주거 적정수요를 계산하고 있습니다."}</div>
          )}
        </div>
      )}

      {/* ── 수익시설 ── */}
      <div className="program-head">
        <div><strong>수익시설</strong> <span>{aboveGroundGfa > 0 ? formatArea(commercialGfa) : "-"}</span></div>
        <em className={`program-total${totalOk ? " ok" : ""}`}>합계 {commercialTotal}%</em>
      </div>

      <div className="program-rows">
        {selectedCodes.map((code) => {
          const facility = COMMERCIAL.find((item) => item.code === code);
          if (!facility) return null;
          const pct = selection.commercial[code] ?? 0;
          const isTouched = selection.touched.includes(code);
          const capSqm = capsSqm.get(code) ?? null;
          const ceilingPct = maxPctOf(facility);
          const partialCaps = allowedKeys ? cappedSources(facility, allowedKeys, useLimits) : [];
          const assigned = commercialGfa * (pct / 100);
          return (
            <div className={`program-row${isTouched ? " touched" : ""}`} key={code}>
              <div className="program-row-head">
                <span className="program-code admin-only">{code}</span>
                <strong>{facility.label}</strong>
                <span className="program-model">{facility.businessModel}</span>
                {isTouched ? <em className="choice-tag dark">직접 수정함</em> : <em className="choice-tag">추천</em>}
                {capSqm !== null && <em className="choice-tag cap">상한 {formatArea(capSqm)}</em>}
                <button type="button" className="program-remove" onClick={() => removeFacility(code)}>제거</button>
              </div>
              <div className="program-row-input">
                <input
                  type="range"
                  className="choice-range"
                  min={0}
                  max={100}
                  step={5}
                  value={pct}
                  onChange={(event) => setCommercialPct(code, Number(event.target.value))}
                />
                <strong>{pct}%</strong>
                <span>{aboveGroundGfa > 0 ? formatArea(code === HOUSING_CODE && activeHousingPlan ? activeHousingPlan.gfa : assigned) : "-"}</span>
              </div>
              {code === HOUSING_CODE && activeHousingPlan && (
                <p className="program-row-note">
                  임대주택 연면적은 비율이 아니라 주거 적정수요({DEMAND_SCENARIO_LABEL[demandScenario]}) 기준{" "}
                  {formatArea(activeHousingPlan.gfa)}, 계획 {formatCount(activeHousingPlan.units)}세대로 사업성 계산에 반영됩니다.
                </p>
              )}
              {capSqm !== null && ceilingPct < 100 && (
                <p className="program-row-note">
                  조례상 이 용도의 바닥면적 합계는 {formatArea(capSqm)} 미만입니다. 수익시설 {formatArea(commercialGfa)} 기준으로
                  최대 {ceilingPct}%까지만 배분됩니다.
                </p>
              )}
              {capSqm === null && partialCaps.length > 0 && (
                <p className="program-row-note">
                  {partialCaps
                    .map((item) => `${USE_LABEL[item.key] ?? item.key}로 구성하면 ${formatArea(item.cap)} 미만`)
                    .join(" · ")}
                  . 상한이 없는 용도로 구성하면 제한이 없습니다.
                </p>
              )}
            </div>
          );
        })}
      </div>

      {!totalOk && (
        <div className="control-warning">
          수익시설 비율 합계가 정확히 100%가 되어야 연면적 배분이 확정됩니다. 지금은 {commercialTotal}%입니다.
          {capacityShortfall && (
            <> 이 필지는 허용 용도별 바닥면적 상한을 다 합쳐도 수익시설 연면적을 채우지 못합니다. 규모를 줄이거나 공공시설 비중을 높이는 시나리오를 검토해야 합니다.</>
          )}
        </div>
      )}

      {addable.length > 0 && (
        <>
          <p className="choice-hint" style={{ marginTop: 16 }}>더 넣을 수 있는 시설</p>
          <div className="program-chips">
            {addable.map((facility) => (
              <button type="button" key={facility.code} className="program-chip" onClick={() => addFacility(facility.code)}>
                <span className="program-code admin-only">{facility.code}</span>{facility.label}
              </button>
            ))}
          </div>
        </>
      )}

      {blocked.length > 0 && (
        <>
          <p className="choice-hint" style={{ marginTop: 16 }}>이 필지에서는 허용 용도 밖</p>
          <div className="program-chips">
            {blocked.map((facility) => (
              <span key={facility.code} className="program-chip blocked">
                <span className="program-code admin-only">{facility.code}</span>{facility.label}
              </span>
            ))}
          </div>
        </>
      )}

      {/* ── 공공시설 ── */}
      <div className="program-head" style={{ marginTop: 24 }}>
        <div><strong>공공시설</strong> <span>{aboveGroundGfa > 0 ? formatArea(publicGfa) : "-"}</span></div>
        <em className="program-note">수익 발생 여부로 나뉩니다</em>
      </div>
      <div className="program-chips">
        {PUBLIC_FACILITIES.map((facility) => {
          const on = selection.publicFacilities.includes(facility.code);
          return (
            <button
              type="button"
              key={facility.code}
              className={`program-chip${on ? " on" : ""}`}
              onClick={() => togglePublic(facility.code)}
            >
              <span className={`program-code${facility.revenue ? " revenue" : ""}`}>{facility.revenue ? "수익" : "비수익"}</span>
              {facility.label}
            </button>
          );
        })}
      </div>
    </section>
  );
}
