import { NextRequest, NextResponse } from "next/server";
import { supabasePublicConfig, supabasePublicHeaders } from "../lib/supabase-public";

async function callEdge(body: Record<string, unknown>) {
  const { url } = supabasePublicConfig();
  const response = await fetch(`${url}/functions/v1/part3-commercial-allocation`, {
    method: "POST",
    cache: "no-store",
    headers: supabasePublicHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });

  const text = await response.text();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    data = { ok: false, message: text || "Supabase 응답을 해석하지 못했습니다." };
  }

  return { response, data };
}

export async function GET(req: NextRequest) {
  const pnu = req.nextUrl.searchParams.get("pnu")?.trim() ?? "";
  const scenarioCode = req.nextUrl.searchParams.get("scenarioCode")?.trim() || "BASE";
  const aboveGroundGfaSqm = req.nextUrl.searchParams.get("aboveGroundGfaSqm")?.trim() ?? "";

  const body: Record<string, unknown> = { pnu, scenarioCode, mode: "read" };
  if (aboveGroundGfaSqm) body.aboveGroundGfaSqm = Number(aboveGroundGfaSqm);

  const { response, data } = await callEdge(body);
  return NextResponse.json(data, { status: response.status });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { response, data } = await callEdge(body);
  return NextResponse.json(data, { status: response.status });
}
