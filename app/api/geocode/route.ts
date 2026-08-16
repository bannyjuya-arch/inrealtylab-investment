import { NextRequest, NextResponse } from "next/server";

const VWORLD_ADDRESS_URL = "https://api.vworld.kr/req/address";

type AddressType = "ROAD" | "PARCEL";

async function lookupAddress(query: string, type: AddressType, key: string) {
  const params = new URLSearchParams({
    service: "address",
    request: "getcoord",
    version: "2.0",
    crs: "EPSG:4326",
    address: query,
    refine: "true",
    simple: "false",
    format: "json",
    type,
    key,
  });

  const response = await fetch(`${VWORLD_ADDRESS_URL}?${params.toString()}`, {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`VWorld address API error: ${response.status}`);
  }

  return response.json();
}

export async function GET(req: NextRequest) {
  const query = req.nextUrl.searchParams.get("q")?.trim();
  const key = process.env.VWORLD_API_KEY;

  if (!query) {
    return NextResponse.json({ ok: false, message: "주소 또는 지번을 입력하세요." }, { status: 400 });
  }

  if (!key) {
    return NextResponse.json(
      { ok: false, code: "VWORLD_KEY_MISSING", message: "서버에 VWORLD_API_KEY가 설정되지 않았습니다." },
      { status: 503 }
    );
  }

  try {
    for (const type of ["ROAD", "PARCEL"] as const) {
      const payload = await lookupAddress(query, type, key);
      const response = payload?.response;
      const point = response?.result?.point;

      if (response?.status === "OK" && point?.x && point?.y) {
        return NextResponse.json({
          ok: true,
          query,
          type,
          address: response?.refined?.text ?? query,
          point: {
            lon: Number(point.x),
            lat: Number(point.y),
          },
        });
      }
    }

    return NextResponse.json(
      { ok: false, message: "검색 결과를 찾지 못했습니다. 도로명주소 또는 지번을 확인하세요." },
      { status: 404 }
    );
  } catch (error) {
    console.error("VWorld geocode error", error);
    return NextResponse.json(
      { ok: false, message: "주소 검색 중 오류가 발생했습니다." },
      { status: 502 }
    );
  }
}
