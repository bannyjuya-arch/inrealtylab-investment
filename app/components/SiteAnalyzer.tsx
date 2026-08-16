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

export default function SiteAnalyzer() {
  const mapElementRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const selectedSourceRef = useRef<any>(null);
  const olRef = useRef<any>(null);

  const [query, setQuery] = useState("서울특별시 성동구 행당동");
  const [message, setMessage] = useState("지도에서 분석할 필지를 선택하세요.");
  const [loading, setLoading] = useState(false);
  const [cadastreVisible, setCadastreVisible] = useState(true);
  const [parcels, setParcels] = useState<SelectedParcel[]>([]);

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

        const selectedLayer = new ol.layer.Vector({
          source: selectedSource,
          style: new ol.style.Style({
            stroke: new ol.style.Stroke({ color: "#0f62fe", width: 3 }),
            fill: new ol.style.Fill({ color: "rgba(15, 98, 254, 0.18)" }),
          }),
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

      // ol.sphere.getArea assumes EPSG:3857 by default, and this feature has
      // already been reprojected to EPSG:3857 by GeoJSON.readFeature above.
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
        <div className="beta-chip">CORE v0.2</div>
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
            <button className="active">SITE</button>
            <button disabled>REGULATION</button>
            <button disabled>CAPACITY</button>
          </div>

          <div className="analysis-summary">
            <span>선택 필지</span>
            <strong>{parcels.length}필지</strong>
          </div>
          <div className="analysis-summary">
            <span>통합 대지면적</span>
            <strong>{totalArea.toLocaleString("ko-KR")}㎡</strong>
            <small>{(totalArea / 3.305785).toLocaleString("ko-KR", { maximumFractionDigits: 1 })}평</small>
          </div>

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
                  </dl>
                </article>
              ))
            )}
          </div>

          <div className="next-step-card">
            <span>NEXT</span>
            <strong>법적 규제 분석</strong>
            <p>선택된 PNU를 기준으로 용도지역·지구·구역, 도시계획시설과 건폐율·용적률을 연결합니다.</p>
            <button type="button" disabled>다음 개발 단계</button>
          </div>
        </aside>
      </section>
    </main>
  );
}
