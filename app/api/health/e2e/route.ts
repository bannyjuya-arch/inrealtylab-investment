import { NextResponse } from "next/server";
import { supabasePublicConfig, supabasePublicHeaders } from "../../lib/supabase-public";
import { fetchPublicDataXml, publicDataServiceKey } from "../../lib/public-data";

const TEST_PNU = "1120010500104050045";

type Check = {
  name: string;
  ok: boolean;
  status: number | null;
  detail: string;
};

async function checkJson(name: string, url: string, init?: RequestInit): Promise<Check> {
  try {
    const response = await fetch(url, { ...init, cache: "no-store" });
    const text = await response.text();
    let detail = text.slice(0, 240);
    try {
      const parsed = JSON.parse(text);
      detail = JSON.stringify(parsed).slice(0, 240);
    } catch {}
    return { name, ok: response.ok, status: response.status, detail };
  } catch (error) {
    return {
      name,
      ok: false,
      status: null,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

async function checkLandUseActivity(key: string): Promise<Check> {
  if (!key) return { name: "landuse_activity_catalog", ok: false, status: null, detail: "NO_PUBLIC_DATA_KEY" };
  try {
    const result = await fetchPublicDataXml(
      "https://apis.data.go.kr/1613000/arLandUseInfoService",
      "DTsearchLunCd",
      { pageNo: "1", numOfRows: "1000" },
      key
    );
    return {
      name: "landuse_activity_catalog",
      ok: result.rows.length > 0,
      status: 200,
      detail: `resultCode=${result.resultCode ?? "-"}, rows=${result.rows.length}, totalCount=${result.totalCount}`,
    };
  } catch (error) {
    return {
      name: "landuse_activity_catalog",
      ok: false,
      status: null,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

async function checkBuildingHub(key: string): Promise<Check> {
  if (!key) return { name: "building_hub_floor", ok: false, status: null, detail: "NO_PUBLIC_DATA_KEY" };
  const landFlag = TEST_PNU.slice(10, 11);
  try {
    const result = await fetchPublicDataXml(
      "https://apis.data.go.kr/1613000/BldRgstHubService",
      "getBrFlrOulnInfo",
      {
        sigunguCd: TEST_PNU.slice(0, 5),
        bjdongCd: TEST_PNU.slice(5, 10),
        platGbCd: landFlag === "2" ? "1" : "0",
        bun: TEST_PNU.slice(11, 15).padStart(4, "0"),
        ji: TEST_PNU.slice(15, 19).padStart(4, "0"),
        numOfRows: "1000",
        pageNo: "1",
        _type: "xml",
      },
      key
    );
    return {
      name: "building_hub_floor",
      ok: true,
      status: 200,
      detail: `resultCode=${result.resultCode ?? "-"}, rows=${result.rows.length}, totalCount=${result.totalCount}`,
    };
  } catch (error) {
    return {
      name: "building_hub_floor",
      ok: false,
      status: null,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function GET() {
  const { url } = supabasePublicConfig();
  const restHeaders = supabasePublicHeaders({ Accept: "application/json" });
  const edgeHeaders = supabasePublicHeaders({ "Content-Type": "application/json" });
  const publicDataKey = publicDataServiceKey();

  const checks = await Promise.all([
    checkJson(
      "construction_cost_db",
      `${url}/rest/v1/part3_commercial_cost_default?select=facility_code,default_cost_per_sqm&limit=1`,
      { headers: restHeaders }
    ),
    checkJson(
      "finance_benchmark_db",
      `${url}/rest/v1/part3_finance_benchmark?select=metric_code,value_mid&limit=1`,
      { headers: restHeaders }
    ),
    checkJson(
      "commercial_allocation_edge",
      `${url}/functions/v1/part3-commercial-allocation`,
      {
        method: "POST",
        headers: edgeHeaders,
        body: JSON.stringify({ pnu: TEST_PNU, scenarioCode: "BASE", mode: "read" }),
      }
    ),
    checkLandUseActivity(publicDataKey),
    checkBuildingHub(publicDataKey),
  ]);

  const requiredOk = checks.every((check) => check.ok);

  return NextResponse.json(
    {
      ok: requiredOk,
      testPnu: TEST_PNU,
      supabaseProject: "igiltlrafwiszkhvtspb",
      publicDataKeyConfigured: Boolean(publicDataKey),
      checks,
      rule: "Do not declare integration complete unless every check is ok=true.",
    },
    { status: requiredOk ? 200 : 503 }
  );
}
