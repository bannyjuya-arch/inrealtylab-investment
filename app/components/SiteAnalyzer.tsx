/* eslint-disable @typescript-eslint/no-explicit-any, react-hooks/exhaustive-deps */
"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

const OPENLAYERS_JS = "https://cdn.jsdelivr.net/npm/ol@10.9.0/dist/ol.js";
const OPENLAYERS_CSS = "https://cdn.jsdelivr.net/npm/ol@10.9.0/ol.css";

type SelectedParcel = {
  id: string;
  pnu: string;
  jibun: string;
  legalDong: string;
  jimok: string;
  areaSqm: number;
  feature: any;
};

type SearchResult = {
  address: string;
  point: { lon: number; lat: number };
};

type RegulationHit = {
  layer: string;
  category: string;
  label: string;
  name: string;
  designationYear?: string | null;
  designationNumber?: string | null;
};

type RegulationData = {
  primaryZone: string | null;
  useZones: RegulationHit[];
  districts: RegulationHit[];
  areas: RegulationHit[];
  districtPlans: RegulationHit[];
  developmentRestrictions: RegulationHit[];
  landTransactionPermit: RegulationHit[];
  statutoryLimit: null | {
    zoneName: string;
    bcrMax: number;
    farMin: number;
    farMax: number;
    legalBasis: string;
    effectiveDate: string;
    scope: string;
  };
  warnings: string[];
  layerErrors: Array<{ layer: string; label: string; message: string }>;
};

type AllowedUseDecision = "ALLOWED" | "CONDITIONAL" | "PROHIBITED" | "REVIEW";

type AllowedUseFacility = {
  key: string;
  label: string;
  group: string;
  decision: AllowedUseDecision;
  reason: string;
  confidence: number;
  activityCode: string | null;
  activityName: string | null;
  evidence: Array<{
    activityName: string;
    decisionRaw: string;
    condition: string | null;
    legalBasis: string | null;
    confidence: number;
  }>;
};

type AllowedUseData = {
  facilities: AllowedUseFacility[];
  diagnostics: {
    activityCatalogCount: number;
    matchedFacilityCount: number;
  };
  source: {
    code: string;
    name: string;
    endpoints: string[];
    baseDate: string;
    queriedAt: string;
    note: string;
  };
};

function ensureOpenLayers(): Promise<any> {
  if (typeof window === "undefined") return Promise.reject(new Error("browser only"));
  if ((window as any).ol) return Promise.resolve((window as any).ol);

  if (!document.querySelector(`link[href="${OPENLAYERS_CSS}"]`)) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = OPENLAYERS_CSS;
    document.head.appendChild(link);
  }

  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${OPENLAYERS_JS}"]`) as HTMLScriptElement | null;
    if (existing) {
      if ((window as any).ol) resolve((window as any).ol);
      else {
        existing.addEventListener("load", () => resolve((window as any).ol), { once: true });
        existing.addEventListener("error", reject, { once: true });
      }
      return;
    }

    const script = document.createElement("script");
    script.src = OPENLAYERS_JS;
    script.async = true;
    script.onload = () => resolve((window as any).ol);
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

