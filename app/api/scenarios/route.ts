import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const {
      projectName,
      siteName,
      address,
      scenarioName,
      mode,
      siteJson,
      inputJson,
      summaryJson,
      cashflowJson,
      sensitivityJson,
      comparisonJson,
      warningsJson,
    } = body;

    const project = await db.project.create({
      data: {
        name: projectName ?? "기본 프로젝트",
        siteName,
        address,
      },
    });

    const scenario = await db.scenario.create({
      data: {
        projectId: project.id,
        name: scenarioName ?? "기본 시나리오",
        mode: mode ?? "simulator",
        siteJson: siteJson ?? {},
        inputJson: inputJson ?? {},
      },
    });

    const result = await db.scenarioResult.create({
      data: {
        scenarioId: scenario.id,
        summaryJson: summaryJson ?? {},
        cashflowJson: cashflowJson ?? [],
        sensitivityJson: sensitivityJson ?? null,
        comparisonJson: comparisonJson ?? null,
        warningsJson: warningsJson ?? [],
      },
    });

    return NextResponse.json({
      ok: true,
      project,
      scenario,
      result,
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { ok: false, message: "시나리오 저장 실패" },
      { status: 500 }
    );
  }
}