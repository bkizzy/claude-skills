# RFP Scoring Rubric

This is the scoring method for the rfp-evaluator skill. It replaces the original tool's broken math (which capped sub-scores at a criterion's weight, then applied a 0–100 formula on top — so the total meant nothing). Here every criterion is scored on the same 0–100 scale, weighted, and summed. A separate gate layer catches dealbreakers a weighted average would otherwise smooth over.

## Table of contents
1. The six criteria and weights
2. Per-criterion anchors (0 / 50 / 100)
3. Red-flag gates (score ceilings)
4. Computing the final score
5. RFP X-Ray dimensions

---

## 1. The six criteria and weights

| # | Criterion | Default weight | Question it answers |
|---|-----------|--------|---------------------|
| 1 | Budget Clarity & Fit | 30% | Is the budget stated, realistic, and a fit for an engagement we'd want? |
| 2 | Scope Definition | 25% | Are the deliverables clear, complete, and bounded? |
| 3 | Timeline Feasibility | 15% | Can the work actually be done in the time given? |
| 4 | Client Goals & Success Metrics | 10% | Is "success" defined, and is there a real reason this project exists? |
| 5 | Decision Process Transparency | 10% | Do we know how, when, and by whom the winner is chosen? |
| 6 | Legal / Risk Factors | 10% | Are the terms standard, or are there landmines (IP, liability, indemnity)? |

The weights above are the **default** (used when the user expresses no preference). The six always sum to 100%, and Budget + Scope lead by default because they most determine whether a response is worth writing and whether the engagement is profitable.

### Applying the user's priorities (slot rule)

The skill asks the user which factors matter most. Re-weight deterministically so their picks get the biggest slots, while the weights still sum to 100:

1. Take the fixed weight **slots** `[30, 25, 15, 10, 10, 10]`.
2. Order the six criteria: the user's chosen priorities **first** (keeping the default order #1–6 to break ties among them), then the remaining criteria in default order.
3. Assign the slots top-to-bottom to that ordering.

**Example.** User prioritizes *Legal* and *Timeline*. Chosen, in default order: Timeline, Legal. Remaining, in default order: Budget, Scope, Goals, Process.
Ordering → Timeline, Legal, Budget, Scope, Goals, Process. Slots → Timeline 30, Legal 25, Budget 15, Scope 10, Goals 10, Process 10. (Sum 100.)

If the user picks nothing / "no strong preference," use the default row. Always state the resulting weights in the report.

---

## 2. Per-criterion anchors

Score each criterion 0–100. Use these anchors as reference points and interpolate. Always tie the score to evidence (page/section/figure). When the document is silent on something, that *lowers* the score and becomes a clarification to request — don't award benefit of the doubt.

### 1. Budget Clarity & Fit (30%)
- **0–20** — No budget, range, or ceiling anywhere; no stated mechanism to discuss it.
- **30–50** — A vague signal only ("competitive budget", "TBD at SOW"), or a number with no scope to anchor it.
- **55–70** — A range or "not to exceed" figure is given and is plausibly workable.
- **75–90** — Clear budget or band, tied to scope, realistic for the work described.
- **90–100** — Clear, realistic budget *and* it's a strong fit for the kind of engagement an agency wants (size, margin, payment terms sane).

### 2. Scope Definition (25%)
- **0–20** — "We'll figure it out together" — deliverables essentially undefined.
- **30–50** — Broad themes named, but deliverables, boundaries, and exclusions are fuzzy; high scope-creep risk.
- **55–70** — Deliverables listed and mostly clear; some gaps in exclusions or acceptance criteria.
- **75–90** — Deliverables, phases, integrations, and exclusions are explicit and internally consistent.
- **90–100** — Above, plus clear acceptance criteria and a change-control mechanism.

### 3. Timeline Feasibility (15%)
- **0–20** — Deadline already passed, or duration is impossible for the scope (check the Gantt, not just the prose).
- **30–50** — Aggressive to the point of high risk; milestones bunched or dependencies ignored.
- **55–70** — Tight but achievable with focus; some slack missing.
- **75–90** — Realistic schedule with sensible milestone spacing.
- **90–100** — Realistic *and* well-structured, with buffer and clear dependencies shown.

### 4. Client Goals & Success Metrics (10%)
- **0–20** — No stated goal or measure of success; project rationale absent.
- **30–50** — A general aim, but nothing measurable.
- **55–70** — Clear goals; partial or qualitative success metrics.
- **75–90** — Specific, measurable success criteria tied to the goals.
- **90–100** — Measurable criteria plus a clear "why now" and how success will be judged.

### 5. Decision Process Transparency (10%)
- **0–20** — No evaluation criteria, no timeline, no named decision-maker — high ghosting risk.
- **30–50** — Vague process ("we'll review and follow up"); criteria not weighted.
- **55–70** — Criteria listed and a decision timeline given; weights partial.
- **75–90** — Weighted criteria, clear stages (shortlist/interview/award), dates.
- **90–100** — Fully transparent: weighted criteria, named evaluators, every date, and feedback mechanism.

