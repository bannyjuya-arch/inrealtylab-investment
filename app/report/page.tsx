"use client";

import { useEffect, useMemo, useState } from "react";
import {
  COMMERCIAL_CATEGORIES,
  CONCESSION_TERMS,
  DEVELOPMENT_SCENARIOS,
  buildIntegratedAnalysis,
  facilityLabel,
  INTERNAL_SOURCE_LABEL,
  formatGfa,
  formatPercent,
  formatWon,
  type CommercialCategoryKey,
  type DemandInputs,
  type FinancialAssumptions,
} from "../../lib/integrated-report";
import { getSupabaseBrowserClient } from "../../lib/supabase-browser";
import "./report.css";

type Part1Snapshot = {
  pnus?: string[];
  siteAreaSqm?: number | null;
  primaryZone?: string | null;
  statutoryFarMaxPct?: number | null;
  statutoryBcrMaxPct?: number | null;
};

type OwnershipRecord = {
  pnu: string;
  legalDong: string;
  jibun: string;
  areaSqm: number | null;
  officialLandPrice: number | null;
  ownerClass: string;
  ownerSector: "PUBLIC" | "PRIVATE" | "UNKNOWN";
  ownerTypeLabel: string;
};

type OwnershipResponse = {
  ok: boolean;
  message?: string;
  records?: OwnershipRecord[];
  assessment?: { inScope: boolean; unresolved?: string[] };
};

type OwnershipParcel = { pnu: string; result: OwnershipResponse };

type LandPriceResponse = {
  ok: boolean;
  pnu?: string;
  pricePerSqm?: number | null;
  standardYear?: string | null;
  message?: string;
  source?: { name?: string; provider?: string; unit?: string };
};

type LandPriceParcel = { pnu: string; result: LandPriceResponse };

type FloorSummary = {
  basementAreaSqm: number;
  aboveGroundAreaSqm: number;
  basementRatioPct: number | null;
};

type FloorResponse = {
  ok: boolean;
  summary?: FloorSummary;
  message?: string;
  source?: { name?: string; endpoint?: string };
};

type FloorParcel = { pnu: string; result: FloorResponse };

const emptyDemand: DemandInputs = {
  publicRequiredGfa: null,
  commercialSupportableGfa: Object.fromEntries(
    COMMERCIAL_CATEGORIES.map((item) => [item.key, null])
  ) as Partial<Record<CommercialCategoryKey, number | null>>,
};

type FinanceDefaultSource = {
  metricCode: string;
  value: number | null;
  range: { low: number | null; high: number | null };
  unit: string | null;
  publisher: string | null;
  reportName: string | null;
  sourcePage: string | null;
  baseDate: string | null;
  note: string | null;
};

type StructurePolicyResponse = {
  resolved: { code: string; reason: string };
  policy: {
    structureCode: string;
    structureName: string;
    structureGroup: string;
    terminalValuePolicy: string;
    usesExitCapRate: boolean;
    dscrRequired: boolean;
    dscrMin: number | null;
    depreciationBasis: string | null;
    propertyTaxApplies: boolean | null;
    ownershipDuringOperation: string | null;
    notes: string | null;
    trustFeeRatePct: number | null;
    trustFeeBase: string | null;
    trustFeeBasis: string | null;
    corporateTaxExempt: boolean | null;
  };
  corporateTax: {
    exempt: boolean;
    basis: string;
    statuteRef: string | null;
    brackets: Array<{ upperKrw: number | null; ratePct: number; deductionKrw: number }>;
    localBrackets: Array<{ upperKrw: number | null; ratePct: number; deductionKrw: number }>;
  } | null;
  trustFee: {
    ratePct: number;
    base: string;
    baseName: string;
    basis: string;
    isCeiling: boolean;
    overridden: boolean;
  } | null;
  taxNotes: string[];
  unmodelled: string[];
};

type FinanceDefaults = {
  defaults: {
    referenceRatePct: number | null;
    pfSpreadPct: number | null;
    impliedRatePct: number | null;
    debtRatioPct: number | null;
    investorRequiredReturnPct: number | null;
  };
  sources: FinanceDefaultSource[];
  warnings: string[];
};

type RentFacility = {
  facilityCode: string;
  rentPerSqmMonth: number;
  rentKind: string;
  geography: string;
  baseDate: string | null;
  source: string | null;
  originTable: string;
  matchedSubmarket: boolean;
};

type RetailResolution = {
  subtype: string;
  firstFloorRentPerSqmMonth: number;
  blendedRentPerSqmMonth: number | null;
  geographyLevel: string;
  geographyName: string;
  matchBasis: string;
  baseDate: string;
  source: string | null;
  methodology: string | null;
  floors: { aboveGround: number; basement: number };
  floorRatio: {
    ratioPct: number;
    geography: string;
    detail: Array<{ floor: string; ratioPct: number; count: number }>;
    notes: string[];
  } | null;
  tradeAreaOptions: Array<{ code: string | null; name: string; rentPerSqmMonth: number }>;
  notes: string[];
};

type HousingResolution = {
  housingType: string;
  statKind: string;
  rentPerSqmMonthExclusive: number;
  rentKrwUnitMonth: number;
  geographyName: string;
  geographyCode: string;
  geographyLevel: string;
  matchBasis: string;
  conversionRatePct: number;
  rateSource: string;
  jeonsePerSqmKrw: number;
  baseMonth: string;
  report: string | null;
  sourcePage: string | null;
  areaBasis: string;
  notes: string[];
};

type RentResolverResponse = {
  ok: boolean;
  submarket: string | null;
  submarketBasis: string;
  retailZone: string | null;
  sido: string | null;
  facilities: RentFacility[];
  retail: RetailResolution | null;
  housing: HousingResolution | null;
  missing: string[];
  note: string;
};

const HOUSING_TYPES = ["아파트", "종합", "연립다세대", "단독주택"];

type PropertyTaxResponse = {
  ok: boolean;
  message?: string;
  standardValuePerSqm?: number;
  taxPerSqmYear?: number;
  formula?: string;
  notes?: string[];
  basis?: {
    newBuildPricePerSqm: number;
    structureIndex: number;
    useIndex: number;
    locationIndex: number;
    locationBand: string;
    residualRatioPct: number;
    fairMarketRatioPct: number;
    taxRatePct: number;
    useIndexAssumed: boolean;
  };
};

// 한국부동산원 상업용부동산 임대동향조사의 표본 구분을 그대로 따른다.
// 중대형상가 = 3층 이상이거나 연면적 330㎡ 초과, 소규모상가 = 2층 이하이고 330㎡ 이하.
// 층수 기본값을 이 정의에서 가져와야 임대료와 층수가 같은 표본을 가리킨다.
const RETAIL_SUBTYPES = [
  { code: "중대형상가", label: "중대형상가 (3층 이상 또는 330㎡ 초과)", defaultFloors: 3 },
  { code: "소규모상가", label: "소규모상가 (2층 이하·330㎡ 이하)", defaultFloors: 2 },
  { code: "집합상가", label: "집합상가 (집합건축물)", defaultFloors: 3 },
];