function pickProperty(properties: Record<string, unknown>, names: string[]) {
  for (const name of names) {
    const value = properties?.[name];
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  return "";
}

function getRawFeatureCenter(rawFeature: any) {
  const geometry = rawFeature?.geometry;
  if (!geometry) return null;
  const ol = (window as any).ol;
  if (!ol) return null;
  const feature = new ol.format.GeoJSON().readFeature(rawFeature, {
    dataProjection: "EPSG:4326",
    featureProjection: "EPSG:3857",
  });
  const center3857 = ol.extent.getCenter(feature.getGeometry().getExtent());
  const [lon, lat] = ol.proj.toLonLat(center3857);
  return { lon, lat };
}

function formatPct(value: number) {
  return `${value.toLocaleString("ko-KR", { maximumFractionDigits: 1 })}%`;
}

function formatArea(value: number) {
  return `${Math.round(value).toLocaleString("ko-KR")}㎡`;
}

function decisionLabel(decision: AllowedUseDecision) {
  if (decision === "ALLOWED") return "가능";
  if (decision === "CONDITIONAL") return "조건부";
  if (decision === "PROHIBITED") return "불가";
  return "추가확인";
}

function decisionTone(decision: AllowedUseDecision): "ok" | "pending" | "warn" | "neutral" {
  if (decision === "ALLOWED") return "ok";
  if (decision === "CONDITIONAL" || decision === "PROHIBITED") return "warn";
  if (decision === "REVIEW") return "pending";
  return "neutral";
}

// 2026-09-03 확정: STEP 1은 "토지의 종류"만 가린다.
// 국공유지냐 민간이냐를 여기서 판정하고, 민간이면 이후 단계로 넘기지 않는다.
// (행정재산/일반재산 공식 구분은 VWorld 토지소유정보만으로 확정되지 않아 STEP 2에서 다룬다.)
type OwnerSector = "PUBLIC" | "PRIVATE" | "UNKNOWN";

type OwnershipApiRecord = {
  pnu: string;
  ownerClass: string;
  ownerSector: OwnerSector;
  ownerTypeLabel: string;
};

type ParcelOwnership = {
  status: "LOADING" | "DONE" | "ERROR";
  sector: OwnerSector;
  ownerClass: string;
  label: string;
  message?: string;
};

type SiteOwnership = "LOADING" | "PUBLIC" | "PRIVATE" | "UNKNOWN";

function ownershipText(state: ParcelOwnership | undefined) {
  if (!state) return "조회 대기";
  if (state.status === "LOADING") return "조회 중...";
  if (state.sector === "PUBLIC") return `${state.label} · ${state.ownerClass}`;
  if (state.sector === "PRIVATE") return `민간 · ${state.ownerClass}`;
  return state.message ? `확인 필요 (${state.message})` : "확인 필요";
}

export default function SiteAnalyzer() {
  const mapElementRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const selectedSourceRef = useRef<any>(null);
  const olRef = useRef<any>(null);

  const [query, setQuery] = useState("");
  const [message, setMessage] = useState("지도에서 분석할 필지를 선택하세요.");
  const [loading, setLoading] = useState(false);
  const [cadastreVisible, setCadastreVisible] = useState(true);
  const [parcels, setParcels] = useState<SelectedParcel[]>([]);
  const [activeTab, setActiveTab] = useState<"SITE" | "REGULATION" | "USE" | "CAPACITY">("SITE");
  const [regulation, setRegulation] = useState<RegulationData | null>(null);
  const [regulationLoading, setRegulationLoading] = useState(false);
  const [regulationError, setRegulationError] = useState("");
  const [allowedUse, setAllowedUse] = useState<AllowedUseData | null>(null);
  const [allowedUseLoading, setAllowedUseLoading] = useState(false);
  const [allowedUseError, setAllowedUseError] = useState("");
  const [ownershipByPnu, setOwnershipByPnu] = useState<Record<string, ParcelOwnership>>({});
  // 이미 조회를 건 PNU. state로 추적하면 effect가 자기 자신을 다시 트리거해
  // 진행 중이던 요청을 취소해버리므로 ref로 둔다.
  const requestedOwnershipRef = useRef<Set<string>>(new Set());

  const totalArea = useMemo(
    () => parcels.reduce((sum, parcel) => sum + parcel.areaSqm, 0),
    [parcels]
  );

  const capacityScenarios = useMemo(() => {
    const limit = regulation?.statutoryLimit;
    if (!limit || totalArea <= 0) return [];

    return [
      {
        name: "보수 검토",
        bcr: limit.bcrMax * 0.8,
        far: limit.farMax * 0.8,
        note: "법정상한의 80% 사업검토 가정",
        status: "ASSUMPTION",
      },
      {
        name: "기준 검토",
        bcr: limit.bcrMax * 0.9,
        far: limit.farMax * 0.9,
        note: "법정상한의 90% 사업검토 가정",
        status: "ASSUMPTION",
      },
      {
        name: "법정 최대",
        bcr: limit.bcrMax,
        far: limit.farMax,
        note: "현재 연결된 국가 법정상한",
        status: "STATUTORY",
      },
    ].map((item) => {
      const footprint = totalArea * (item.bcr / 100);
      const grossFloorArea = totalArea * (item.far / 100);
      const equivalentFloors = footprint > 0 ? grossFloorArea / footprint : 0;
      return {
        ...item,
        footprint,
        grossFloorArea,
        equivalentFloors,
        footprintPyeong: footprint / 3.305785,
        grossFloorAreaPyeong: grossFloorArea / 3.305785,
      };
    });
  }, [regulation, totalArea]);

  const statutoryCapacity = useMemo(() => {
    const limit = regulation?.statutoryLimit;
    if (!limit || totalArea <= 0) return null;
    return {
      footprint: totalArea * (limit.bcrMax / 100),
      grossFloorArea: totalArea * (limit.farMax / 100),
    };
  }, [regulation, totalArea]);

  useEffect(() => {
    let disposed = false;

    ensureOpenLayers()
      .then((ol) => {
        if (disposed || !mapElementRef.current) return;
        olRef.current = ol;

        const selectedSource = new ol.source.Vector();
        selectedSourceRef.current = selectedSource;

        const cadastralLayer = new ol.layer.Tile({
          visible: true,
          opacity: 0.55,
          source: new ol.source.TileWMS({
            url: "/api/vworld-wms",
            params: {
              SERVICE: "WMS",
              REQUEST: "GetMap",
              VERSION: "1.3.0",
              LAYERS: "lt_c_landinfobasemap",
              STYLES: "lt_c_landinfobasemap",
              FORMAT: "image/png",
              TRANSPARENT: "true",
              CRS: "EPSG:3857",
            },
            transition: 0,
          }),
        });
        cadastralLayer.set("layerName", "cadastre");

        // 2026-09-03 확정 색 체계: 국공유지에만 색을 얹고 민간은 칠하지 않는다.
        // 배경 지도를 덮지 않아야 도로·지번이 그대로 읽힌다.
        const selectedLayer = new ol.layer.Vector({
          source: selectedSource,
          style: (feature: any) => {
            const sector = feature.get("ownerSector");
            if (sector === "PRIVATE") {
              return new ol.style.Style({
                stroke: new ol.style.Stroke({ color: "#9DA09E", width: 2, lineDash: [6, 4] }),
                fill: new ol.style.Fill({ color: "rgba(0, 0, 0, 0)" }),
              });
            }
            if (sector === "PUBLIC") {
              return new ol.style.Style({
                stroke: new ol.style.Stroke({ color: "#14453A", width: 3.5 }),
                fill: new ol.style.Fill({ color: "rgba(62, 125, 101, 0.5)" }),
              });
            }
            // 소유구분이 아직 확인되지 않은 상태. 국공유로 확인되기 전에는
            // 초록을 얹지 않는다 — 확인 전 필지가 국공유지처럼 보이면 안 된다.
            return new ol.style.Style({
              stroke: new ol.style.Stroke({ color: "#C3CCC7", width: 2 }),
              fill: new ol.style.Fill({ color: "rgba(38, 41, 43, 0.03)" }),
            });
          },
        });

        const map = new ol.Map({
          target: mapElementRef.current,
          layers: [
            new ol.layer.Tile({ source: new ol.source.OSM() }),
            cadastralLayer,
            selectedLayer,
          ],
          view: new ol.View({
            center: ol.proj.fromLonLat([127.0365, 37.561]),
            zoom: 16,
            minZoom: 6,
            maxZoom: 20,
          }),
        });

        map.on("singleclick", async (event: any) => {
          const [lon, lat] = ol.proj.toLonLat(event.coordinate);
          await selectParcelAt(lon, lat, false);
        });

        mapRef.current = map;
        setMessage("지도에서 필지를 클릭하거나 주소·지번을 검색하세요.");
      })
      .catch(() => {
        setMessage("지도 엔진을 불러오지 못했습니다. 네트워크 상태를 확인하세요.");
      });

    return () => {
      disposed = true;
      mapRef.current?.setTarget(undefined);
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const layers = mapRef.current?.getLayers?.().getArray?.() ?? [];
    const layer = layers.find((item: any) => item.get?.("layerName") === "cadastre");
    layer?.setVisible(cadastreVisible);
  }, [cadastreVisible]);

  useEffect(() => {
    if (!parcels.length) {
      setQuery("");
      setRegulation(null);
      setRegulationError("");
      setAllowedUse(null);
      setAllowedUseError("");
      setActiveTab("SITE");
    } else {
      const representative = parcels[0];
      setQuery([representative.legalDong, representative.jibun].filter(Boolean).join(" "));
      setRegulation(null);
      setRegulationError("");
      setAllowedUse(null);
      setAllowedUseError("");
    }
  }, [parcels]);

  // 필지를 고르는 즉시 소유구분을 조회한다. Part 2까지 갔다가 튕기지 않도록
  // 판정 지점을 STEP 1으로 앞당긴 것이다(2026-09-03 확정).
  useEffect(() => {
    const pending = parcels
      .map((parcel) => parcel.pnu)
      .filter((pnu) => /^\d{19}$/.test(pnu) && !requestedOwnershipRef.current.has(pnu));
    if (!pending.length) return;

    for (const pnu of pending) requestedOwnershipRef.current.add(pnu);

    setOwnershipByPnu((current) => {
      const next = { ...current };
      for (const pnu of pending) {
        next[pnu] = { status: "LOADING", sector: "UNKNOWN", ownerClass: "", label: "조회 중" };
      }
      return next;
    });

    (async () => {
      for (const pnu of pending) {
        let resolved: ParcelOwnership;
        try {
          const response = await fetch(`/api/ownership?pnu=${encodeURIComponent(pnu)}`, { cache: "no-store" });
          const data = await response.json();
          const record: OwnershipApiRecord | undefined = data?.records?.[0];
          resolved = record
            ? { status: "DONE", sector: record.ownerSector, ownerClass: record.ownerClass, label: record.ownerTypeLabel }
            : {
                status: "ERROR",
                sector: "UNKNOWN",
                ownerClass: "",
                label: "확인 필요",
                message: data?.message ?? "소유정보를 찾지 못했습니다.",
              };
        } catch (error) {
          resolved = {
            status: "ERROR",
            sector: "UNKNOWN",
            ownerClass: "",
            label: "확인 필요",
            message: error instanceof Error ? error.message : "소유정보 조회 실패",
          };
        }

        setOwnershipByPnu((current) => ({ ...current, [pnu]: resolved }));
        // 지도 폴리곤 색을 소유구분에 맞춰 다시 칠한다.
        selectedSourceRef.current?.getFeatureById(pnu)?.set("ownerSector", resolved.sector);
      }
    })();
  }, [parcels]);

  const siteOwnership = useMemo<SiteOwnership | null>(() => {
    if (!parcels.length) return null;
    const states = parcels.map((parcel) => ownershipByPnu[parcel.pnu]);
    if (states.some((state) => !state || state.status === "LOADING")) return "LOADING";
    if (states.some((state) => state?.sector === "PRIVATE")) return "PRIVATE";
    if (states.every((state) => state?.sector === "PUBLIC")) return "PUBLIC";
    return "UNKNOWN";
  }, [parcels, ownershipByPnu]);

  // 민간소유가 하나라도 섞이면 다음 단계로 넘기지 않는다.
  const analysisBlocked = siteOwnership === "PRIVATE";

  async function fetchParcel(lon: number, lat: number) {
    const response = await fetch(`/api/cadastre?lon=${encodeURIComponent(lon)}&lat=${encodeURIComponent(lat)}`);
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data?.message ?? "필지 조회에 실패했습니다.");
    return data.featureCollection;
  }

  async function selectParcelAt(lon: number, lat: number, fitToParcel: boolean) {
    const ol = olRef.current;
    if (!ol) return;

    setLoading(true);
    setMessage("지적 필지를 조회하고 있습니다...");

    try {
      const collection = await fetchParcel(lon, lat);
      const rawFeature = collection.features?.[0];
      if (!rawFeature) throw new Error("필지를 찾지 못했습니다.");

      const props = rawFeature.properties ?? {};
      const pnu = pickProperty(props, ["pnu", "PNU", "PNU_CD", "pnu_cd"]);
      const jibun = pickProperty(props, ["jibun", "JIBUN", "addr", "address", "JIBUN_ADDR"]);
      const sido = pickProperty(props, ["sido_nm", "SIDO_NM"]);
      const sgg = pickProperty(props, ["sgg_nm", "SGG_NM"]);
      const emd = pickProperty(props, ["emd_nm", "EMD_NM"]);
      const ri = pickProperty(props, ["ri_nm", "RI_NM"]);
      const legalDong = [sido, sgg, emd, ri].filter(Boolean).join(" ");
      const jimok = pickProperty(props, ["jimok", "JIMOK"]);
      const id = pnu || rawFeature.id || `${lon.toFixed(7)}-${lat.toFixed(7)}`;

      if (selectedSourceRef.current?.getFeatureById(id)) {
        setMessage("이미 선택된 필지입니다.");
        return;
      }

      const feature = new ol.format.GeoJSON().readFeature(rawFeature, {
        dataProjection: "EPSG:4326",
        featureProjection: "EPSG:3857",
      });
      feature.setId(id);

      const areaSqm = Math.round(ol.sphere.getArea(feature.getGeometry()));
      selectedSourceRef.current?.addFeature(feature);

      setParcels((current) => [
        ...current,
        {
          id,
          pnu: pnu || "확인 필요",
          jibun: jibun || "지번 정보 없음",
          legalDong: legalDong || "법정동 정보 없음",
          jimok: jimok || "지목 정보 없음",
          areaSqm,
          feature: rawFeature,
        },
      ]);

      if (fitToParcel) {
        mapRef.current?.getView().fit(feature.getGeometry().getExtent(), {
          padding: [80, 80, 80, 80],
          maxZoom: 18,
          duration: 500,
        });
      }
      setMessage("필지가 선택되었습니다. 인접 필지를 추가로 클릭할 수 있습니다.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "필지 조회에 실패했습니다.");
    } finally {
      setLoading(false);
    }
  }

  async function handleSearch(event: FormEvent) {
    event.preventDefault();
    if (!query.trim()) return;

    setLoading(true);
    setMessage("주소를 검색하고 있습니다...");

    try {
      const response = await fetch(`/api/geocode?q=${encodeURIComponent(query.trim())}`);
      const data = (await response.json()) as { ok: boolean; message?: string } & Partial<SearchResult>;
      if (!response.ok || !data.ok || !data.point) throw new Error(data.message ?? "검색에 실패했습니다.");

      const ol = olRef.current;
      const center = ol.proj.fromLonLat([data.point.lon, data.point.lat]);
      mapRef.current?.getView().animate({ center, zoom: 18, duration: 500 });
      await selectParcelAt(data.point.lon, data.point.lat, true);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "검색에 실패했습니다.");
      setLoading(false);
    }
  }

  async function fetchRegulationData() {
    if (!parcels.length) throw new Error("먼저 필지를 선택하세요.");
    const center = getRawFeatureCenter(parcels[0].feature);
    if (!center) throw new Error("선택 필지의 중심 좌표를 계산하지 못했습니다.");

    const response = await fetch(
      `/api/regulation?lon=${encodeURIComponent(center.lon)}&lat=${encodeURIComponent(center.lat)}&pnu=${encodeURIComponent(parcels[0].pnu)}`
    );
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data?.message ?? "규제정보 조회에 실패했습니다.");
    return data.regulation as RegulationData;
  }

  async function loadRegulation(nextTab: "REGULATION" | "CAPACITY") {
    if (!parcels.length) return;
    setActiveTab(nextTab);
    if (regulation || regulationLoading) return;

    setRegulationLoading(true);
    setRegulationError("");
    try {
      const nextRegulation = await fetchRegulationData();
      setRegulation(nextRegulation);
    } catch (error) {
      setRegulationError(error instanceof Error ? error.message : "규제정보 조회에 실패했습니다.");
    } finally {
      setRegulationLoading(false);
    }
  }

  async function loadAllowedUse() {
    if (!parcels.length) return;
    setActiveTab("USE");
    if (allowedUse || allowedUseLoading) return;

    setAllowedUseLoading(true);
    setAllowedUseError("");
    try {
      let currentRegulation = regulation;
      if (!currentRegulation) {
        setRegulationLoading(true);
        currentRegulation = await fetchRegulationData();
        setRegulation(currentRegulation);
        setRegulationLoading(false);
      }

      const zoneName = currentRegulation.primaryZone ?? currentRegulation.useZones[0]?.name ?? "";
      const legalGfa = currentRegulation.statutoryLimit
        ? totalArea * (currentRegulation.statutoryLimit.farMax / 100)
        : null;
      const gfaParam = legalGfa && legalGfa > 0
        ? `&aboveGroundGfaSqm=${encodeURIComponent(legalGfa)}`
        : "";
      const response = await fetch(
        `/api/allowed-use?pnu=${encodeURIComponent(parcels[0].pnu)}&zoneName=${encodeURIComponent(zoneName)}&scenarioCode=BASE${gfaParam}`
      );
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data?.message ?? data?.error ?? "건축 가능시설 조회에 실패했습니다.");
      setAllowedUse({
        facilities: data.facilities ?? [],
        diagnostics: data.diagnostics,
        source: data.source,
      });
    } catch (error) {
      setRegulationLoading(false);
      setAllowedUseError(error instanceof Error ? error.message : "건축 가능시설 조회에 실패했습니다.");
    } finally {
      setAllowedUseLoading(false);
    }
  }

  function removeParcel(id: string) {
    const feature = selectedSourceRef.current?.getFeatureById(id);
    if (feature) selectedSourceRef.current.removeFeature(feature);
    setParcels((current) => current.filter((parcel) => parcel.id !== id));
    setMessage("선택 필지를 해제했습니다.");
  }

  function clearSelection() {
    selectedSourceRef.current?.clear();
    setParcels([]);
    setMessage("선택을 초기화했습니다.");
  }

  return (
    <main className="site-analyzer-shell">
      <header className="site-analyzer-header">
        <div>
          <div className="product-kicker">INRealtyLab · Site Analyzer</div>
          <h1>대지를 선택하면 분석이 시작됩니다.</h1>
          <p>지도에서 실제 지적 필지를 지정하고 PNU와 대지면적을 확보하는 첫 단계입니다.</p>
        </div>
        <div className="beta-chip">CORE v0.5</div>
      </header>

      <form className="map-search" onSubmit={handleSearch}>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="도로명주소 또는 지번 검색"
          aria-label="도로명주소 또는 지번 검색"
        />
        <button type="submit" disabled={loading}>{loading ? "조회 중" : "대지 찾기"}</button>
      </form>

      <section className="site-analyzer-layout">
        <div className="map-panel">
          <div className="map-toolbar">
            <label>
              <input
                type="checkbox"
                checked={cadastreVisible}
                onChange={(event) => setCadastreVisible(event.target.checked)}
              />
              지적 경계
            </label>
            <span>클릭: 필지 추가 선택</span>
            <button type="button" onClick={clearSelection} disabled={!parcels.length}>선택 초기화</button>
          </div>
          <div ref={mapElementRef} className="map-canvas" />
          <div className="map-status">{message}</div>
        </div>

        <aside className="analysis-panel">
          <div className="analysis-tabs">
            <button className={activeTab === "SITE" ? "active" : ""} onClick={() => setActiveTab("SITE")}>SITE</button>
            <button className={activeTab === "REGULATION" ? "active" : ""} disabled={!parcels.length || analysisBlocked} onClick={() => loadRegulation("REGULATION")}>REGULATION</button>
            <button className={activeTab === "USE" ? "active" : ""} disabled={!parcels.length || analysisBlocked} onClick={loadAllowedUse}>USE</button>
            <button className={activeTab === "CAPACITY" ? "active" : ""} disabled={!parcels.length || analysisBlocked} onClick={() => loadRegulation("CAPACITY")}>CAPACITY</button>
          </div>

          {activeTab === "SITE" && (
            <>
              <div className="analysis-summary">
                <span>선택 필지</span>
                <strong>{parcels.length}필지</strong>
              </div>
              <div className="analysis-summary">
                <span>통합 대지면적</span>
                <strong>{totalArea.toLocaleString("ko-KR")}㎡</strong>
                <small>{(totalArea / 3.305785).toLocaleString("ko-KR", { maximumFractionDigits: 1 })}평</small>
              </div>

              {siteOwnership && (
                <div className={`analysis-alert${siteOwnership === "PRIVATE" ? " error" : ""}`}>
                  {siteOwnership === "LOADING" && "토지 소유정보를 조회하고 있습니다..."}
                  {siteOwnership === "PUBLIC" && "국공유지입니다. 다음 단계로 진행할 수 있습니다. 행정재산·일반재산 구분은 다음 단계에서 확인합니다."}
                  {siteOwnership === "UNKNOWN" && "소유구분을 확정하지 못했습니다. 등기·공부를 확인한 뒤 진행하세요."}
                  {siteOwnership === "PRIVATE" && "민간소유 필지가 포함되어 있습니다. 인리얼티는 국공유지만 분석합니다 — 해당 필지를 제거하거나 인접한 국공유지를 선택하세요."}
                </div>
              )}

              <div className="parcel-list">
                {parcels.length === 0 ? (
                  <div className="empty-site">
                    <strong>대지를 선택하세요.</strong>
                    <p>주소 검색 또는 지도 클릭으로 실제 필지를 선택할 수 있습니다.</p>
                  </div>
                ) : (
                  parcels.map((parcel, index) => (
                    <article className="parcel-card" key={parcel.id}>
                      <div className="parcel-card-head">
                        <span>필지 {index + 1}</span>
                        <button type="button" onClick={() => removeParcel(parcel.id)}>제거</button>
                      </div>
                      <dl>
                        <div><dt>PNU</dt><dd>{parcel.pnu}</dd></div>
                        <div><dt>법정동</dt><dd>{parcel.legalDong}</dd></div>
                        <div><dt>지번</dt><dd>{parcel.jibun}</dd></div>
                        <div><dt>지목</dt><dd>{parcel.jimok}</dd></div>
                        <div><dt>면적</dt><dd>{parcel.areaSqm.toLocaleString("ko-KR")}㎡</dd></div>
                        <div><dt>소유</dt><dd>{ownershipText(ownershipByPnu[parcel.pnu])}</dd></div>
                      </dl>
                    </article>
                  ))
                )}
              </div>

              {analysisBlocked ? (
                <div className="next-step-card">
                  <span>대상 아님</span>
                  <strong>국공유지가 아닙니다</strong>
                  <p>인리얼티는 매입 없이 개발하는 비소유형 구조를 다루기 때문에 민간소유 필지는 분석하지 않습니다. 위 목록에서 민간 필지를 제거하고 인접한 국공유지를 지도에서 선택해 주세요.</p>
                  <button type="button" onClick={clearSelection}>선택 초기화</button>
                </div>
              ) : (
                <div className="next-step-card">
                  <span>NEXT</span>
                  <strong>법적 규제 분석</strong>
                  <p>선택된 PNU를 기준으로 용도지역·지구·구역과 국가 법정 건폐율·용적률 범위를 조회합니다.</p>
                  <button type="button" disabled={!parcels.length || siteOwnership === "LOADING"} onClick={() => loadRegulation("REGULATION")}>REGULATION 보기</button>
                </div>
              )}
            </>
          )}

          {activeTab === "REGULATION" && (
            <div className="regulation-view">
              <div className="section-title-row">
                <div><span>REGULATION</span><strong>법적 규제 분석</strong></div>
                {regulationLoading && <small>조회 중...</small>}
              </div>
              {regulationError && <div className="analysis-alert error">{regulationError}</div>}
              {!regulation && !regulationLoading && !regulationError && <div className="empty-site">규제정보를 불러오지 못했습니다.</div>}
              {regulation && (
                <>
                  <div className="metric-grid">
                    <div><span>주요 용도지역</span><strong>{regulation.primaryZone ?? "확인 필요"}</strong></div>
                    <div><span>건폐율 상한</span><strong>{regulation.statutoryLimit ? formatPct(regulation.statutoryLimit.bcrMax) : "-"}</strong></div>
                    <div><span>용적률 상한</span><strong>{regulation.statutoryLimit ? formatPct(regulation.statutoryLimit.farMax) : "-"}</strong></div>
                  </div>

                  <div className="regulation-groups">
                    <RegulationGroup title="용도지역" items={regulation.useZones} />
                    <RegulationGroup title="용도지구" items={regulation.districts} />
                    <RegulationGroup title="용도구역" items={regulation.areas} />
                    <RegulationGroup title="지구단위계획" items={regulation.districtPlans} />
                    <RegulationGroup title="개발행위 제한" items={regulation.developmentRestrictions} />
                    <RegulationGroup title="토지거래허가" items={regulation.landTransactionPermit} />
                  </div>

                  {regulation.statutoryLimit && (
                    <div className="source-note">
                      <strong>{regulation.statutoryLimit.legalBasis}</strong>
                      <span>시행기준 {regulation.statutoryLimit.effectiveDate}</span>
                      <p>{regulation.statutoryLimit.scope}</p>
                    </div>
                  )}
                  {regulation.warnings.map((warning) => <div className="analysis-alert" key={warning}>{warning}</div>)}
                  {!!regulation.layerErrors.length && (
                    <div className="analysis-alert">일부 주제도 조회 실패 {regulation.layerErrors.length}건 — 다른 규제 결과는 그대로 표시합니다.</div>
                  )}

                  <div className="next-step-card">
                    <span>NEXT</span>
                    <strong>건축 가능시설</strong>
                    <p>선택 필지의 시군구와 용도지역을 기준으로 토지이용행위 가능여부를 조회해 가능·조건부·불가·추가확인으로 표시합니다.</p>
                    <button type="button" onClick={loadAllowedUse}>USE 보기</button>
                  </div>
                </>
              )}
            </div>
          )}

          {activeTab === "USE" && (
            <div className="regulation-view">
              <div className="section-title-row">
                <div><span>USE</span><strong>건축 가능시설</strong></div>
                {allowedUseLoading && <small>공공데이터 조회 중...</small>}
              </div>

              {allowedUseError && <div className="analysis-alert error">{allowedUseError}</div>}
              {!allowedUse && !allowedUseLoading && !allowedUseError && <div className="empty-site">건축 가능시설 정보를 불러오지 못했습니다.</div>}

              {allowedUse && (
                <>
                  <div className="metric-grid">
                    <div><span>기준 용도지역</span><strong>{regulation?.primaryZone ?? "추가확인"}</strong></div>
                    <div><span>행위코드 매칭</span><strong>{allowedUse.diagnostics.matchedFacilityCount}/{allowedUse.facilities.length}</strong></div>
                    <div><span>기준일</span><strong>{allowedUse.source.baseDate}</strong></div>
                  </div>

                  <AllowedUseGroup title="업무시설" facilities={allowedUse.facilities.filter((facility) => facility.group === "OFFICE")} />
                  <AllowedUseGroup title="판매·근린생활시설" facilities={allowedUse.facilities.filter((facility) => facility.group === "RETAIL")} />
                  <AllowedUseGroup title="기타 수익시설" facilities={allowedUse.facilities.filter((facility) => !["OFFICE", "RETAIL", "PUBLIC"].includes(facility.group))} />
                  <AllowedUseGroup title="공공·필수시설" facilities={allowedUse.facilities.filter((facility) => facility.group === "PUBLIC")} />

                  <div className="source-note">
                    <strong>{allowedUse.source.name}</strong>
                    <span>기준일 {allowedUse.source.baseDate} · {allowedUse.source.endpoints.join(" + ")}</span>
                    <p>{allowedUse.source.note}</p>
                  </div>

                  {regulation?.districtPlans.length ? (
                    <div className="analysis-alert">지구단위계획구역이 중첩되어 있습니다. 여기의 행위제한 1차 판정 외에 지구단위계획 결정도서의 허용용도·불허용도를 반드시 추가 확인해야 합니다.</div>
                  ) : null}
                  {parcels.length > 1 && (
                    <div className="analysis-alert error">현재 USE 판정은 대표 필지 1개 기준입니다. 복수 필지의 용도지역이 다른 경우 필지별 판정으로 확장해야 합니다.</div>
                  )}

                  <div className="next-step-card">
                    <span>NEXT</span>
                    <strong>개발가능 규모</strong>
                    <p>무엇을 지을 수 있는지 확인한 뒤, 대지면적과 건폐율·용적률을 기준으로 개발가능 규모를 계산합니다.</p>
                    <button type="button" onClick={() => loadRegulation("CAPACITY")}>CAPACITY 보기</button>
                  </div>
                </>
              )}
            </div>
          )}

          {activeTab === "CAPACITY" && (
            <div className="capacity-view">
              <div className="section-title-row">
                <div><span>CAPACITY</span><strong>개발가능 규모</strong></div>
                {regulationLoading && <small>규제정보 조회 중...</small>}
              </div>
              {regulationError && <div className="analysis-alert error">{regulationError}</div>}
              {regulation && regulation.statutoryLimit && statutoryCapacity ? (
                <>
                  <div className="capacity-basis">
                    <span>현재 계산 기준</span>
                    <strong>{regulation.primaryZone ?? regulation.statutoryLimit.zoneName}</strong>
                    <p>대지 {formatArea(totalArea)} · BCR {formatPct(regulation.statutoryLimit.bcrMax)} · FAR {formatPct(regulation.statutoryLimit.farMax)}</p>
                  </div>

                  <div className="metric-grid capacity-metrics">
                    <div>
                      <span>적용 대지면적</span>
                      <strong>{formatArea(totalArea)}</strong>
                      <small>{(totalArea / 3.305785).toLocaleString("ko-KR", { maximumFractionDigits: 1 })}평</small>
                    </div>
                    <div>
                      <span>법정 최대 건축면적</span>
                      <strong>{formatArea(statutoryCapacity.footprint)}</strong>
                      <small>BCR {formatPct(regulation.statutoryLimit.bcrMax)}</small>
                    </div>
                    <div>
                      <span>법정 최대 연면적</span>
                      <strong>{formatArea(statutoryCapacity.grossFloorArea)}</strong>
                      <small>FAR {formatPct(regulation.statutoryLimit.farMax)}</small>
                    </div>
                  </div>

                  <div className="capacity-subtitle">
                    <strong>규모 시나리오</strong>
                    <span>보수/기준안은 사업검토 가정이며 법적 기준이 아닙니다.</span>
                  </div>

                  <div className="scenario-list">
                    {capacityScenarios.map((scenario) => (
                      <article className={`scenario-card ${scenario.status === "STATUTORY" ? "statutory" : ""}`} key={scenario.name}>
                        <div className="scenario-head">
                          <strong>{scenario.name}</strong>
                          <span>{scenario.note}</span>
                        </div>
                        <dl>
                          <div><dt>건폐율</dt><dd>{formatPct(scenario.bcr)}</dd></div>
                          <div><dt>용적률</dt><dd>{formatPct(scenario.far)}</dd></div>
                          <div><dt>건축면적</dt><dd>{formatArea(scenario.footprint)}</dd></div>
                          <div><dt>연면적</dt><dd>{formatArea(scenario.grossFloorArea)}</dd></div>
                          <div><dt>연면적(평)</dt><dd>{scenario.grossFloorAreaPyeong.toLocaleString("ko-KR", { maximumFractionDigits: 1 })}평</dd></div>
                          <div><dt>단순 환산층수</dt><dd>{scenario.equivalentFloors.toLocaleString("ko-KR", { maximumFractionDigits: 1 })}층</dd></div>
                        </dl>
                      </article>
                    ))}
                  </div>

                  <div className="capacity-subtitle">
                    <strong>규제 반영 상태</strong>
                    <span>어떤 값이 계산에 들어갔는지 추적합니다.</span>
                  </div>
                  <div className="capacity-status-list">
                    <CapacityStatus label="대지면적 / PNU" status="반영" tone="ok" detail="VWorld 지적 필지" />
                    <CapacityStatus label="용도지역" status="반영" tone="ok" detail={regulation.primaryZone ?? "세부지역 확인 필요"} />
                    <CapacityStatus label="건축 가능시설" status={allowedUse ? "조회" : "미조회"} tone={allowedUse ? "ok" : "pending"} detail={allowedUse ? "국토교통부 토지이용규제정보서비스" : "USE 단계에서 조회"} />
                    <CapacityStatus label="국가 건폐율·용적률" status="반영" tone="ok" detail={regulation.statutoryLimit.legalBasis} />
                    <CapacityStatus label="지자체 조례" status="미반영" tone="pending" detail="조례 Rule DB 연결 예정" />
                    <CapacityStatus
                      label="지구단위계획 세부지침"
                      status={regulation.districtPlans.length ? "검토 필요" : "중첩 없음"}
                      tone={regulation.districtPlans.length ? "warn" : "neutral"}
                      detail={regulation.districtPlans.length ? regulation.districtPlans.map((item) => item.name).join(", ") : "공간중첩 기준"}
                    />
                    <CapacityStatus label="인센티브 / 특례" status="미반영" tone="pending" detail="승인된 Regulation Rule만 향후 자동 적용" />
                  </div>

                  {parcels.length > 1 && (
                    <div className="analysis-alert error">현재 REGULATION/USE/CAPACITY는 첫 번째 선택 필지 기준입니다. 복수 필지가 서로 다른 용도지역에 걸치는 경우 필지별 규제·허용용도 계산으로 확장해야 정확합니다.</div>
                  )}
                  <div className="analysis-alert">단순 환산층수는 연면적 ÷ 건축면적의 기초 지표입니다. 실제 층수는 높이, 일조, 도로, 주차, 코어·공용부, 용적률 산입 제외면적, 지구단위계획 및 개별법 검토 후 달라집니다.</div>
                  <div className="analysis-alert">현재 CAPACITY에는 국가 법정상한만 자동 반영됩니다. 앞서 구축한 규정 DB에서 서울시 조례·고시·인센티브 규칙이 검토 후 ACTIVE가 되면 이 단계에서 적용기준과 산식을 덮어쓰도록 연결합니다.</div>
                </>
              ) : !regulationLoading && (
                <div className="empty-site"><strong>CAPACITY 계산 대기</strong><p>세부 용도지역과 건폐율·용적률 기준이 확인되어야 계산할 수 있습니다.</p></div>
              )}
            </div>
          )}
        </aside>
      </section>
    </main>
  );
}

