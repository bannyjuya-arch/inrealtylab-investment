# INRealtyLab Regulation Rule Engine

## Goal

Continuously ingest Korean policy and planning documents (HWP, PDF, DOCX, notices, ordinances, guidelines, 결정고시, 변경고시, 지구단위계획 결정도서) without hard-coding each new rule into application code.

The engine separates source facts from normalized rules and calculated outputs:

`Source Document -> Extracted Candidates -> Human Review -> Approved Rules -> Spatial Match -> Site Match -> Capacity Calculation -> Explanation + Trace`

## 1. Source document lifecycle

Every uploaded policy or notice document becomes a `RegulationDocument`.

Recommended lifecycle:

1. `UPLOADED` - original file stored, not interpreted yet
2. `EXTRACTED` - AI/parser produced structured candidates
3. `REVIEW_REQUIRED` - human review required before use
4. `APPROVED` - content checked
5. `ACTIVE` - rules may participate in live calculations
6. `SUPERSEDED` - replaced by a newer revision
7. `ARCHIVED` - retained for trace/history only
8. `REFERENCE_ONLY` - useful guidance or proposal but not a binding live rule

A document may contain mixed effective dates. Rule-level dates therefore override document-level dates when needed.

## 2. Document metadata

Store at minimum:

- title
- issuer
- jurisdiction
- document type
- publication type (고시, 공고, 방침, 조례, 지침, 결정도서, 변경결정 등)
- document number / notice number
- plan name / plan type
- change type (신규, 변경, 재정비, 폐지, 정정)
- decision date
- publication date
- effective start / end
- source system and official source URL
- source file name and MIME type
- immutable source hash
- original storage key or URL
- revision group and revision number
- extraction payload and extraction version
- reviewer / approver / timestamps

Do not overwrite old documents. New revisions are added as new records and older ones become `SUPERSEDED` where appropriate.

## 3. Notice and plan-document relations

Official planning records are often chains of notices rather than isolated files. Store document-to-document relations explicitly.

Supported relations:

- `AMENDS` - 변경고시가 기존 고시 일부 변경
- `SUPERSEDES` - 새 문서가 기존 문서를 대체
- `REPEALS` - 폐지
- `IMPLEMENTS` - 상위 방침/조례를 구체화
- `REFERENCES` - 참조
- `CORRECTS` - 정정고시
- `CONSOLIDATES` - 여러 개정사항 통합
- `RELATED_TO` - 기타 관련 문서

Never infer that a new notice completely supersedes an older one unless the source actually supports that interpretation.

## 4. Attachments and decision drawings

A notice may have several files that together form the authoritative source:

- 고시문 본문
- 결정조서
- 지형도면
- 지구단위계획 결정도
- 시행지침
- 용도지역/지구 결정도
- 교통처리계획도
- 건축계획 관련 부속도서
- 별표 / 산식표 / 인센티브표

Each file becomes a `RegulationDocumentAsset` rather than being flattened into one text field.

Store:

- asset type
- original filename
- MIME type
- hash
- page count
- source URL / storage key
- sequence
- extracted metadata

A rule should be able to point to the exact attachment that supports it.

## 5. Spatial applicability

Not every notice applies to an entire city. Create `RegulationSpatialScope` records for machine-evaluable spatial coverage.

Supported scope types include:

- country
- sido
- sigungu
- eup/myeon/dong
- administrative code
- exact PNU
- PNU prefix
- address
- named plan area
- bbox
- polygon
- custom scope

Where a decision drawing or GIS source provides a polygon, preserve the geometry or a durable reference to it. For text-only notices, use named plan areas/PNU lists and mark geometry confidence separately.

## 6. Rule model

One source document may generate many `RegulationRule` records.

Each rule stores:

- stable `ruleKey`
- version
- rule name
- rule kind
- jurisdiction
- applicability scope (`scopeJson`)
- normalized spatial-scope links
- conditions (`conditionJson`)
- value type and value
- optional formula
- combination mode
- priority
- effective dates
- transition / grandfathering conditions
- source attachment / section / page / excerpt
- extraction confidence
- review and approval history

### Rule kinds

Initial kinds:

- `BCR_LIMIT`
- `FAR_BASE`
- `FAR_ALLOWED`
- `FAR_MAX`
- `FAR_INCENTIVE`
- `FAR_FORMULA`
- `USE_RESTRICTION`
- `DISTRICT_PLAN`
- `OVERLAY`
- `TRANSITION`
- `EXCEPTION`
- `OTHER`

## 7. Applicability scope

`scopeJson` should be machine-evaluable and may include non-spatial conditions:

```json
{
  "country": "KR",
  "sido": ["서울특별시"],
  "zone": ["준주거지역"],
  "districtPlanRequired": true,
  "projectTypes": [],
  "excludedPrograms": []
}
```

Spatial boundaries that can be normalized should additionally be linked through `RegulationRuleScope`.

Avoid burying geography or applicability in prose only.

## 8. Conditions

`conditionJson` expresses what must be true before a rule applies.

Examples:

```json
{
  "all": [
    { "field": "districtPlan", "operator": "exists", "value": true },
    { "field": "openSpaceRatio", "operator": ">=", "value": 0.2 }
  ]
}
```

If a condition cannot be reliably computed from available data, mark the result `MANUAL_REVIEW` rather than assuming it is satisfied.

## 9. Values and formulas

Do not store every rule as a single percentage. Different documents use different semantics.

