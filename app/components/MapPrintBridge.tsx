"use client";

import { useEffect } from "react";

const MAP_IMAGE_KEY = "inrealtylab.part1MapImage";

function parseTransform(transform: string) {
  const match = transform.match(/^matrix\(([^)]+)\)$/);
  if (!match) return null;
  const values = match[1].split(",").map((value) => Number(value.trim()));
  return values.length === 6 && values.every(Number.isFinite) ? values : null;
}

function captureOpenLayersMap() {
  const mapElement = document.querySelector<HTMLElement>(".map-canvas");
  if (!mapElement) return null;

  const width = Math.max(1, Math.round(mapElement.clientWidth));
  const height = Math.max(1, Math.round(mapElement.clientHeight));
  const exportCanvas = document.createElement("canvas");
  exportCanvas.width = width;
  exportCanvas.height = height;

  const context = exportCanvas.getContext("2d");
  if (!context) return null;

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);

  const canvases = Array.from(mapElement.querySelectorAll<HTMLCanvasElement>("canvas"));
  if (!canvases.length) return null;

  for (const canvas of canvases) {
    if (!canvas.width || !canvas.height) continue;

    const parent = canvas.parentElement as HTMLElement | null;
    const opacityText = parent?.style.opacity || canvas.style.opacity || "1";
    const opacity = Number(opacityText);
    context.globalAlpha = Number.isFinite(opacity) ? opacity : 1;

    const matrix = parseTransform(canvas.style.transform);
    if (matrix) {
      context.setTransform(matrix[0], matrix[1], matrix[2], matrix[3], matrix[4], matrix[5]);
    } else {
      const cssWidth = Number.parseFloat(canvas.style.width) || canvas.width;
      const cssHeight = Number.parseFloat(canvas.style.height) || canvas.height;
      context.setTransform(cssWidth / canvas.width, 0, 0, cssHeight / canvas.height, 0, 0);
    }

    const background = parent?.style.backgroundColor || canvas.style.backgroundColor;
    if (background) {
      context.fillStyle = background;
      context.fillRect(0, 0, canvas.width, canvas.height);
    }

    context.drawImage(canvas, 0, 0);
  }

  context.globalAlpha = 1;
  context.setTransform(1, 0, 0, 1, 0, 0);

  try {
    return exportCanvas.toDataURL("image/jpeg", 0.9);
  } catch {
    return null;
  }
}

function saveCurrentMap() {
  const image = captureOpenLayersMap();
  if (!image) return;
  try {
    sessionStorage.setItem(MAP_IMAGE_KEY, image);
  } catch {
    // Continue the analysis even if browser storage is unavailable.
  }
}

function installReportMap() {
  let image: string | null = null;
  try {
    image = sessionStorage.getItem(MAP_IMAGE_KEY);
  } catch {
    return;
  }
  if (!image) return;

  const placeholder = document.querySelector<HTMLElement>(".report-map-placeholder");
  if (!placeholder) return;

  let img = placeholder.querySelector<HTMLImageElement>("img[data-print-map='true']");
  if (!img) {
    img = document.createElement("img");
    img.dataset.printMap = "true";
    img.alt = "선택 필지 지도";
    img.style.width = "100%";
    img.style.height = "100%";
    img.style.minHeight = "260px";
    img.style.objectFit = "cover";
    img.style.display = "block";
    img.style.borderRadius = "12px";
    img.style.printColorAdjust = "exact";
    (img.style as CSSStyleDeclaration & { webkitPrintColorAdjust?: string }).webkitPrintColorAdjust = "exact";

    const label = placeholder.firstElementChild as HTMLElement | null;
    if (label) label.style.display = "none";
    placeholder.style.padding = "0";
    placeholder.style.overflow = "hidden";
    placeholder.style.borderStyle = "solid";
    placeholder.appendChild(img);
  }
  img.src = image;
}

export default function MapPrintBridge() {
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const button = target?.closest("button");
      if (button?.textContent?.includes("소유 · 사업추진 분석")) saveCurrentMap();
    };

    document.addEventListener("click", onClick, true);
    window.addEventListener("beforeprint", installReportMap);

    const timer = window.setTimeout(installReportMap, 0);

    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("beforeprint", installReportMap);
    };
  }, []);

  return null;
}