function RegulationGroup({ title, items }: { title: string; items: RegulationHit[] }) {
  return (
    <section className="regulation-group">
      <div className="regulation-group-head"><strong>{title}</strong><span>{items.length}건</span></div>
      {items.length ? (
        <ul>{items.map((item, index) => <li key={`${item.layer}-${item.name}-${index}`}><span>{item.name}</span><small>{item.label}</small></li>)}</ul>
      ) : (
        <p>중첩 없음</p>
      )}
    </section>
  );
}

function AllowedUseGroup({ title, facilities }: { title: string; facilities: AllowedUseFacility[] }) {
  return (
    <section className="regulation-group">
      <div className="regulation-group-head"><strong>{title}</strong><span>{facilities.length}개</span></div>
      {facilities.length ? (
        <div className="capacity-status-list">
          {facilities.map((facility) => (
            <CapacityStatus
              key={facility.key}
              label={facility.label}
              status={decisionLabel(facility.decision)}
              tone={decisionTone(facility.decision)}
              detail={`${facility.activityName ?? "행위코드 추가확인"} · 신뢰도 ${Math.round(facility.confidence * 100)}% · ${facility.reason}`}
            />
          ))}
        </div>
      ) : (
        <p>대상 시설 없음</p>
      )}
    </section>
  );
}

function CapacityStatus({
  label,
  status,
  tone,
  detail,
}: {
  label: string;
  status: string;
  tone: "ok" | "pending" | "warn" | "neutral";
  detail: string;
}) {
  return (
    <div className="capacity-status-row">
      <div>
        <strong>{label}</strong>
        <small>{detail}</small>
      </div>
      <span className={`status-chip ${tone}`}>{status}</span>
    </div>
  );
}