const initialAssumptions: FinancialAssumptions = {
  basementRatioPct: null,
  constructionCostPerSqm: null,
  monthlyRentPerSqm: null,
  occupancyPct: 90,
  opexPct: null,
  referenceRatePct: null,
  pfSpreadPct: null,
  debtRatioPct: null,
  debtTenorYears: null,
  investorRequiredReturnPct: null,
  otherAnnualRevenue: null,
};

function parseNumber(value: string) {
  if (!value.trim()) return null;
  const parsed = Number(value.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function basisLabel(basis: "USER" | "BENCHMARK" | "FALLBACK") {
  if (basis === "USER") return "직접 입력";
  if (basis === "BENCHMARK") return "DB 기준값";
  return "기본값 · 근거 없음";
}

function irrText(value: number | null) {
  return value === null ? "-" : `${(value * 100).toFixed(2)}%`;
}

/**
 * 사용자 화면에 보이는 판정 표기. 내부 코드값(PASS·REVIEW…)은 관리자·DB 쪽에만 남긴다.
 */
/** 서브마켓 코드는 리서치 용어라 화면에는 한글 권역명으로 바꿔 보여준다. */
const REGION_LABEL: Record<string, string> = {
  CBD: "도심권역", GBD: "강남권역", YBD: "여의도권역",
  Others: "서울 기타권역", Pangyo: "판교", Bundang: "분당",
  "Capital Area": "수도권", SEOUL_TOTAL: "서울 전체", NATION: "전국",
};
function regionLabel(value: string | null | undefined) {
  if (!value) return "-";
  return REGION_LABEL[value] ?? value;
}

/** 운영기간 중 시설 소유주체. DB 코드값을 그대로 보여주지 않는다. */
function ownershipLabel(value: string | null | undefined) {
  const map: Record<string, string> = {
    PUBLIC: "공공", PRIVATE: "민간", TRUSTEE: "신탁사", SPC: "사업시행법인", REIT: "리츠",
  };
  return value ? map[value] ?? value : "-";
}

function statusLabel(value: string) {
  const map: Record<string, string> = {
    PASS: "가능", STRONG: "우수", ELIGIBLE: "가능",
    CONDITIONAL: "조건부", REVIEW: "확인 필요",
    FAIL: "불가", NOT_ELIGIBLE: "불가",
    SHORT: "부족", EXCESS: "여유", EXACT: "적정",
  };
  return map[value] ?? value;
}

function statusTone(value: string) {
  if (value === "PASS" || value === "ELIGIBLE") return "pass";
  if (value === "STRONG") return "strong";
  if (value === "CONDITIONAL") return "conditional";
  if (value === "FAIL" || value === "NOT_ELIGIBLE") return "fail";
  if (value === "SHORT") return "short";
  if (value === "EXCESS") return "excess";
  if (value === "EXACT") return "fit";
  return "review";
}

function parsePnuForBuildingHub(pnu: string) {
  if (!/^\d{19}$/.test(pnu)) return null;
  const landFlag = pnu.slice(10, 11);
  const platGbCd = landFlag === "2" ? "1" : "0";
  return {
    sigunguCd: pnu.slice(0, 5),
    bjdongCd: pnu.slice(5, 10),
    platGbCd,
    bun: pnu.slice(11, 15),
    ji: pnu.slice(15, 19),
  };
}

export default function ReportPage() {
  const [snapshot, setSnapshot] = useState<Part1Snapshot>({});
  const [ownership, setOwnership] = useState<OwnershipParcel[]>([]);
  const [landPrices, setLandPrices] = useState<LandPriceParcel[]>([]);
  const [floorData, setFloorData] = useState<FloorParcel[]>([]);
  const [basementAutoApplied, setBasementAutoApplied] = useState(false);
  const [demand, setDemand] = useState<DemandInputs>(emptyDemand);
  const [assumptions, setAssumptions] = useState<FinancialAssumptions>(initialAssumptions);
  const [financeDefaults, setFinanceDefaults] = useState<FinanceDefaults | null>(null);
  const [financeDefaultsError, setFinanceDefaultsError] = useState("");
  const [structurePolicy, setStructurePolicy] = useState<StructurePolicyResponse | null>(null);
  const [rent, setRent] = useState<RentResolverResponse | null>(null);
  const [rentError, setRentError] = useState("");
  const [retailSubtype, setRetailSubtype] = useState("중대형상가");
  const [retailFloors, setRetailFloors] = useState(3);
  const [retailBasementFloors, setRetailBasementFloors] = useState(0);
  const [tradeArea, setTradeArea] = useState("");
  const [housingType, setHousingType] = useState("아파트");
  const [propertyTax, setPropertyTax] = useState<PropertyTaxResponse | null>(null);
  const [housingStat, setHousingStat] = useState<"MEAN" | "MEDIAN">("MEAN");
  // 2026-08-26 확정: 외부 공유용(고객·투자자·지자체)과 내부 관리자 화면을 정식 로그인 기반으로 분리.
  // 로그인하지 않은 상태(기본값)에서는 입력 도구·단가 카드가 CSS(admin-only)로 숨겨지고,
  // 계산 결과(판정 매트릭스 등)만 보인다.
  const [isAdmin, setIsAdmin] = useState(false);
  const [authReady, setAuthReady] = useState(false);

  useEffect(() => {
    let supabase;
    try {
      supabase = getSupabaseBrowserClient();
    } catch {
      // 환경변수 미설정 시에도 화면은 방문자 모드로 정상 동작해야 한다.
      setAuthReady(true);
      return;
    }

    supabase.auth.getSession().then(({ data }) => {
      setIsAdmin(Boolean(data.session));
      setAuthReady(true);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      setIsAdmin(Boolean(session));
    });

    return () => subscription.subscription.unsubscribe();
  }, []);

  async function handleAdminLogout() {
    try {
      await getSupabaseBrowserClient().auth.signOut();
    } catch {
      // 로그인 자체가 구성되지 않은 환경이면 조용히 무시한다.
    }
  }

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem("inrealtylab.part1Snapshot");
      if (raw) setSnapshot(JSON.parse(raw));
    } catch {
      setSnapshot({});
    }

    const params = new URLSearchParams(window.location.search);
    const pnus = [...new Set((params.get("pnus") ?? params.get("pnu") ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter((item) => /^\d{19}$/.test(item)))];

    if (!pnus.length) return;

    Promise.all(
      pnus.map(async (pnu) => {
        try {
          const response = await fetch(`/api/ownership?pnu=${encodeURIComponent(pnu)}`, { cache: "no-store" });
          return { pnu, result: (await response.json()) as OwnershipResponse };
        } catch (error) {
          return { pnu, result: { ok: false, message: error instanceof Error ? error.message : "소유정보 조회 실패" } };
        }
      })
    ).then(setOwnership);

    Promise.all(
      pnus.map(async (pnu) => {
        try {
          const response = await fetch(`/api/land-price?pnu=${encodeURIComponent(pnu)}`, { cache: "no-store" });
          return { pnu, result: (await response.json()) as LandPriceResponse };
        } catch (error) {
          return { pnu, result: { ok: false, message: error instanceof Error ? error.message : "개별공시지가 조회 실패" } };
        }
      })
    ).then(setLandPrices);

    Promise.all(
      pnus.map(async (pnu) => {
        const parsed = parsePnuForBuildingHub(pnu);
        if (!parsed) return { pnu, result: { ok: false, message: "PNU 해석 실패" } as FloorResponse };
        const query = new URLSearchParams(parsed);
        try {
          const response = await fetch(`/api/building-hub/floors?${query.toString()}`, { cache: "no-store" });
          return { pnu, result: (await response.json()) as FloorResponse };
        } catch (error) {
          return { pnu, result: { ok: false, message: error instanceof Error ? error.message : "건축HUB 층별 조회 실패" } };
        }
      })
    ).then(setFloorData);
  }, []);

  const records = useMemo(() => ownership.flatMap((item) => item.result.records ?? []), [ownership]);
  const siteAreaSqm = snapshot.siteAreaSqm ?? (records.length ? records.reduce((sum, row) => sum + (row.areaSqm ?? 0), 0) : null);

  const landPriceByPnu = useMemo(() => new Map(
    landPrices
      .filter((item) => item.result.ok && item.result.pricePerSqm !== null && item.result.pricePerSqm !== undefined)
      .map((item) => [item.pnu, item.result.pricePerSqm as number])
  ), [landPrices]);

  const landPriceYears = useMemo(() => [...new Set(
    landPrices.map((item) => item.result.standardYear).filter((value): value is string => Boolean(value))
  )], [landPrices]);

 const officialLandValue = useMemo(() => {
  if (!landPriceByPnu.size) {
    const usable = records.filter((row) => row.areaSqm !== null && row.officialLandPrice !== null);
    if (!usable.length) return null;
    const unique = new Map<string, OwnershipRecord>();
    for (const row of usable) if (!unique.has(row.pnu)) unique.set(row.pnu, row);
    return [...unique.values()].reduce((sum, row) => sum + (row.areaSqm ?? 0) * (row.officialLandPrice ?? 0), 0);
  }

  const areaByPnu = new Map<string, number>();
  for (const row of records) {
    if (row.areaSqm !== null && row.areaSqm > 0 && !areaByPnu.has(row.pnu)) areaByPnu.set(row.pnu, row.areaSqm);
  }

  let total = 0;
  let matched = 0;
  for (const [pnu, price] of landPriceByPnu) {
    const area = areaByPnu.get(pnu);
    if (area === undefined) continue;
    total += area * price;
    matched += 1;
  }

  // 필지별 면적(ownership API)이 전부 확보된 경우 → 필지별 가중합이 가장 정확하니 그대로 사용
  if (matched === landPriceByPnu.size) return total;

  // 필지별 면적 매칭에 실패했더라도, 조회된 공시지가 단가가 전부 동일하면
  // 통합 대지면적(siteAreaSqm) × 단가로 근사 계산한다.
  // (인접 필지는 같은 법정동/고시구역이면 개별공시지가가 동일한 경우가 흔함)
  const prices = [...landPriceByPnu.values()];
  const allSamePrice = prices.every((p) => p === prices[0]);
  if (allSamePrice && siteAreaSqm !== null) {
    return siteAreaSqm * prices[0];
  }

  return matched ? total : null;
}, [landPriceByPnu, records, siteAreaSqm]);

  const basementReference = useMemo(() => {
    const valid = floorData
      .map((item) => item.result.summary)
      .filter((summary): summary is FloorSummary => Boolean(summary && summary.aboveGroundAreaSqm > 0 && summary.basementRatioPct !== null));
    if (!valid.length) return null;
    const above = valid.reduce((sum, item) => sum + item.aboveGroundAreaSqm, 0);
    const below = valid.reduce((sum, item) => sum + item.basementAreaSqm, 0);
    return {
      ratioPct: above > 0 ? (below / above) * 100 : null,
      basementAreaSqm: below,
      aboveGroundAreaSqm: above,
      sampleCount: valid.length,
    };
  }, [floorData]);

  // STEP 2에서 고른 사업방식·사업주체를 사업구조 정책으로 바꿔 온다.
  // 지금까지 STEP 3은 이 선택과 무관하게 BTO/BOT와 REITs 매트릭스를 늘 함께 보여줬다.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let choice: { landRight?: string; concessionType?: string; vehicle?: string } = {};
      try {
        const raw = sessionStorage.getItem("inrealtylab.step2Structure");
        if (raw) choice = JSON.parse(raw);
      } catch {
        // 선택값을 못 읽으면 기본 구조로 조회한다.
      }
      const query = new URLSearchParams();
      if (choice.landRight) query.set("landRight", choice.landRight);
      if (choice.concessionType) query.set("concessionType", choice.concessionType);
      if (choice.vehicle) query.set("vehicle", choice.vehicle);
      try {
        const response = await fetch(`/api/structure-policy?${query.toString()}`);
        const data = await response.json();
        if (!response.ok || !data.ok) return;
        if (!cancelled) setStructurePolicy(data as StructurePolicyResponse);
      } catch {
        // 조회 실패 시에는 구조 미적용 상태로 예전 계산을 유지한다.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 금리·LTV를 코드 상수가 아니라 DB(part3_finance_benchmark)에서 받아 채운다.
  // 사용자가 이미 손으로 넣은 값은 건드리지 않는다.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/api/underwriting-defaults");
        const data = await response.json();
        if (!response.ok || !data.ok) throw new Error(data?.message ?? "금융 기준값을 불러오지 못했습니다.");
        if (cancelled) return;
        setFinanceDefaults({ defaults: data.defaults, sources: data.sources ?? [], warnings: data.warnings ?? [] });
        setAssumptions((current) => ({
          ...current,
          referenceRatePct: current.referenceRatePct ?? data.defaults.referenceRatePct ?? null,
          pfSpreadPct: current.pfSpreadPct ?? data.defaults.pfSpreadPct ?? null,
          debtRatioPct: current.debtRatioPct ?? data.defaults.debtRatioPct ?? null,
          investorRequiredReturnPct:
            current.investorRequiredReturnPct ?? data.defaults.investorRequiredReturnPct ?? null,
        }));
      } catch (error) {
        if (!cancelled) {
          setFinanceDefaultsError(error instanceof Error ? error.message : "금융 기준값을 불러오지 못했습니다.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const primaryPnu = snapshot.pnus?.[0] ?? ownership[0]?.pnu ?? "";

  // 위치지수는 개별공시지가 구간으로 정해진다. 필지가 여럿이면 면적가중이 정확하지만
  // 지금은 대표 필지(첫 번째) 값을 쓰고 그 사실을 화면에 적는다.
  const representativeLandPricePerSqm = landPriceByPnu.get(primaryPnu)
    ?? (landPriceByPnu.size ? [...landPriceByPnu.values()][0] : null);

  // 건물분 재산세 — 시설을 민간이 소유하는 구조에서만 계산한다.
  useEffect(() => {
    let cancelled = false;
    if (!representativeLandPricePerSqm || !structurePolicy?.policy.propertyTaxApplies) {
      setPropertyTax(null);
      return;
    }
    (async () => {
      const query = new URLSearchParams({
        officialLandPricePerSqm: String(Math.round(representativeLandPricePerSqm)),
        baseYear: "2026",
        useClass: "COMMERCIAL",
        structureCode: "4A",
        structureIndexCode: "4",
        elapsedYears: "0",
      });
      try {
        const response = await fetch(`/api/property-tax?${query.toString()}`, { cache: "no-store" });
        const data = (await response.json()) as PropertyTaxResponse;
        if (!cancelled) setPropertyTax(data);
      } catch {
        if (!cancelled) setPropertyTax(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [representativeLandPricePerSqm, structurePolicy]);

  // 시설별 적용 임대료를 DB에서 받아 sessionStorage에 넣는다.
  // integrated-report.ts의 readFacilityRent가 이 키를 읽는데, 지금까지 아무도 쓰지 않아
  // 모든 시설의 임대료가 0으로 계산됐다(= 매출 0 → DSCR·IRR 산출 불가).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const query = new URLSearchParams();
      if (primaryPnu) query.set("pnu", primaryPnu);
      query.set("retailSubtype", retailSubtype);
      query.set("retailFloors", String(retailFloors));
      query.set("retailBasementFloors", String(retailBasementFloors));
      if (tradeArea) query.set("tradeArea", tradeArea);
      query.set("housingType", housingType);
      query.set("housingStat", housingStat);

      try {
        const response = await fetch(`/api/rent-resolver?${query.toString()}`, { cache: "no-store" });
        const data = await response.json();
        if (!response.ok || !data.ok) throw new Error(data?.message ?? "임대료 자료를 불러오지 못했습니다.");
        if (cancelled) return;

        try {
          for (const facility of data.facilities as RentFacility[]) {
            window.sessionStorage.setItem(
              `inrealtylab.rent.${facility.facilityCode}`,
              String(facility.rentPerSqmMonth)
            );
          }
        } catch {
          // 세션 저장이 막힌 환경에서도 화면의 근거 표시는 그대로 나와야 한다.
        }

        setRentError("");
        setRent(data as RentResolverResponse);
      } catch (error) {
        if (!cancelled) setRentError(error instanceof Error ? error.message : "임대료 자료를 불러오지 못했습니다.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [primaryPnu, retailSubtype, retailFloors, retailBasementFloors, tradeArea, housingType, housingStat]);

  useEffect(() => {
    if (basementAutoApplied || assumptions.basementRatioPct !== null || basementReference?.ratioPct === null || basementReference?.ratioPct === undefined) return;
    setAssumptions((current) => current.basementRatioPct === null
      ? { ...current, basementRatioPct: Number(basementReference.ratioPct?.toFixed(2)) }
      : current);
    setBasementAutoApplied(true);
  }, [basementAutoApplied, assumptions.basementRatioPct, basementReference]);

  const analysis = useMemo(() => buildIntegratedAnalysis({
    siteAreaSqm,
    farMaxPct: snapshot.statutoryFarMaxPct ?? null,
    officialLandValue,
    demand,
    assumptions,
    structure: structurePolicy?.policy ?? null,
    propertyTaxPerSqmYear: propertyTax?.ok ? propertyTax.taxPerSqmYear ?? null : null,
    corporateTaxBrackets: structurePolicy?.corporateTax?.brackets ?? null,
    localIncomeTaxBrackets: structurePolicy?.corporateTax?.localBrackets ?? null,
    // rent는 buildIntegratedAnalysis가 sessionStorage에서 읽는 값이라 인자로 넘기지 않지만,
    // 임대료가 갱신되면 매출·DSCR·IRR이 달라지므로 의존성에 넣어 다시 계산하게 한다.
  }), [siteAreaSqm, snapshot.statutoryFarMaxPct, officialLandValue, demand, assumptions, structurePolicy, rent, propertyTax]);

  const ownershipGate = useMemo(() => {
    if (!ownership.length) return "REVIEW";
    if (ownership.some((item) => !item.result.ok)) return "REVIEW";
    if (records.some((row) => row.ownerSector === "PRIVATE")) return "FAIL";
    if (ownership.every((item) => item.result.assessment?.inScope)) return "PASS";
    return "REVIEW";
  }, [ownership, records]);

  const recommendation = useMemo(() => {
    const rank: Record<string, number> = { BASE: 0, CONSERVATIVE: 1, POSITIVE: 2 };
    const pick = (status: "ELIGIBLE" | "CONDITIONAL") =>
      analysis.financialMatrix
        .filter((cell) => {
          const capacity = analysis.capacities.find((item) => item.key === cell.scenarioKey);
          if (!capacity || capacity.demandFit === "SHORT" || capacity.demandFit === "REVIEW") return false;
          return cell.overallEligibility === status;
        })
        .sort((a, b) => (rank[a.scenarioKey] - rank[b.scenarioKey]) || (a.term - b.term))[0] ?? null;
    // 2026-08-25 확정: IRR·DSCR을 모두 충족하는(가능) 조합을 우선 추천하고,
    // 없으면 조건부 가능 조합을 대신 보여준다(불가 조합만 있는 경우는 추천하지 않음).
    return pick("ELIGIBLE") ?? pick("CONDITIONAL");
  }, [analysis]);

  const finalDecision = ownershipGate === "FAIL"
    ? { status: "FAIL", title: "사업추진 대상 제외", text: "민간소유가 포함되어 현재 공공부지 PPP 검토대상에서 제외됩니다." }
    : ownershipGate !== "PASS"
      ? { status: "REVIEW", title: "소유·협의구조 확인 필요", text: "공공소유 및 재산관리·의사결정권자 확인 후 후속 판단이 가능합니다." }
      : analysis.fullDemandGfa === null
        ? { status: "REVIEW", title: "수요 DB 연결 필요", text: "공공시설과 수익시설의 필요 연면적이 채워지면 면적 적합성을 판정합니다." }
        : recommendation
          ? recommendation.overallEligibility === "ELIGIBLE"
            ? { status: "PASS", title: "사업추진 검토 가능", text: `${recommendation.scenarioLabel} 개발안 / ${recommendation.term}년 조합이 수요 적합성과 목표수익률·DSCR 기준을 모두 충족합니다.` }
            : { status: "CONDITIONAL", title: "조건부 사업추진 검토", text: `${recommendation.scenarioLabel} 개발안 / ${recommendation.term}년 조합이 목표수익률 또는 DSCR 기준에 근접했으나 완전히 충족하지는 못했습니다. 용적률 인센티브·임대료·금리 조정 등 조건 조정 검토가 필요합니다.` }
          : { status: "REVIEW", title: "조건 조정 필요", text: "현재 입력조건에서는 수요와 금융기준을 동시에 충족하는 조합이 없습니다." };

  const address = records[0] ? `${records[0].legalDong} ${records[0].jibun}`.trim() : "선택 대지";
  const parcelCount = snapshot.pnus?.length ?? ownership.length;

  function setAssumption(key: keyof FinancialAssumptions, value: string | number) {
    const numeric = typeof value === "number" ? value : parseNumber(value);
    if (key === "basementRatioPct") setBasementAutoApplied(true);
    setAssumptions((current) => ({ ...current, [key]: numeric }));
  }

  // 상가 유형을 바꾸면 임대료 표본이 바뀌므로 층수 기본값도 그 표본 정의에 맞춘다.
  function changeRetailSubtype(code: string) {
    const preset = RETAIL_SUBTYPES.find((item) => item.code === code);
    setRetailSubtype(code);
    if (preset) setRetailFloors(preset.defaultFloors);
    setTradeArea("");
  }

  function setCommercial(key: CommercialCategoryKey, value: string) {
    setDemand((current) => ({
      ...current,
      commercialSupportableGfa: { ...current.commercialSupportableGfa, [key]: parseNumber(value) },
    }));
  }

  return (
    <main className={`report-shell${isAdmin ? " is-admin" : ""}`}>
      <div className="report-toolbar no-print">
        <div><strong>인리얼티 통합 검토보고서</strong><div className="report-source">현황분석 → 시설구성 → 사업성 판정{isAdmin ? " · 관리자 모드" : ""}</div></div>
        <div className="report-toolbar-actions">
          <button className="report-btn" onClick={() => window.history.back()}>이전</button>
          <button className="report-btn primary" onClick={() => window.print()}>인쇄 / PDF</button>
          {authReady && (isAdmin
            ? <button className="report-btn" onClick={handleAdminLogout}>로그아웃</button>
            : <button
                className="report-btn"
                onClick={() => {
                  window.location.href = `/login?redirect=${encodeURIComponent(window.location.pathname + window.location.search)}`;
                }}
              >
                관리자 로그인
              </button>)}
        </div>
      </div>

      <section className="report-page">
        <div className="report-kicker">01 · 대지 조건</div>
        <h1 className="report-title">{address} 사업추진 약식검토</h1>
        <p className="report-subtitle">위치·대지현황 · 소유와 협의대상 · 법적 개발가능 규모</p>
        <div className="report-grid">
          <div className="report-map-placeholder"><div><strong>선택 필지 지도영역</strong><span>선택 필지 {parcelCount || "-"}개</span></div></div>
          <div className="report-card"><h3>대지 개요</h3>
            <Metric label="대지면적" value={formatGfa(siteAreaSqm)} />
            <Metric label="용도지역" value={snapshot.primaryZone ?? "확인 필요"} />
            <Metric label="건폐율 상한" value={formatPercent(snapshot.statutoryBcrMaxPct ?? null)} />
            <Metric label="용적률 상한" value={formatPercent(snapshot.statutoryFarMaxPct ?? null)} />
            <Metric label={`공시지가 기준 토지가치${landPriceYears.length ? ` (${landPriceYears.join("/")}년)` : ""}`} value={formatWon(officialLandValue)} />
            <Metric label="연 토지사용료 5%" value={formatWon(analysis.annualLandFee)} />
            <div className="report-source" style={{ marginTop: 8 }}>
              {landPriceByPnu.size ? "국토교통부 개별공시지가정보 자동조회" : "공시지가 자동조회값 없음 — 확인 필요"}
            </div>
          </div>
        </div>
        <div className="report-grid">
          <div className="report-card"><h3>소유권 판정</h3><Metric label="판정" value={statusLabel(ownershipGate)} />{records.map((row, i) => <div className="report-owner-row" key={`${row.pnu}-${i}`}><strong>{row.ownerTypeLabel} · {row.ownerClass}</strong><span>{row.legalDong} {row.jibun}</span></div>)}</div>
          <div className="report-card"><h3>협의대상자</h3><p>1차 · 토지 소유기관</p><p>2차 · 재산관리관·관리권자·운영주체</p><p>3차 · 관리·처분·개발 의사결정권자</p><div className="report-warning">공개 소유정보로 실제 기관명·재산관리관이 확정되지 않으면 “확인 필요”로 유지합니다.</div></div>
        </div>
        <div className="report-section"><div className="report-section-head"><div><span>법적 검토</span><br /><strong>법적 개발가능 규모와 공사비</strong></div></div>
          <table className="report-table"><thead><tr><th>구분</th>{DEVELOPMENT_SCENARIOS.map((s) => <th key={s.key}>{s.label}</th>)}</tr></thead><tbody>
            <tr><td className="left">지상 연면적</td>{analysis.capacities.map((c) => <td key={c.key}>{formatGfa(c.aboveGroundGfa || null)}</td>)}</tr>
            <tr><td className="left">지하 연면적</td>{analysis.capacities.map((c) => <td key={c.key}>{formatGfa(c.undergroundGfa)}</td>)}</tr>
            <tr><td className="left">총 연면적</td>{analysis.capacities.map((c) => <td key={c.key}>{formatGfa(c.totalConstructionGfa)}</td>)}</tr>
            <tr><td className="left">공사비</td>{analysis.capacities.map((c) => <td key={c.key}>{formatWon(c.constructionCapex)}</td>)}</tr>
            {analysis.capacities.some((c) => c.trustFee !== null) && (
              <tr><td className="left">신탁보수</td>{analysis.capacities.map((c) => <td key={c.key}>{formatWon(c.trustFee)}</td>)}</tr>
            )}
            {propertyTax?.ok && propertyTax.taxPerSqmYear && (
              <tr><td className="left">건물분 재산세 (연)</td>{analysis.capacities.map((c) => <td key={c.key}>{formatWon(c.totalConstructionGfa === null ? null : c.totalConstructionGfa * (propertyTax.taxPerSqmYear ?? 0))}</td>)}</tr>
            )}
          </tbody></table>
          <div className="report-note" style={{ marginTop: 10 }}>
            {basementReference?.ratioPct !== null && basementReference?.ratioPct !== undefined
              ? `지하 연면적은 건축HUB 층별개요의 기존 건축물 참고비율 ${basementReference.ratioPct.toFixed(1)}%를 초기값으로 적용했습니다. 미래 계획 지하규모의 확정값이 아니며 직접 수정할 수 있습니다.`
              : "건축HUB에서 유효한 지상·지하 층별 면적을 찾지 못해 지하 비율은 자동 추정하지 않았습니다."}
          </div>
        </div>
        <div className="report-page-number">1 / 3</div>
      </section>

      <section className="report-page">
        <div className="report-kicker">02 · 시설 구성</div>
        <h2 className="report-title">수요시설과 적용 임대료</h2>
        <p className="report-subtitle">시설별 수요면적 · 위치에 맞춘 임대료 근거 · 개발규모별 공사비</p>
        <div className="report-section no-print admin-only"><div className="report-section-head"><div><span>DEMAND ENGINE</span><br /><strong>시설별 연면적 DB 연결 슬롯</strong></div></div>
          <div className="report-demand-grid"><Field label="공공시설 필요면적 ㎡" value={demand.publicRequiredGfa} onChange={(v) => setDemand((c) => ({ ...c, publicRequiredGfa: parseNumber(v) }))} />{COMMERCIAL_CATEGORIES.map((item) => <Field key={item.key} label={`${item.label} ㎡`} value={demand.commercialSupportableGfa[item.key] ?? null} onChange={(v) => setCommercial(item.key, v)} />)}</div>
        </div>
        <div className="report-section"><div className="report-section-head"><div><span>임대료</span><br /><strong>시설별 적용 임대료</strong></div><span className="report-source">{rent?.retail?.baseDate ?? ""}</span></div>
          <div className="report-form-grid no-print admin-only">
            <div className="report-field">
              <label>상가 유형</label>
              <select value={retailSubtype} onChange={(e) => changeRetailSubtype(e.target.value)}>
                {RETAIL_SUBTYPES.map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}
              </select>
            </div>
            <div className="report-field">
              <label>상권</label>
              <select value={tradeArea} onChange={(e) => setTradeArea(e.target.value)}>
                <option value="">권역 평균 (상권 미지정)</option>
                {(rent?.retail?.tradeAreaOptions ?? []).map((item) => (
                  <option key={item.name} value={item.name}>
                    {item.name} · {item.rentPerSqmMonth.toLocaleString()}원
                  </option>
                ))}
              </select>
            </div>
            <Field label="상가 지상 층수" value={retailFloors} onChange={(v) => setRetailFloors(Math.max(1, parseNumber(v) ?? 1))} />
            <Field label="상가 지하 층수" value={retailBasementFloors} onChange={(v) => setRetailBasementFloors(Math.max(0, parseNumber(v) ?? 0))} />
            <div className="report-field">
              <label>주거 유형</label>
              <select value={housingType} onChange={(e) => setHousingType(e.target.value)}>
                {HOUSING_TYPES.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </div>
            <div className="report-field">
              <label>주거 통계 기준</label>
              <select value={housingStat} onChange={(e) => setHousingStat(e.target.value === "MEDIAN" ? "MEDIAN" : "MEAN")}>
                <option value="MEAN">평균</option>
                <option value="MEDIAN">중위</option>
              </select>
            </div>
          </div>

          {rentError && <div className="report-warning">{rentError}</div>}

          {rent && (
            <>
              <table className="report-table"><thead><tr><th>시설</th><th>적용 임대료 원/㎡·월</th><th>지역</th><th>출처</th></tr></thead><tbody>
                {rent.facilities.map((facility) => (
                  <tr key={facility.facilityCode}>
                    <td className="left">{facilityLabel(facility.facilityCode)}</td>
                    <td>{facility.rentPerSqmMonth.toLocaleString()}</td>
                    <td>{regionLabel(facility.geography)}</td>
                    <td className="left">
                      {facility.rentKind === "DERIVED" || !facility.source
                        ? INTERNAL_SOURCE_LABEL
                        : facility.source}
                      {facility.baseDate ? ` (${facility.baseDate})` : ""}
                    </td>
                  </tr>
                ))}
              </tbody></table>

              {rent.retail && (
                <div className="report-note no-print admin-only" style={{ marginTop: 10 }}>
                  <strong>리테일 환산 근거</strong> — {rent.retail.geographyName} {rent.retail.subtype} 1층 기준{" "}
                  {rent.retail.firstFloorRentPerSqmMonth.toLocaleString()}원/㎡·월
                  {rent.retail.floorRatio
                    ? ` × 층별효용비율 ${rent.retail.floorRatio.ratioPct}% (지상 ${rent.retail.floors.aboveGround}층·지하 ${rent.retail.floors.basement}층 기준) = ${rent.retail.blendedRentPerSqmMonth?.toLocaleString()}원/㎡·월`
                    : ""}
                  <div className="report-source" style={{ marginTop: 6 }}>
                    매칭 근거 {rent.retail.matchBasis}
                    {rent.retail.floorRatio ? ` · 효용비율 ${rent.retail.floorRatio.geography} 기준` : ""}
                    {rent.retail.source ? ` · ${rent.retail.source}` : ""}
                  </div>
                  {[...rent.retail.notes, ...(rent.retail.floorRatio?.notes ?? [])].map((note) => (
                    <p key={note} style={{ margin: "6px 0 0" }}>{note}</p>
                  ))}
                </div>
              )}

              {rent.housing && (
                <div className="report-note no-print admin-only" style={{ marginTop: 10 }}>
                  <strong>주거 환산 근거</strong> — {rent.housing.geographyName} {rent.housing.housingType}{" "}
                  {rent.housing.statKind === "MEAN" ? "평균" : "중위"} ㎡당 전세가격{" "}
                  {rent.housing.jeonsePerSqmKrw.toLocaleString()}원 × 전월세전환율 {rent.housing.conversionRatePct}% ÷ 12 ={" "}
                  <strong>{rent.housing.rentPerSqmMonthExclusive.toLocaleString()}원/㎡·월</strong> ({rent.housing.areaBasis} 기준)
                  <div className="report-source" style={{ marginTop: 6 }}>
                    매칭 근거 {rent.housing.matchBasis} · 전환율 출처 {rent.housing.rateSource}
                    {rent.housing.report ? ` · ${rent.housing.report}` : ""}
                    {rent.housing.sourcePage ? ` ${rent.housing.sourcePage}` : ""} ({rent.housing.baseMonth})
                    {" · 호당 환산 "}{Math.round(rent.housing.rentKrwUnitMonth / 10000).toLocaleString()}만원/월
                  </div>
                  <p style={{ margin: "6px 0 0" }}>
                    전용면적 기준 값입니다. 연면적 환산은 시설 효율(주거 0.70)이 이미 적용하므로 다시 곱하지 않습니다.
                  </p>
                  {rent.housing.notes.map((note) => (
                    <p key={note} style={{ margin: "6px 0 0" }}>{note}</p>
                  ))}
                </div>
              )}

              {rent.missing.length > 0 && (
                <div className="report-warning no-print admin-only" style={{ marginTop: 10 }}>
                  임대료 미보유 — {rent.missing.map(facilityLabel).join(" · ")} (매출 0)
                </div>
              )}

              <div className="report-source" style={{ marginTop: 8 }}>
                {[
                  rent.retail ? "한국부동산원 상업용부동산 임대동향조사" : null,
                  rent.housing ? "한국부동산원 전국주택가격동향조사" : null,
                  rent.facilities.some((item) => item.rentKind === "DERIVED") ? INTERNAL_SOURCE_LABEL : null,
                ]
                  .filter((item): item is string => item !== null)
                  .join(" · ")}
              </div>
            </>
          )}
        </div>

        <div className="report-section"><div className="report-section-head"><div><span>수요 적합성</span><br /><strong>개발가능 면적과 수요시설 면적</strong></div></div>
          <table className="report-table"><thead><tr><th>개발안</th><th>지상 연면적</th><th>수요 연면적</th><th>차이</th><th>판정</th></tr></thead><tbody>{analysis.capacities.map((c) => <tr key={c.key}><td>{c.label}</td><td>{formatGfa(c.aboveGroundGfa || null)}</td><td>{formatGfa(c.fullDemandGfa)}</td><td>{c.demandGapGfa === null ? "-" : `${c.demandGapGfa >= 0 ? "+" : ""}${formatGfa(c.demandGapGfa)}`}</td><td><span className={`report-status ${statusTone(c.demandFit)}`}>{statusLabel(c.demandFit)}</span></td></tr>)}</tbody></table>
        </div>
        <div className="report-page-number">2 / 3</div>
      </section>

      <section className="report-page">
        <div className="report-kicker">03 · 사업성 판정</div>
        <h2 className="report-title">사업성 매트릭스와 추진여부</h2>
        <p className="report-subtitle">토지매입비 0 · 공시지가 기준 연 5% 사용료 · 30/40/50년 · 종료 후 기부채납</p>
        <div className="report-section no-print admin-only"><div className="report-section-head"><div><span>ASSUMPTIONS</span><br /><strong>사업비·운영·금융 입력</strong></div></div>
          <div className="report-form-grid">
            <Field label="지하/지상 비율 %" value={assumptions.basementRatioPct} onChange={(v) => setAssumption("basementRatioPct", v)} />
            <Field label="표준공사비 원/㎡" value={assumptions.constructionCostPerSqm} onChange={(v) => setAssumption("constructionCostPerSqm", v)} />
            <Field label="시장 임대료 원/㎡·월" value={assumptions.monthlyRentPerSqm} onChange={(v) => setAssumption("monthlyRentPerSqm", v)} />
            <Field label="OPEX / 매출 %" value={assumptions.opexPct} onChange={(v) => setAssumption("opexPct", v)} />
            <Field label="시장 기준금리 %" value={assumptions.referenceRatePct} onChange={(v) => setAssumption("referenceRatePct", v)} />
            <Field label="PF Spread %" value={assumptions.pfSpreadPct} onChange={(v) => setAssumption("pfSpreadPct", v)} />
            <Field label="Debt Ratio %" value={assumptions.debtRatioPct} onChange={(v) => setAssumption("debtRatioPct", v)} />
            <Field label="Debt Tenor 년" value={assumptions.debtTenorYears} onChange={(v) => setAssumption("debtTenorYears", v)} />
            <Field label="출자자 요구수익률 %" value={assumptions.investorRequiredReturnPct} onChange={(v) => setAssumption("investorRequiredReturnPct", v)} />
          </div>
          <div className="report-field" style={{ marginTop: 12 }}><label>가동률 {assumptions.occupancyPct}% · 80~95%, 1% 단위</label><input type="range" min={80} max={95} step={1} value={assumptions.occupancyPct} onChange={(e) => setAssumption("occupancyPct", Number(e.target.value))} /></div>

          {financeDefaultsError && <div className="report-warning">{financeDefaultsError}</div>}
          {financeDefaults && (
            <div className="report-note" style={{ marginTop: 12 }}>
              <strong>금융 가정 출처</strong>
              <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                {financeDefaults.sources.map((source) => (
                  <li key={source.metricCode}>
                    {source.metricCode} {source.value ?? "-"}
                    {source.unit === "pct" || source.unit === "%" ? "%" : ""}
                    {source.range.low !== null && source.range.high !== null
                      ? ` (범위 ${source.range.low}~${source.range.high})`
                      : ""}
                    {" — "}
                    {source.publisher ?? "출처 미상"}
                    {source.reportName ? `, ${source.reportName}` : ""}
                    {source.baseDate ? ` (${source.baseDate})` : ""}
                    {source.note ? ` · ${source.note}` : ""}
                  </li>
                ))}
              </ul>
              {financeDefaults.warnings.map((warning) => (
                <p key={warning} style={{ margin: "8px 0 0" }}>{warning}</p>
              ))}
            </div>
          )}

          <div className="report-note" style={{ marginTop: 10 }}>
            <strong>판정에 실제로 쓰인 값</strong> — 대출금리 {analysis.financeBasis.appliedRatePct.toFixed(2)}%
            ({basisLabel(analysis.financeBasis.rateBasis)}) · 차입비율 {analysis.financeBasis.ltcPct}%
            ({basisLabel(analysis.financeBasis.ltcBasis)})
            {(analysis.financeBasis.rateBasis === "FALLBACK" || analysis.financeBasis.ltcBasis === "FALLBACK") && (
              <> — 출처가 없는 최후 기본값이 섞여 있습니다. 대외 자료로 쓰기 전에 조달 조건을 확정해 주세요.</>
            )}
          </div>
        </div>
        <div className="report-grid three">
          <div className="report-card"><h3>토지</h3>
            <Metric label="토지가치" value={formatWon(officialLandValue)} />
            <Metric label="연 사용료 5%" value={formatWon(analysis.annualLandFee)} />
          </div>
          <div className="report-card"><h3>사업구조</h3>
            <Metric label="구조" value={structurePolicy?.policy.structureName ?? "미선택"} />
            <Metric label="시설 소유" value={ownershipLabel(structurePolicy?.policy.ownershipDuringOperation)} />
            <Metric label="시설분 재산세" value={structurePolicy?.policy.propertyTaxApplies ? "부담" : "없음"} />
            {structurePolicy?.trustFee && (
              <Metric label="신탁보수" value={`건설비 × ${structurePolicy.trustFee.ratePct}%`} />
            )}
            {structurePolicy?.corporateTax && (
              <Metric
                label="법인세"
                value={structurePolicy.corporateTax.exempt ? "면세 (배당소득공제)" : "누진세율 + 지방소득세"}
              />
            )}
          </div>
          <div className="report-card"><h3>판정 기준</h3>
            <Metric label="부채상환비율" value={`≥ ${analysis.dscrPassMin.toFixed(2)}`} />
            <Metric label="사업수익률" value="≥ 6.5%" />
            <Metric label="잔존가 처리" value={structurePolicy?.policy.terminalValuePolicy === "EXIT_VALUE" ? "Exit Value" : "0 (귀속·반환)"} />
          </div>
        </div>
        {structurePolicy && (
          <div className="report-source" style={{ marginTop: -6, marginBottom: 12 }}>
            구조 선택 경로 — {structurePolicy.resolved.reason}
            {structurePolicy.trustFee && <> · 신탁보수 근거 — {structurePolicy.trustFee.basis}</>}
          </div>
        )}
        {structurePolicy && structurePolicy.taxNotes?.length > 0 && (
          <div className="report-note no-print admin-only" style={{ marginTop: 0, marginBottom: 12 }}>
            <strong>보유세 취급</strong>
            {propertyTax?.ok && propertyTax.formula && (
              <p style={{ margin: "6px 0 0" }}>
                건물분 재산세 <strong>{(propertyTax.taxPerSqmYear ?? 0).toLocaleString()}원/㎡·년</strong> — {propertyTax.formula}
                {propertyTax.basis?.locationBand ? ` (위치지수 구간: ${propertyTax.basis.locationBand})` : ""}
              </p>
            )}
            {propertyTax && !propertyTax.ok && propertyTax.message && (
              <p style={{ margin: "6px 0 0" }}>건물분 재산세 미산출 — {propertyTax.message}</p>
            )}
            {structurePolicy?.corporateTax && (
              <p style={{ margin: "6px 0 0" }}>
                법인세 — {structurePolicy.corporateTax.basis}
                {structurePolicy.corporateTax.statuteRef ? ` (${structurePolicy.corporateTax.statuteRef})` : ""}
                {!structurePolicy.corporateTax.exempt && (
                  <> 감가상각과 이자 손금을 반영하지 않은 보수적 근사입니다 — 실제 세부담은 이보다 낮아질 수 있습니다.</>
                )}
              </p>
            )}
            <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
              {structurePolicy.taxNotes.map((note) => <li key={note}>{note}</li>)}
            </ul>
          </div>
        )}

        <div className="report-section"><div className="report-section-head"><div><span>{structurePolicy?.policy.structureGroup === "REIT" ? "참고" : "적용"}</span><br /><strong>부채상환비율 (DSCR)</strong></div><span className="report-source">가능 ≥ {analysis.dscrPassMin.toFixed(2)} · 조건부 1.00 이상</span></div><Matrix mode="BTO" analysis={analysis} /></div>
        <div className="report-section"><div className="report-section-head"><div><span>{structurePolicy?.policy.structureGroup === "REIT" ? "적용" : "참고"}</span><br /><strong>사업수익률 (IRR)</strong></div><span className="report-source">가능 ≥ 6.5% · 조건부 4.50% 이상{assumptions.investorRequiredReturnPct ? ` · 출자자 요구 ${assumptions.investorRequiredReturnPct}%` : ""}</span></div><Matrix mode="REITS" analysis={analysis} /></div>

        {structurePolicy && structurePolicy.unmodelled.length > 0 && (
          <div className="report-warning">
            <strong>아직 현금흐름에 반영되지 않은 항목</strong>
            <ul className="unresolved-list" style={{ marginTop: 8 }}>
              {structurePolicy.unmodelled.map((item) => <li key={item}>{item}</li>)}
            </ul>
          </div>
        )}
        <div className="report-section report-verdict"><span className={`report-status ${statusTone(finalDecision.status)}`}>{statusLabel(finalDecision.status)}</span><strong>{finalDecision.title}</strong><p>{finalDecision.text}</p>{recommendation && <p><b>우선 검토:</b> {recommendation.scenarioLabel} / {recommendation.term}년 · 부채상환비율 {statusLabel(recommendation.btoBotStatus)} · 사업수익률 {statusLabel(recommendation.reitsStatus)}</p>}</div>
        <div className="report-source" style={{ marginTop: 12 }}>실제 자금조달 가능 여부는 개별 금융기관 약정으로 확정됩니다. 사업수익률 기준 6.5%는 인리얼티 내부 판정기준이며, 부채상환비율과 사업수익률 중 하나라도 조건부·불가이면 종합판정도 그에 따릅니다.</div>
        <div className="report-page-number">3 / 3</div>
      </section>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="report-metric"><span>{label}</span><strong>{value}</strong></div>;
}

function Field({ label, value, onChange }: { label: string; value: number | null; onChange: (value: string) => void }) {
  return <div className="report-field"><label>{label}</label><input inputMode="decimal" value={value ?? ""} onChange={(e) => onChange(e.target.value)} placeholder="자동연결 / 직접입력" /></div>;
}

function Matrix({ mode, analysis }: { mode: "BTO" | "REITS"; analysis: ReturnType<typeof buildIntegratedAnalysis> }) {
  return <table className="report-table"><thead><tr><th>개발규모</th>{CONCESSION_TERMS.map((term) => <th key={term}>{term}년</th>)}</tr></thead><tbody>{DEVELOPMENT_SCENARIOS.map((scenario) => <tr key={scenario.key}><td>{scenario.label}</td>{CONCESSION_TERMS.map((term) => { const cell = analysis.financialMatrix.find((item) => item.scenarioKey === scenario.key && item.term === term); if (!cell) return <td key={term}>-</td>; const status = mode === "BTO" ? cell.btoBotStatus : cell.reitsStatus; return <td key={term}><span className="matrix-value">{mode === "BTO" ? (cell.dscr?.toFixed(2) ?? "-") : irrText(cell.projectIrr)}</span><span className={`report-status ${statusTone(status)}`}>{statusLabel(status)}</span>{mode === "REITS" && cell.investorReturnSatisfied !== null && <div className="matrix-sub">출자자 {cell.investorReturnSatisfied ? "충족" : "미충족"}</div>}</td>; })}</tr>)}</tbody></table>;
}
