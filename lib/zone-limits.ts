// 국토계획법 시행령 제84조·제85조 국가 법정상한 (지자체 조례·지구단위계획·개별법 규제 미반영).
// api/regulation(자동조회)과 STEP2 용도지역 가정변경(시나리오) UI가 함께 참조하는
// 단일 출처. 여기 값이 바뀌면 두 곳 다 같이 바뀐다(2026-09-07).

export type ZoneLimit = { bcrMax: number; farMin: number; farMax: number };

export const NATIONAL_ZONE_LIMITS: Record<string, ZoneLimit> = {
  "제1종전용주거지역": { bcrMax: 50, farMin: 50, farMax: 100 },
  "제2종전용주거지역": { bcrMax: 50, farMin: 50, farMax: 150 },
  "제1종일반주거지역": { bcrMax: 60, farMin: 100, farMax: 200 },
  "제2종일반주거지역": { bcrMax: 60, farMin: 100, farMax: 250 },
  "제3종일반주거지역": { bcrMax: 50, farMin: 100, farMax: 300 },
  "준주거지역": { bcrMax: 70, farMin: 200, farMax: 500 },
  "중심상업지역": { bcrMax: 90, farMin: 200, farMax: 1500 },
  "일반상업지역": { bcrMax: 80, farMin: 200, farMax: 1300 },
  "근린상업지역": { bcrMax: 70, farMin: 200, farMax: 900 },
  "유통상업지역": { bcrMax: 80, farMin: 200, farMax: 1100 },
  "전용공업지역": { bcrMax: 70, farMin: 150, farMax: 300 },
  "일반공업지역": { bcrMax: 70, farMin: 150, farMax: 350 },
  "준공업지역": { bcrMax: 70, farMin: 150, farMax: 400 },
  "보전녹지지역": { bcrMax: 20, farMin: 50, farMax: 80 },
  "생산녹지지역": { bcrMax: 20, farMin: 50, farMax: 100 },
  "자연녹지지역": { bcrMax: 20, farMin: 50, farMax: 100 },
  "보전관리지역": { bcrMax: 20, farMin: 50, farMax: 80 },
  "생산관리지역": { bcrMax: 20, farMin: 50, farMax: 80 },
  "계획관리지역": { bcrMax: 40, farMin: 50, farMax: 100 },
  "농림지역": { bcrMax: 20, farMin: 50, farMax: 80 },
  "자연환경보전지역": { bcrMax: 20, farMin: 50, farMax: 80 },
};

// STEP2 "용도지역 가정변경" 드롭다운에 쓰는 순서. 도시지역 4대 계열 순으로 늘어놓는다.
export const ZONE_OVERRIDE_OPTIONS = [
  "제1종전용주거지역",
  "제2종전용주거지역",
  "제1종일반주거지역",
  "제2종일반주거지역",
  "제3종일반주거지역",
  "준주거지역",
  "중심상업지역",
  "일반상업지역",
  "근린상업지역",
  "유통상업지역",
  "전용공업지역",
  "일반공업지역",
  "준공업지역",
  "보전녹지지역",
  "생산녹지지역",
  "자연녹지지역",
] as const;

export function compactZoneName(value: unknown) {
  return String(value ?? "").replace(/\s+/g, "").trim();
}

export function findNationalZoneLimit(name: string) {
  const normalized = compactZoneName(name);
  const matched = Object.entries(NATIONAL_ZONE_LIMITS).find(([zone]) =>
    normalized.includes(compactZoneName(zone))
  );
  return matched ? { zoneName: matched[0], ...matched[1] } : null;
}
