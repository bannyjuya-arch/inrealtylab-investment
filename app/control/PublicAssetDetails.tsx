"use client";

import { useEffect, useState } from "react";

type PublicAssetResponse = {
  ok: boolean;
  matched?: boolean;
  message?: string;
  ownerEntity?: string | null;
  asset?: {
    district: string;
    assetKind: string;
    location: string;
    landCategory: string;
    areaSqm: number | null;
    manager: string;
  } | null;
  confidence?: "ADDRESS_MATCH" | "SEARCH_CANDIDATE" | "NO_MATCH";
  freshness?: string;
  source?: {
    name: string;
    provider: string;
    dataDate: string;
    note: string;
  };
};

export default function PublicAssetDetails({
  ownerType,
  legalDong,
  jibun,
}: {
  ownerType: string;
  legalDong: string;
  jibun: string;
}) {
  const [result, setResult] = useState<PublicAssetResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const shouldLookup = ownerType === "LOCAL_GOVERNMENT" && legalDong.includes("서울") && Boolean(jibun);

  useEffect(() => {
    if (!shouldLookup) return;

    let cancelled = false;
    setLoading(true);

    fetch(`/api/public-asset/seoul?legalDong=${encodeURIComponent(legalDong)}&jibun=${encodeURIComponent(jibun)}`, {
      cache: "no-store",
    })
      .then(async (response) => {
        const data = (await response.json()) as PublicAssetResponse;
        if (!cancelled) setResult(data);
      })
      .catch((error) => {
        if (!cancelled) {
          setResult({ ok: false, message: error instanceof Error ? error.message : "시유재산 조회 실패" });
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [shouldLookup, legalDong, jibun]);

  if (!shouldLookup) return null;

  if (loading) {
    return <div className="control-warning" style={{ marginTop: 12 }}>서울시 시유재산 관리정보를 자동 조회하고 있습니다.</div>;
  }

  if (!result) return null;

  if (!result.ok || !result.matched || !result.asset) {
    return (
      <div className="control-warning" style={{ marginTop: 12 }}>
        <strong>관리주체 자동매칭 미확인</strong><br />
        서울시 시유재산 공개자료에서 일치 항목을 확인하지 못했습니다. {result.message ?? "재산관리관은 별도 최신 확인이 필요합니다."}
      </div>
    );
  }

  return (
    <div className="control-warning" style={{ marginTop: 12 }}>
      <strong>서울시 시유재산 공개자료 매칭</strong>
      <div style={{ marginTop: 8, lineHeight: 1.7 }}>
        소유기관 후보 <b>{result.ownerEntity ?? "서울특별시"}</b><br />
        재산관리관 후보 <b>{result.asset.manager || "확인 필요"}</b><br />
        공개자료 소재지 {result.asset.location || "-"}<br />
        재산구분 원문 {result.asset.assetKind || "-"}<br />
        자료 기준일 {result.source?.dataDate ?? "-"}<br />
        상태 <b>REFERENCE · 최신 확인 필요</b>
      </div>
      <small>{result.source?.note}</small>
    </div>
  );
}
