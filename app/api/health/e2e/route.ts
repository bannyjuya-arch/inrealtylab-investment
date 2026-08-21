import { NextResponse } from "next/server";
import { supabasePublicConfig, supabasePublicHeaders } from "../../lib/supabase-public";

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

export async function GET() {
  const { url } = supabasePublicConfig();
  const restHeaders = supabasePublicHeaders({ Accept: "application/json" });
  const edgeHeaders = supabasePublicHeaders({ "Content-Type": "application/json" });

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
  ]);

  const requiredOk = checks.every((check) => check.ok);
  const publicDataKeyConfigured = Boolean(
    process.env.DATA_GO_KR_API_KEY?.trim() || process.env.PUBLIC_DATA_API_KEY?.trim()
  );

  return NextResponse.json(
    {
      ok: requiredOk,
      testPnu: TEST_PNU,
      supabaseProject: "igiltlrafwiszkhvtspb",
      publicDataKeyConfigured,
      checks,
      rule: "Do not declare integration complete unless ok=true. External public-data APIs are checked separately because service entitlement can fail independently.",
    },
    { status: requiredOk ? 200 : 503 }
  );
}
