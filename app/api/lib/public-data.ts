export type XmlRow = Record<string, string>;

export function publicDataServiceKey() {
  const raw = process.env.DATA_GO_KR_API_KEY ?? process.env.PUBLIC_DATA_API_KEY ?? "";
  const trimmed = raw.trim();
  try {
    return decodeURIComponent(trimmed);
  } catch {
    return trimmed;
  }
}

function decodeXml(value: string) {
  return value
    .replace(/<!\[CDATA\[|\]\]>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

export function parseXmlItems(xml: string): XmlRow[] {
  const chunks = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].map((match) => match[1]);
  return chunks.map((chunk) => {
    const row: XmlRow = {};
    for (const match of chunk.matchAll(/<([A-Za-z0-9_]+)>([\s\S]*?)<\/\1>/g)) {
      row[match[1]] = decodeXml(match[2]);
    }
    return row;
  });
}

export function xmlTag(xml: string, tag: string) {
  const match = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? decodeXml(match[1]) : "";
}

export function safePublicDataSnippet(raw: string, key: string) {
  const encoded = encodeURIComponent(key);
  return raw
    .replace(/\s+/g, " ")
    .replaceAll(key, "[SERVICE_KEY]")
    .replaceAll(encoded, "[SERVICE_KEY]")
    .slice(0, 500);
}

export async function fetchPublicDataXml(
  baseUrl: string,
  path: string,
  params: Record<string, string>,
  key: string
) {
  const query = new URLSearchParams({ ...params, serviceKey: key });
  const response = await fetch(`${baseUrl}/${path}?${query.toString()}`, {
    cache: "no-store",
    headers: { Accept: "application/xml,text/xml,*/*" },
  });
  const raw = await response.text();

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${safePublicDataSnippet(raw, key)}`);
  }

  const resultCode = xmlTag(raw, "resultCode") || xmlTag(raw, "returnReasonCode");
  const resultMsg = xmlTag(raw, "resultMsg") || xmlTag(raw, "returnAuthMsg") || xmlTag(raw, "errMsg");
  if (resultCode && !/^(00|0000|0)$/.test(resultCode)) {
    throw new Error(`공공데이터포털 오류 ${resultCode}${resultMsg ? `: ${resultMsg}` : ""}`);
  }
  if (/SERVICE_(?:ACCESS_DENIED|KEY_IS_NOT_REGISTERED|KEY_IS_NULL)|등록되지 않은 인증키|인증키/i.test(raw)) {
    throw new Error("공공데이터포털 인증키 또는 해당 API 활용신청 상태를 확인해야 합니다.");
  }

  return {
    rows: parseXmlItems(raw),
    totalCount: Number(xmlTag(raw, "totalCount")) || 0,
    resultCode: resultCode || null,
    resultMsg: resultMsg || null,
  };
}