### 6. Legal / Risk Factors (10%)
Score from the *absence* of risk — a clean RFP scores high here.
- **0–20** — Hostile terms present: unlimited liability, full assignment of pre-existing IP, broad indemnity, unpaid spec work required. (Also triggers a gate — see below.)
- **30–50** — Several non-standard or one-sided clauses needing negotiation.
- **55–70** — Mostly standard with a few items to clarify.
- **75–90** — Standard, balanced terms.
- **90–100** — Clean, balanced, professionally drafted; nothing concerning.

---

## 3. Red-flag gates (score ceilings)

A weighted average can hide a single fatal flaw — an RFP can score 78 on the rubric while quietly requiring you to assign all your background IP. Gates fix that: when a dealbreaker is present, it **caps the overall score** no matter how good everything else is, and must appear prominently in the report's red-flags section with its evidence.

| Gate | Trigger | Ceiling |
|------|---------|---------|
| No budget, no path to one | No budget/range/ceiling **and** no stated mechanism to discuss it. You can't assess fit at all. | 59 (Red) |
| Hostile legal terms | Unlimited liability, assignment of pre-existing/background IP, broad uncapped indemnity, or onerous non-standard terms. | 59 (Red) |
| Dead or impossible deadline | Submission deadline already passed, or under ~48 hours for non-trivial scope. | 49 (Red) |
| Wired for incumbent | Strong signals the outcome is predetermined (requirements only an incumbent meets, reference/experience bars set to exclude, re-bid language favoring the holder). | 59 (Red) |
| Pay-to-play / spec work | Substantial unpaid creative or strategic work required just to compete. | 59 (Red) |

Notes:
- A gate sets a *ceiling*, not the score. If the weighted total is already below the ceiling, the total stands.
- Multiple gates → use the **lowest** ceiling.
- Use judgment on ambiguous triggers; if a gate "almost" fires, don't cap, but raise it as a top yellow flag and a clarification to request.

---

## 4. Computing the final score

1. `weighted_total = Σ (criterion_score × weight)` → 0–100.
2. Determine `gate_ceiling` = the lowest ceiling among triggered gates (or 100 if none).
3. `overall_score = min(weighted_total, gate_ceiling)`.
4. Map to color: Green 80–100, Yellow 60–79, Red <60.
5. In the report, always show `weighted_total` and `overall_score`. If they differ, state which gate(s) pulled it down and why — that gap is one of the most useful things in the whole report.

**Worked example.** Budget 70, Scope 80, Timeline 60, Goals 75, Process 65, Legal 15.
weighted = 70·.30 + 80·.25 + 60·.15 + 75·.10 + 65·.10 + 15·.10 = 21 + 20 + 9 + 7.5 + 6.5 + 1.5 = **65.5** (Yellow on the rubric alone).
But Legal 15 reflects an unlimited-liability clause → Hostile-legal gate fires, ceiling 59. **Overall = 59 (Red).** The report leads with: "Rubric score 66, but a no-cap liability clause (p.22) caps this at 59 — Red. Negotiating that single clause would move this back to Yellow."

This is the behavior the user asked for: the score makes sense *and* it's valuable, because one buried clause can't masquerade as a healthy opportunity.

---

## 5. RFP X-Ray dimensions

Six strategic reads that go beyond scoring. Each is one short paragraph: a one-line read plus 3–5 evidence-cited sentences, or an explicit "Not specified in RFP." No web search — document only.

1. **Competitiveness** — Open call vs invite-only, likely pool size, whether interviews/workshops are part of selection. *Look for:* distribution language, pre-qualification, named invitees. If pool size isn't determinable from the document, say so — do not estimate a market you can't see.
2. **Continuity or change** — Is the client seeking continuity with an incumbent or a clean reset? *Look for:* references to current vendors/systems, "maintain" vs "redesign/replace", migration requirements.
3. **Motivation** — Why is this happening now? *Look for:* leadership change, new program, grant/funding deadline, a prior failure, regulatory driver, stated background.
4. **Engagement style** — Strategic partner or transactional vendor? *Look for:* discovery/co-creation/workshops and backlog ownership (partner) vs fixed-scope-deliver-and-leave language (transactional).
5. **Decision process** — How and when is the winner chosen? *Look for:* weighted criteria, presentations/demos/POCs, the evaluation table (read it off the figure if it's a table), and every date.
6. **Governance** — Who actually steers scope and acceptance? *Look for:* named roles/titles, org or RACI charts, sign-off authority, change-control owner.

Close the X-Ray with a **current assessment**: 3–5 sentences synthesizing across the six into the go/no-go implication.
