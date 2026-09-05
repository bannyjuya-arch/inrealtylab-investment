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
  const [ownershipByPnu, setOwnershipByPnu] = useState<Record<string, ParcelOwnership>>({});
  // 이미 조회를 건 PNU. state로 추적하면 effect가 자기 자신을 다시 트리거해
  // 진행 중이던 요청을 취소해버리므로 ref로 둔다.
  const requestedOwnershipRef = useRef<Set<string>>(new Set());

  const totalArea = useMemo(
    () => parcels.reduce((sum, parcel) => sum + parcel.areaSqm, 0),
    [parcels]
  );


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
    } else {
      const representative = parcels[0];
      setQuery([representative.legalDong, representative.jibun].filter(Boolean).join(" "));
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

  // STEP 2가 읽어갈 값을 남긴다. Part2Launcher의 DOM 스크래핑과 별개 키를 쓰므로
  // 기존 흐름에는 영향이 없다(2026-09-03).
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      if (!parcels.length) {
        sessionStorage.removeItem("inrealtylab.step1");
        return;
      }
      sessionStorage.setItem(
        "inrealtylab.step1",
        JSON.stringify({
          pnus: parcels.map((parcel) => parcel.pnu),
          siteAreaSqm: totalArea,
          center: getRawFeatureCenter(parcels[0].feature),
        })
      );
    } catch {
      // 세션 스토리지를 못 쓰는 환경이면 STEP 2에서 안내가 뜬다.
    }
  }, [parcels, totalArea]);

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

  function removeParcel(id: string) {
    const feature = selectedSourceRef.current?.getFeatureById(id);
    if (feature) selectedSourceRef.current.removeFeature(feature);
    setParcels((current) => current.filter((parcel) => parcel.id !== id));
    setMessage("선택 필지를 해제했습니다.");
  }

  // STEP 2로 넘긴다. 예전에는 Part2Launcher가 CAPACITY 탭 DOM을 긁어 값을 만들었지만,
  // 이제 STEP 1이 자기 상태에서 직접 스냅샷을 쓴다(2026-09-03).
  function goToStep2() {
    if (!parcels.length) return;
    const pnus = parcels.map((parcel) => parcel.pnu).filter((pnu) => /^\d{19}$/.test(pnu));
    try {
      const previous = sessionStorage.getItem("inrealtylab.part1Snapshot");
      const merged = {
        ...(previous ? JSON.parse(previous) : {}),
        pnus,
        siteAreaSqm: totalArea,
      };
      sessionStorage.setItem("inrealtylab.part1Snapshot", JSON.stringify(merged));
    } catch {
      // 스토리지를 못 쓰면 쿼리스트링만으로도 STEP 2는 동작한다.
    }
    window.location.href = `/control?pnus=${encodeURIComponent(pnus.join(","))}`;
  }

  function clearSelection() {
    selectedSourceRef.current?.clear();
    setParcels([]);
    setMessage("선택을 초기화했습니다.");
  }

  return (
    <main className="site-analyzer-shell">
      <div className="step-rail">
        <div className="step-item current"><span className="step-num">1</span>부지</div>
        <div className="step-line" />
        <div className="step-item"><span className="step-num">2</span>사업구조</div>
        <div className="step-line" />
        <div className="step-item"><span className="step-num">3</span>사업성</div>
      </div>

      <header className="site-analyzer-header">
        <div>
          <div className="product-kicker">인리얼티 · STEP 1 부지</div>
          <h1>토지의 종류부터 가립니다</h1>
          <p>국공유지인지 아닌지를 먼저 확인합니다. 국공유지만 다음 단계로 넘어갑니다.</p>
        </div>
        <div className="beta-chip">시범버전</div>
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
            <div className="map-legend">
              <span><i className="swatch public" />국공유지</span>
              <span><i className="swatch private" />민간</span>
              <span><i className="swatch unknown" />확인 중</span>
            </div>
            <button type="button" onClick={clearSelection} disabled={!parcels.length}>선택 초기화</button>
          </div>
          <div ref={mapElementRef} className="map-canvas" />
          <div className="map-status">{message}</div>
        </div>

        <aside className="analysis-panel">
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
                  // PNU는 내부 식별자라 화면에 노출하지 않는다. 확인이 필요하면 카드에 마우스를 올린다.
                  parcels.map((parcel, index) => (
                    <article className="parcel-card" key={parcel.id} title={`PNU ${parcel.pnu}`}>
                      <div className="parcel-card-head">
                        <span>필지 {index + 1}</span>
                        <button type="button" onClick={() => removeParcel(parcel.id)}>제거</button>
                      </div>
                      <dl>
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
                  <span>STEP 2</span>
                  <strong>사업구조</strong>
                  <p>용도지역·건폐율·용적률과 지을 수 있는 용도를 조회하고, 사업방식과 시설 구성을 정합니다.</p>
                  <button type="button" disabled={!parcels.length || siteOwnership === "LOADING"} onClick={goToStep2}>사업구조로</button>
                </div>
              )}

        </aside>
      </section>
    </main>
  );
}
