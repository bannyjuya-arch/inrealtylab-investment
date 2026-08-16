import { NextRequest } from "next/server";

const VWORLD_WMS_URL = "https://api.vworld.kr/req/wms";

export async function GET(req: NextRequest) {
  const key = process.env.VWORLD_API_KEY;

  if (!key) {
    return new Response("VWORLD_API_KEY is not configured", { status: 503 });
  }

  const params = new URLSearchParams(req.nextUrl.searchParams);
  params.set("key", key);
  params.set("domain", process.env.VWORLD_API_DOMAIN ?? req.nextUrl.origin);

  const upstream = await fetch(`${VWORLD_WMS_URL}?${params.toString()}`, {
    cache: "no-store",
  });

  const body = await upstream.arrayBuffer();
  const headers = new Headers();
  headers.set("Content-Type", upstream.headers.get("Content-Type") ?? "image/png");
  headers.set("Cache-Control", "public, max-age=300");

  return new Response(body, {
    status: upstream.status,
    headers,
  });
}
