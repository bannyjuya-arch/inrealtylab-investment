import type { ReactNode } from "react";

const bootstrapPart1 = `
(function () {
  try {
    var params = new URLSearchParams(window.location.search);
    var raw = params.get("part1");
    if (!raw) return;

    var snapshot = JSON.parse(raw);

    if (!(typeof snapshot.siteAreaSqm === "number" && isFinite(snapshot.siteAreaSqm) && snapshot.siteAreaSqm > 0)) {
      var candidates = [];
      var scenarios = Array.isArray(snapshot.scenarios) ? snapshot.scenarios : [];

      scenarios.forEach(function (scenario) {
        var far = Number(scenario && scenario.farPct);
        var gfa = Number(scenario && scenario.grossFloorAreaSqm);
        if (far > 0 && gfa > 0) candidates.push(gfa / (far / 100));

        var bcr = Number(scenario && scenario.bcrPct);
        var footprint = Number(scenario && scenario.footprintSqm);
        if (bcr > 0 && footprint > 0) candidates.push(footprint / (bcr / 100));
      });

      candidates = candidates.filter(function (value) {
        return isFinite(value) && value > 0;
      }).sort(function (a, b) { return a - b; });

      if (candidates.length) {
        var mid = Math.floor(candidates.length / 2);
        var derived = candidates.length % 2
          ? candidates[mid]
          : (candidates[mid - 1] + candidates[mid]) / 2;
        snapshot.siteAreaSqm = Math.round(derived);
      }
    }

    sessionStorage.setItem("inrealtylab.part1Snapshot", JSON.stringify(snapshot));
  } catch (error) {
    console.warn("INRealtyLab Part 1 report restore failed", error);
  }
})();
`;

export default function ReportLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: bootstrapPart1 }} />
      {children}
    </>
  );
}
