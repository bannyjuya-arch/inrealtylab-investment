"use client";

// 보고서 1면 지도 (2026-09-05 신설)
//
// 이전 방식: STEP 1에서 "소유 · 사업추진 분석" 버튼을 누르는 순간 OpenLayers 캔버스를
// JPEG로 캡처해 sessionStorage에 넣어두고, 보고서에서 그 이미지를 <img>로 꽂았다
// (MapPrintBridge). 버튼 문구가 바뀌거나, 그 버튼을 안 거치고 보고서로 들어오거나,
// 캔버스를 읽지 못하면 지도가 통째로 사라진다. 실제로 사라지고 있었다.
//
// 지금 방식: 보고서가 자기 지도를 직접 그린다. STEP 1이 남긴 필지 도형을 읽어
// 같은 배경지도·지적도 위에 다시 렌더링한다. 캡처 시점에 의존하지 않는다.

import { useEffect, useRef, useState } from "react";

const OPENLAYERS_JS = "https://cdn.jsdelivr.net/npm/ol@10.9.0/dist/ol.js";
const OPENLAYERS_CSS = "https://cdn.jsdelivr.net/npm/ol@10.9.0/ol.css";

/* eslint-disable @typescript-eslint/no-explicit-any */

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
        existing.addEventListener("load", () => resolve((window as any).ol));
        existing.addEventListener("error", () => reject(new Error("지도 라이브러리를 불러오지 못했습니다.")));
      }
      return;
    }
    const script = document.createElement("script");
    script.src = OPENLAYERS_JS;
    script.async = true;
    script.onload = () => resolve((window as any).ol);
    script.onerror = () => reject(new Error("지도 라이브러리를 불러오지 못했습니다."));
    document.head.appendChild(script);
  });
}

type Step1 = {
  pnus?: string[];
  center?: { lon: number; lat: number } | null;
  features?: any[];
};

function readStep1(): Step1 | null {
  try {
    const raw = sessionStorage.getItem("inrealtylab.step1");
    return raw ? (JSON.parse(raw) as Step1) : null;
  } catch {
    return null;
  }
}

/** STEP 1이 도형을 남기지 않은 예전 세션이면 중심좌표로 필지를 다시 조회한다. */
async function refetchByCenter(center: { lon: number; lat: number }) {
  const response = await fetch(
    `/api/cadastre?lon=${encodeURIComponent(center.lon)}&lat=${encodeURIComponent(center.lat)}`,
    { cache: "no-store" }
  );
  const data = await response.json();
  if (!response.ok || !data?.ok) throw new Error(data?.message ?? "필지 도형을 불러오지 못했습니다.");
  return (data.featureCollection?.features ?? []) as any[];
}

export default function ReportMap({ parcelCount }: { parcelCount: number }) {
  const holderRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const [status, setStatus] = useState<"LOADING" | "READY" | "EMPTY" | "ERROR">("LOADING");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const step1 = readStep1();
      let features = Array.isArray(step1?.features) ? step1!.features! : [];

      if (!features.length && step1?.center) {
        try {
          features = await refetchByCenter(step1.center);
        } catch {
          features = [];
        }
      }

      if (cancelled) return;
      if (!features.length) {
        setStatus("EMPTY");
        return;
      }

      let ol: any;
      try {
        ol = await ensureOpenLayers();
      } catch (error) {
        if (!cancelled) {
          setStatus("ERROR");
          setMessage(error instanceof Error ? error.message : "지도를 불러오지 못했습니다.");
        }
        return;
      }
      if (cancelled || !holderRef.current) return;

      const source = new ol.source.Vector();
      for (const raw of features) {
        if (!raw?.geometry) continue;
        try {
          source.addFeature(
            new ol.format.GeoJSON().readFeature(raw, {
              dataProjection: "EPSG:4326",
              featureProjection: "EPSG:3857",
            })
          );
        } catch {
          // 도형 하나가 깨져도 나머지는 그린다
        }
      }

      if (!source.getFeatures().length) {
        setStatus("EMPTY");
        return;
      }

      const map = new ol.Map({
        target: holderRef.current,
        controls: [],
        interactions: [],
        layers: [
          new ol.layer.Tile({ source: new ol.source.OSM() }),
          // 지적도. STEP 1 화면과 같은 레이어를 써야 보고서와 화면이 같은 그림이 된다.
          new ol.layer.Tile({
            opacity: 0.85,
            source: new ol.source.TileWMS({
              url: "/api/vworld-wms",
              params: {
                SERVICE: "WMS",
                REQUEST: "GetMap",
                VERSION: "1.3.0",
                LAYERS: "lt_c_landinfobasemap",
                STYLES: "lt_c_landinfobasemap",
                FORMAT: "image/png",
                TRANSPARENT: true,
                CRS: "EPSG:3857",
              },
              crossOrigin: "anonymous",
            }),
          }),
          new ol.layer.Vector({
            source,
            style: new ol.style.Style({
              stroke: new ol.style.Stroke({ color: "#14453A", width: 3.5 }),
              fill: new ol.style.Fill({ color: "rgba(62, 125, 101, 0.45)" }),
            }),
          }),
        ],
        view: new ol.View({ center: [14135000, 4518000], zoom: 17 }),
      });

      map.getView().fit(source.getExtent(), {
        padding: [26, 26, 26, 26],
        maxZoom: 18,
      });

      mapRef.current = map;
      setStatus("READY");

      // 인쇄 시점에 지면 크기로 다시 그리지 않으면 캔버스가 화면 크기 그대로 잘린다.
      const onBeforePrint = () => {
        map.updateSize();
        map.renderSync();
      };
      window.addEventListener("beforeprint", onBeforePrint);
      map.once("rendercomplete", () => map.updateSize());

      return () => window.removeEventListener("beforeprint", onBeforePrint);
    })();

    return () => {
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.setTarget(undefined);
        mapRef.current = null;
      }
    };
  }, []);

  if (status === "EMPTY" || status === "ERROR") {
    return (
      <div className="report-map-placeholder">
        <div>
          <strong>선택 필지 지도영역</strong>
          <span>
            {status === "ERROR"
              ? message
              : parcelCount
                ? "현황분석에서 필지를 선택한 뒤 보고서를 열면 지도가 표시됩니다."
                : `선택 필지 ${parcelCount || "-"}개`}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="report-map">
      <div ref={holderRef} className="report-map-canvas" />
      {status === "LOADING" && (
        <div className="report-map-loading">지도를 불러오는 중입니다</div>
      )}
    </div>
  );
}
