import { NextRequest, NextResponse } from "next/server";
import {
  SAMPLE_FACILITY_STANDARDS,
  calculateFacilityPortfolio,
  type FacilityDemandInput,
  type FacilityStandard,
} from "@/lib/facility-demand";

type RequestBody = {
  standards?: FacilityStandard[];
  inputs?: Record<string, FacilityDemandInput>;
};

const sampleInputs: Record<string, FacilityDemandInput> = {
  PUBLIC_LIBRARY: {
    targetDemand: 30000,
    coveredDemand: 19500,
  },
  NEIGHBORHOOD_PARK: {
    targetDemand: 25000,
    existingArea: 62000,
  },
  PUBLIC_PARKING: {
    targetDemand: 9200,
    existingCapacity: 980,
  },
  SENIOR_DAYCARE: {
    targetDemand: 8420,
    existingCapacity: 260,
  },
};

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as RequestBody;
  const standards = body.standards?.length
    ? body.standards
    : SAMPLE_FACILITY_STANDARDS;
  const inputs = body.inputs ?? sampleInputs;

  const portfolio = calculateFacilityPortfolio(standards, inputs);

  return NextResponse.json({
    ok: true,
    module: "PART3_DEMAND_TO_FACILITY_NEED",
    calculationMethods: ["ACCESS", "RATIO", "AREA", "CAPACITY"],
    dataMode: body.inputs ? "REQUEST" : "SAMPLE",
    ...portfolio,
  });
}
