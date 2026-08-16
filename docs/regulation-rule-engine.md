# INRealtyLab Regulation Rule Engine

## Goal

Continuously ingest Korean policy and planning documents (HWP, PDF, DOCX, notices, ordinances, guidelines) without hard-coding each new rule into application code.

The engine separates source facts from normalized rules and calculated outputs:

`Source Document -> Extracted Candidates -> Human Review -> Approved Rules -> Site Matching -> Capacity Calculation -> Explanation + Trace`

## 1. Source document lifecycle

Every uploaded policy document becomes a `RegulationDocument`.

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
- document number / decision number
- decision date
- publication date
- effective start / end
- source file name and MIME type
- immutable source hash
- original storage key or URL
- revision group and revision number
- extraction payload and extraction version
- reviewer / approver / timestamps

Do not overwrite old documents. New revisions are added as new records and older ones become `SUPERSEDED` where appropriate.

## 3. Rule model

One source document may generate many `RegulationRule` records.

Each rule stores:

- stable `ruleKey`
- version
- rule name
- rule kind
- jurisdiction
- applicability scope (`scopeJson`)
- conditions (`conditionJson`)
- value type and value
- optional formula
- combination mode
- priority
- effective dates
- transition / grandfathering conditions
- source section / page / excerpt
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

## 4. Applicability scope

`scopeJson` should be machine-evaluable and may include:

```json
{
  "country": "KR",
  "sido": ["서울특별시"],
  "sigungu": [],
  "zone": ["준주거지역"],
  "districtPlanRequired": true,
  "projectTypes": [],
  "excludedPrograms": []
}
```

Avoid burying geography or applicability in prose only.

## 5. Conditions

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

## 6. Values and formulas

Do not store every rule as a single percentage. Different documents use different semantics.

Examples:

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

## 7. Combining rules

`combineMode` controls how overlapping rules interact.

- `OVERRIDE` - a more specific rule replaces a general rule
- `ADD` - additive incentive
- `MAX` - choose the higher result
- `MIN` - choose the stricter result
- `EXCLUSIVE` - cannot combine with another matched rule
- `FIRST_MATCH` - use highest-priority matching rule
- `MANUAL_REVIEW` - do not auto-calculate

Specific plans and legally binding local rules should generally outrank generic statutory defaults, but priority must be explicit and traceable rather than assumed globally.

## 8. Effective dates and transition rules

Each rule needs independent temporal logic:

- `effectiveFrom`
- `effectiveTo`
- transition rules
- grandfathering
- whether only newly established / renewed districts are affected
- whether existing plans remain valid
- whether an individual parcel proposal can elect into the new framework

A rule is not active merely because its source document has a decision date.

## 9. Approval policy

AI extraction is never authoritative by itself.

A rule can participate in REGULATION/CAPACITY calculations only when:

- rule status is `ACTIVE`
- source document status is `ACTIVE`
- current analysis date falls within effective dates
- applicability scope matches the site/project
- mandatory conditions are satisfied

Draft, proposed, review-only, or implementation-pending documents should remain `REFERENCE_ONLY` or `REVIEW_REQUIRED` until verified.

## 10. Source trace

Every displayed regulation or capacity result should be able to answer:

- What rule was applied?
- Why did it match this parcel?
- Which document did it come from?
- Which page/section supports it?
- What version was active on the analysis date?
- Was the value statutory, ordinance-based, plan-specific, policy incentive, or analyst assumption?

Recommended calculation output shape:

```json
{
  "metric": "FAR",
  "base": 400,
  "adjustments": [
    {
      "ruleKey": "SEOUL_DCP_ALLOWED_FAR_1_1X",
      "effect": "+40%p",
      "sourceDocumentId": "..."
    }
  ],
  "final": 440,
  "status": "REVIEWED",
  "trace": []
}
```

## 11. Example: 2024 Seoul district-plan FAR reform document

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

## 12. Planned admin workflow

Future `규정자료 관리` screen:

1. Upload HWP/PDF/DOCX
2. Show document metadata candidate
3. Extract rule candidates
4. Compare against existing active rules
5. Highlight additions / changes / deletions / conflicts
6. Reviewer edits structured fields
7. Approver activates selected rules
8. Previous rules are superseded, not deleted
9. REGULATION and CAPACITY immediately use the newly active version

## 13. Safety rules

- Never silently promote a proposal into an active regulation.
- Never overwrite original source files.
- Never delete superseded rules needed to reproduce past analyses.
- Never hide conflicting sources; surface conflicts for review.
- Never let AI-generated prose become a calculation formula without structured review.
- Always distinguish statutory limit, local ordinance, district plan, incentive, exception, and analyst scenario.