### Fixed FAR

```json
{
  "valueType": "PERCENT",
  "valueJson": { "percent": 400 }
}
```

### Additional percentage points

```json
{
  "valueType": "PERCENT_POINT",
  "valueJson": { "points": 40 }
}
```

### Multiplier

```json
{
  "valueType": "MULTIPLIER",
  "valueJson": { "factor": 1.1 }
}
```

### Formula

```json
{
  "valueType": "FORMULA",
  "formula": "allowedFar + ordinanceFar * relaxationRate"
}
```

Store formulas in a restricted, auditable expression language. Never execute arbitrary source text as code.

## 10. Combining rules

`combineMode` controls how overlapping rules interact.

- `OVERRIDE` - a more specific rule replaces a general rule
- `ADD` - additive incentive
- `MAX` - choose the higher result
- `MIN` - choose the stricter result
- `EXCLUSIVE` - cannot combine with another matched rule
- `FIRST_MATCH` - use highest-priority matching rule
- `MANUAL_REVIEW` - do not auto-calculate

Specific plans and legally binding local rules should generally outrank generic statutory defaults, but priority must be explicit and traceable rather than assumed globally.

## 11. Effective dates and transition rules

Each rule needs independent temporal logic:

- `effectiveFrom`
- `effectiveTo`
- transition rules
- grandfathering
- whether only newly established / renewed districts are affected
- whether existing plans remain valid
- whether an individual parcel proposal can elect into the new framework

A rule is not active merely because its source document has a decision date.

## 12. Approval policy

AI extraction is never authoritative by itself.

A rule can participate in REGULATION/CAPACITY calculations only when:

- rule status is `ACTIVE`
- source document status is `ACTIVE`
- current analysis date falls within effective dates
- applicability scope matches the site/project
- mandatory conditions are satisfied

Draft, proposed, review-only, or implementation-pending documents should remain `REFERENCE_ONLY` or `REVIEW_REQUIRED` until verified.

## 13. Source trace

Every displayed regulation or capacity result should be able to answer:

- What rule was applied?
- Why did it match this parcel?
- Which notice/document did it come from?
- Which attachment and page/section supports it?
- Which spatial boundary matched the PNU?
- Which prior notice did this notice amend or replace?
- What version was active on the analysis date?
- Was the value statutory, ordinance-based, plan-specific, policy incentive, exception, or analyst assumption?

Recommended calculation output shape:

```json
{
  "metric": "FAR",
  "base": 400,
  "adjustments": [
    {
      "ruleKey": "SEOUL_DCP_ALLOWED_FAR_1_1X",
      "effect": "+40%p",
      "sourceDocumentId": "...",
      "sourceAssetId": "...",
      "spatialScopeId": "..."
    }
  ],
  "final": 440,
  "status": "REVIEWED",
  "trace": []
}
```

## 14. Example: 2024 Seoul district-plan FAR reform document

The uploaded Seoul document demonstrates why temporal and conditional structure is required.

Candidate normalized rules include:

- broaden individual-law FAR relaxation items across district-plan areas
- permit allowed-FAR incentives up to 1.1 times ordinance FAR for qualifying areas
- remove lowered base FAR treatment for semi-residential / commercial zones in the proposed framework
- proposed zone-specific base / allowed / maximum FAR tables
- individual-law maximum FAR formula using ordinance FAR and relaxation rate
- overlap ceilings, including a different ceiling for semi-industrial zones
- special-program exceptions where separate FAR systems apply
- implementation dependencies on amendment of the Seoul ordinance / enforcement rules
- transition treatment for new, renewed, already-decided, and publicly-inspected district plans

These should not be represented as one global `Seoul FAR` number.

## 15. Future ingestion workflow for notices

Future `규정자료 관리` screen:

1. Upload HWP/PDF/DOCX or register official URL
2. Detect document type and metadata
3. Detect notice number / plan name / change type
4. Extract attachments and identify decision drawings
5. Extract rule candidates
6. Extract or link spatial scopes
7. Compare against existing active documents and rules
8. Detect `AMENDS / SUPERSEDES / REPEALS / CORRECTS` candidates
9. Highlight additions / changes / deletions / conflicts
10. Reviewer verifies metadata, scope, dates, and relationships
11. Approver activates selected rules
12. Previous rules/documents are superseded where explicitly supported, not deleted
13. REGULATION and CAPACITY use the newly active version

## 16. Recommended operational folders/categories

Logical categories in the admin UI:

- 국가 법령 / 시행령 / 시행규칙
- 지자체 조례 / 시행규칙
- 도시계획 방침 / 운영기준
- 도시관리계획 결정(변경)고시
- 지구단위계획 결정(변경)고시
- 지구단위계획 시행지침
- 용도지역·지구·구역 고시
- 정비계획 / 도시개발 / 역세권 등 사업별 고시
- 인센티브 / 특례 / 공공기여 기준
- 참고자료 / 검토안 / 미시행안

## 17. Safety rules

- Never silently promote a proposal into an active regulation.
- Never overwrite original source files.
- Never delete superseded rules needed to reproduce past analyses.
- Never hide conflicting sources; surface conflicts for review.
- Never let AI-generated prose become a calculation formula without structured review.
- Never assume a notice applies citywide when its plan area is narrower.
- Never infer repeal/supersession without supporting source text.
- Always distinguish statutory limit, local ordinance, district plan, incentive, exception, and analyst scenario.
