import { NextRequest, NextResponse } from "next/server";

const BASE = "https://apis.data.go.kr/1613000/arLandUseInfoService";

function serviceKey() {
  const raw = process.env.DATA_GO_KR_API_KEY ?? process.env.PUBLIC_DATA_API_KEY ?? "";
  const trimmed = raw.trim();
  try { return decodeURIComponent(trimmed); } catch { return trimmed; }
}

function redact(raw: string, key: string) {
  return raw
    .replaceAll(key, "[SERVICE_KEY]")
    .replaceAll(encodeURIComponent(key), "[SERVICE_KEY]")
    .slice(0, 12000);
}

export async function GET(request: NextRequest) {
  const mode = request.nextUrl.searchParams.get("mode") === "info" ? "DTarLandUseInfo" : "DTsearchLunCd";
  const key = serviceKey();
  if (!key) {
    return NextResponse.json({ ok: false, message: "DATA_GO_KR_API_KEY missing" }, { status: 503 });
  }

  const params = new URLSearchParams();
  request.nextUrl.searchParams.forEach((value, name) => {
    if (name !== "mode") params.append(name, value);
  });
  params.set("serviceKey", key);
  if (!params.has("numOfRows")) params.set("numOfRows", "100");
  if (!params.has("pageNo")) params.set("pageNo", "1");

  try {
    const response = await fetch(`${BASE}/${mode}?${params.toString()}`, {
      cache: "no-store",
      headers: { Accept: "application/xml,text/xml,*/*" },
    });
    const raw = await response.text();
    return NextResponse.json({
      ok: response.ok,
      endpoint: mode,
      status: response.status,
      sentParams: Object.fromEntries([...params.entries()].filter(([name]) => name !== "serviceKey")),
      raw: redact(raw, key),
    }, { status: response.ok ? 200 : 502 });
  } catch (error) {
    return NextResponse.json({ ok: false, message: error instanceof Error ? error.message : String(error) }, { status: 502 });
  }
}
