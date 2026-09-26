"use client";

// 2026-09-26: 보고서를 이메일 PDF로 보내기 위해, 방문자가 보고 있는 보고서 화면을
// 스스로 완결된 HTML 한 장으로 굳힌다. 서버(/api/report-lead)가 이 HTML을
// 헤드리스 크롬으로 열어 "인쇄 / PDF"와 같은 인쇄 CSS로 PDF를 만든다.
// - 스타일시트는 규칙 텍스트로 인라인 (서버는 외부 요청을 막는다)
// - OpenLayers 지도 캔버스는 JPEG 이미지로 바꿔 넣는다
// - 입력칸의 현재 값은 속성으로 옮겨 적는다 (cloneNode는 value를 옮기지 않는다)

import { captureOpenLayersMap } from "../components/MapPrintBridge";

function collectCss() {
  const chunks: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      chunks.push(Array.from(sheet.cssRules, (rule) => rule.cssText).join("\n"));
    } catch {
      // 다른 출처의 스타일시트는 읽을 수 없다. 보고서 스타일은 모두 같은 출처라 건너뛴다.
    }
  }
  return chunks.join("\n");
}

function copyFormValues(source: HTMLElement, clone: HTMLElement) {
  const sourceFields = source.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
    "input, select, textarea",
  );
  const cloneFields = clone.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
    "input, select, textarea",
  );
  sourceFields.forEach((field, index) => {
    const target = cloneFields[index];
    if (!target) return;
    if (field instanceof HTMLInputElement && target instanceof HTMLInputElement) {
      if (field.type === "checkbox" || field.type === "radio") {
        target.toggleAttribute("checked", field.checked);
      } else {
        target.setAttribute("value", field.value);
      }
    } else if (field instanceof HTMLSelectElement && target instanceof HTMLSelectElement) {
      Array.from(target.options).forEach((option, optionIndex) => {
        option.toggleAttribute("selected", optionIndex === field.selectedIndex);
      });
    } else if (target instanceof HTMLTextAreaElement) {
      target.textContent = field.value;
    }
  });
}

export function buildReportSnapshotHtml(): string | null {
  const shell = document.querySelector<HTMLElement>(".report-shell");
  if (!shell) return null;

  const clone = shell.cloneNode(true) as HTMLElement;
  copyFormValues(shell, clone);

  clone.querySelectorAll(".no-print, script, noscript, iframe").forEach((node) => node.remove());
  if (!shell.classList.contains("is-admin")) {
    clone.querySelectorAll(".admin-only").forEach((node) => node.remove());
  }

  const mapImage = captureOpenLayersMap(".report-map-canvas");
  const mapHolder = clone.querySelector<HTMLElement>(".report-map-canvas");
  if (mapHolder) {
    mapHolder.replaceChildren();
    if (mapImage) {
      const img = document.createElement("img");
      img.src = mapImage;
      img.alt = "선택 필지 지도";
      img.setAttribute("style", "display:block;width:100%;height:100%;object-fit:cover");
      mapHolder.appendChild(img);
    }
  }

  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><style>${collectCss()}</style></head><body>${clone.outerHTML}</body></html>`;
}
