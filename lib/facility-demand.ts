export type FacilityClass = "P-NR" | "P-R";
export type CalcMethod = "ACCESS" | "RATIO" | "AREA" | "CAPACITY";
export type NeedLevel = "VERY_LOW" | "LOW" | "MEDIUM" | "HIGH" | "VERY_HIGH";

export type FacilityStandard = {
  facilityId: string;
  facilityName: string;
  facilityClass: FacilityClass;
  sector: string;
  calcMethod: CalcMethod;
  demandVariable: string;
  accessMinutes?: number;
  demandPerUnit?: number;
  areaPerDemand?: number;
  participationRate?: number;
  targetUtilization?: number;
  capacityPerUnit?: number;
  areaPerCapacity?: number;
  netEfficiency?: number;
  smartInfra?: boolean;
  seniorFacility?: boolean;
};

export type FacilityDemandInput = {
  targetDemand: number;
  coveredDemand?: number;
  existingUnits?: number;
  existingCapacity?: number;
  existingArea?: number;
};

export type FacilityNeedResult = {
  facilityId: string;
  facilityName: string;
  facilityClass: FacilityClass;
  sector: string;
  calcMethod: CalcMethod;
  targetDemand: number;
  effectiveDemand: number;
  existingSupply: number;
  coveredDemand: number;
  unservedDemand: number;
  coverageRate: number;
  requiredUnits: number;
  unitDeficit: number;
  requiredCapacity: number;
  capacityDeficit: number;
  requiredArea: number;
  areaDeficit: number;
  requiredNfa: number;
  requiredGfa: number;
  needScore: number;
  needLevel: NeedLevel;
  smartInfra: boolean;
  seniorFacility: boolean;
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function safe(value: number | undefined) {
  return Number.isFinite(value) ? Number(value) : 0;
}

function getNeedLevel(score: number): NeedLevel {
  if (score >= 80) return "VERY_HIGH";
  if (score >= 60) return "HIGH";
  if (score >= 40) return "MEDIUM";
  if (score >= 20) return "LOW";
  return "VERY_LOW";
}

export function calculateFacilityNeed(
  standard: FacilityStandard,
  input: FacilityDemandInput
): FacilityNeedResult {
  const targetDemand = Math.max(0, safe(input.targetDemand));
  const participationRate = clamp(standard.participationRate ?? 1, 0, 1);
  const effectiveDemand = targetDemand * participationRate;
  const coveredDemand = clamp(safe(input.coveredDemand), 0, targetDemand);
  const existingUnits = Math.max(0, safe(input.existingUnits));
  const existingCapacity = Math.max(0, safe(input.existingCapacity));
  const existingArea = Math.max(0, safe(input.existingArea));
  const netEfficiency = clamp(standard.netEfficiency ?? 0.7, 0.1, 1);

  let unservedDemand = Math.max(0, targetDemand - coveredDemand);
  let coverageRate = targetDemand > 0 ? coveredDemand / targetDemand : 1;
  let requiredUnits = 0;
  let unitDeficit = 0;
  let requiredCapacity = 0;
  let capacityDeficit = 0;
  let requiredArea = 0;
  let areaDeficit = 0;
  let requiredNfa = 0;

  switch (standard.calcMethod) {
    case "ACCESS": {
      requiredCapacity = unservedDemand;
      capacityDeficit = unservedDemand;
      if ((standard.capacityPerUnit ?? 0) > 0) {
        requiredUnits = Math.ceil(unservedDemand / Number(standard.capacityPerUnit));
        unitDeficit = requiredUnits;
      }
      if ((standard.areaPerCapacity ?? 0) > 0) {
        requiredNfa = unservedDemand * Number(standard.areaPerCapacity);
      }
      break;
    }

    case "RATIO": {
      const demandPerUnit = Math.max(1, safe(standard.demandPerUnit));
      requiredUnits = Math.ceil(effectiveDemand / demandPerUnit);
      unitDeficit = Math.max(0, requiredUnits - existingUnits);
      requiredCapacity = requiredUnits * demandPerUnit;
      capacityDeficit = unitDeficit * demandPerUnit;
      if ((standard.areaPerCapacity ?? 0) > 0) {
        requiredNfa = capacityDeficit * Number(standard.areaPerCapacity);
      }
      unservedDemand = capacityDeficit;
      coverageRate = requiredUnits > 0 ? clamp(existingUnits / requiredUnits, 0, 1) : 1;
      break;
    }

    case "AREA": {
      requiredArea = effectiveDemand * Math.max(0, safe(standard.areaPerDemand));
      areaDeficit = Math.max(0, requiredArea - existingArea);
      requiredNfa = areaDeficit;
      unservedDemand = requiredArea > 0 ? areaDeficit : 0;
      coverageRate = requiredArea > 0 ? clamp(existingArea / requiredArea, 0, 1) : 1;
      break;
    }

    case "CAPACITY": {
      const targetUtilization = clamp(standard.targetUtilization ?? 0.85, 0.01, 1);
      requiredCapacity = effectiveDemand / targetUtilization;
      capacityDeficit = Math.max(0, requiredCapacity - existingCapacity);
      if ((standard.capacityPerUnit ?? 0) > 0) {
        requiredUnits = Math.ceil(requiredCapacity / Number(standard.capacityPerUnit));
        const existingEquivalentUnits = Math.floor(
          existingCapacity / Number(standard.capacityPerUnit)
        );
        unitDeficit = Math.max(0, requiredUnits - existingEquivalentUnits);
      }
      if ((standard.areaPerCapacity ?? 0) > 0) {
        requiredNfa = capacityDeficit * Number(standard.areaPerCapacity);
      }
      unservedDemand = capacityDeficit;
      coverageRate = requiredCapacity > 0 ? clamp(existingCapacity / requiredCapacity, 0, 1) : 1;
      break;
    }
  }

  const requiredGfa = requiredNfa > 0 ? requiredNfa / netEfficiency : 0;
  const deficitRate = clamp(1 - coverageRate, 0, 1);
  const needScore = Math.round(deficitRate * 100);

  return {
    facilityId: standard.facilityId,
    facilityName: standard.facilityName,
    facilityClass: standard.facilityClass,
    sector: standard.sector,
    calcMethod: standard.calcMethod,
    targetDemand,
    effectiveDemand,
    existingSupply:
      standard.calcMethod === "AREA"
        ? existingArea
        : standard.calcMethod === "RATIO"
        ? existingUnits
        : existingCapacity,
    coveredDemand,
    unservedDemand,
    coverageRate,
    requiredUnits,
    unitDeficit,
    requiredCapacity,
    capacityDeficit,
    requiredArea,
    areaDeficit,
    requiredNfa,
    requiredGfa,
    needScore,
    needLevel: getNeedLevel(needScore),
    smartInfra: Boolean(standard.smartInfra),
    seniorFacility: Boolean(standard.seniorFacility),
  };
}

export function calculateFacilityPortfolio(
  standards: FacilityStandard[],
  inputs: Record<string, FacilityDemandInput>
) {
  const results = standards.map((standard) =>
    calculateFacilityNeed(standard, inputs[standard.facilityId] ?? { targetDemand: 0 })
  );

  return {
    results,
    summary: {
      facilityCount: results.length,
      highNeedCount: results.filter((r) => r.needScore >= 60).length,
      totalRequiredGfa: results.reduce((sum, r) => sum + r.requiredGfa, 0),
      publicNonRevenueGfa: results
        .filter((r) => r.facilityClass === "P-NR")
        .reduce((sum, r) => sum + r.requiredGfa, 0),
      publicRevenueGfa: results
        .filter((r) => r.facilityClass === "P-R")
        .reduce((sum, r) => sum + r.requiredGfa, 0),
    },
  };
}

export const SAMPLE_FACILITY_STANDARDS: FacilityStandard[] = [
  {
    facilityId: "PUBLIC_LIBRARY",
    facilityName: "공공도서관",
    facilityClass: "P-NR",
    sector: "CULTURE",
    calcMethod: "ACCESS",
    demandVariable: "population_total",
    accessMinutes: 15,
    areaPerCapacity: 0.18,
    netEfficiency: 0.7,
  },
  {
    facilityId: "NEIGHBORHOOD_PARK",
    facilityName: "근린공원",
    facilityClass: "P-NR",
    sector: "PARK_GREEN",
    calcMethod: "AREA",
    demandVariable: "population_total",
    areaPerDemand: 3,
    netEfficiency: 1,
  },
  {
    facilityId: "PUBLIC_PARKING",
    facilityName: "공영주차장",
    facilityClass: "P-R",
    sector: "PARKING",
    calcMethod: "CAPACITY",
    demandVariable: "households",
    participationRate: 0.18,
    targetUtilization: 0.85,
    capacityPerUnit: 120,
    areaPerCapacity: 32,
    netEfficiency: 0.82,
    smartInfra: true,
  },
  {
    facilityId: "SENIOR_DAYCARE",
    facilityName: "시니어 주야간보호시설",
    facilityClass: "P-R",
    sector: "SENIOR",
    calcMethod: "CAPACITY",
    demandVariable: "population_65_plus",
    participationRate: 0.035,
    targetUtilization: 0.85,
    capacityPerUnit: 60,
    areaPerCapacity: 12,
    netEfficiency: 0.72,
    seniorFacility: true,
    smartInfra: true,
  },
];
