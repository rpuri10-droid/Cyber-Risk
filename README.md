# Cyber Risk Quantification Dashboard

A React + Vite dashboard that turns network traffic (`public/data/cybersecurity.csv`) into dollar-denominated
cyber risk. It has four pages:

| Page | What it answers |
|---|---|
| **Dashboard** (`#/dashboard`) | What is attacking us, where, and roughly what it costs. (Original dashboard, unchanged.) |
| **Scenarios** (`#/scenarios`) | How likely are large losses, before and after our controls, and is that within risk appetite? |
| **Controls** (`#/controls`) | Which security controls pay for themselves? |
| **Executive Summary** (`#/summary`) | A plain-English, one-page view for a CISO or board, exportable to PDF. |

## Running it

```bash
npm install
npm run dev      # http://localhost:3000
npm test         # unit tests (Vitest)
npm run build    # production build into dist/
```

On Windows, `start-localhost.bat` does the same as `npm install && npm run dev`.

## Architecture

There is no server or database: the CSV is parsed in the browser. All calculations live in plain JavaScript
modules under `src/lib/` (the service layer). React components in `src/components/` only render their results.

| Module | Responsibility |
|---|---|
| `src/lib/analytics.js` | CSV parsing, filters, dashboard metrics, point-estimate loss exposure |
| `src/lib/simulation.js` | Seeded random numbers, PERT and Poisson sampling, Monte Carlo, percentiles, exceedance curves |
| `src/lib/risk.js` | Scenarios, controls, ROI, residual risk, risk appetite, portfolio totals, executive wording |
| `src/lib/seedControls.js` | The 8 demo controls |
| `src/lib/store.js` | Versioned saved state with migrations (stands in for a database) |

### Data model and migrations

User edits are saved in the browser's `localStorage` as one versioned document (`cyber-risk-state`):

```js
{
  version: 2,
  assumptions:    { controlEffectiveness, lossPerEvent: { [attackType]: usd } }, // from v1
  scenarioRanges: { [scenarioId]: { freqLow, freqHigh, lossLow, lossHigh } },   // FAIR range widths
  controls: [{ id, name, description, annualCost, implementationCost,
               lefReduction: { min, likely, max },   // fractions, 0.35 = 35%
               lmReduction:  { min, likely, max },
               scenarioIds: [...] }],
  appetite: { probability, lossThreshold },
  settings: { amortizationYears, trials, seed },
}
```

`migrateState()` upgrades older data step by step. Version 1 (`cyber-risk-assumptions-v1`, which held only the
loss-per-attempt values and the control slider) is read and carried into v2, and the v1 key is left untouched,
so existing data is never lost. Bad or out-of-range values are repaired rather than crashing the app.

## The model

### Scenarios (FAIR inputs)

There is one scenario per attack type found in the data. Each scenario has two FAIR inputs, both given as
minimum / most likely / maximum:

| FAIR input | Most likely | Default range |
|---|---|---|
| **Loss event frequency** (events per year) | observed attempts × 365 ÷ days in the dataset | 60% – 150% of most likely |
| **Loss magnitude** (USD per event) | the "loss per attempt" from the Dashboard | 50% – 220% of most likely |

Both range widths can be edited per scenario on its detail page.

### Monte Carlo simulation

Each scenario is simulated for 10,000 years. For each simulated year *i*:

```
frequencyᵢ  ~ PERT(min, likely, max)                         events / year
magnitudeᵢ  ~ PERT(min, likely, max)                         USD / event
for each control c attached to the scenario:
    frequencyᵢ ×= 1 − LEF reductionᶜᵢ,  LEF reductionᶜᵢ ~ PERT(control's range)
    magnitudeᵢ ×= 1 − LM reductionᶜᵢ,   LM reductionᶜᵢ  ~ PERT(control's range)
eventsᵢ     = Poisson quantile(frequencyᵢ, uᵢ)                 uᵢ ~ Uniform(0, 1)
annual lossᵢ = eventsᵢ × magnitudeᵢ
```

- **PERT** is the modified-PERT distribution (λ = 4). Its mean is (min + 4·likely + max) / 6.
- **Several controls** on one scenario stack multiplicatively. The combined reduction is 1 − Π(1 − rᶜ), so two
  50% controls remove 75%, not 100%.
- **Same random seed for both runs.** Every random input has its own stream, keyed by the seed and its name.
  The before-controls and after-controls runs therefore replay exactly the same simulated years, and the
  event count is taken as a quantile of the same uniform draw. A control can therefore only lower a year's
  loss, never raise it, and the difference between the two runs is the control, not random noise.

### Statistics

These are computed from the simulated annual losses:

| Measure | Formula |
|---|---|
| Mean ALE | average of the simulated annual losses |
| Median, 90th, 95th percentile | linear-interpolated percentiles of the sorted losses |
| P(loss > X) | share of simulated years with loss strictly greater than X |
| Loss exceedance curve | P(loss > x) plotted for x from $0 to the axis maximum |
| **Portfolio** | the scenarios' losses added together year by year, then the same statistics |

### Control ROI

Each control is simulated on its own against the scenarios it covers:

```
risk reduction  = Σ over covered scenarios (inherent ALE − residual ALE with only this control)
annualized cost = annual cost + implementation cost ÷ amortization years   (default 3, editable)
ROI             = (risk reduction − annualized cost) ÷ annualized cost
payback (years) = implementation cost ÷ (risk reduction − annual cost)   ("Never" if the denominator ≤ 0)
worth it        ⇔ ROI > 0
```

Residual risk on the Scenarios page uses **all** attached controls together. The ROI ranking measures each
control **standalone**, so overlapping controls each show their full individual value.

### Risk appetite

Risk appetite is an organization-level rule: *no more than P% chance of losing more than $X per year* (default
10% and $1M). It applies to each scenario.

```
over appetite ⇔ P(residual annual loss > X) > P
```

A scenario is flagged when its after-controls exceedance curve passes above the point (X, P). On the chart this
is the dot where the two dotted limit lines meet.

### Executive summary wording

Each top-5 risk is written as `"<plain name>: N% chance of losing more than $Y this year."` Y is the loss
exceeded in about P% of simulated years (P is the appetite probability), rounded to two significant figures.
Odds below 1% or above 99% are written as "less than 1%" or "more than 99%", never 0% or 100%.

## Pages

Screenshots are in `docs/screenshots/`.

### Dashboard — `docs/screenshots/dashboard.png`
The original dashboard is unchanged: risk score, filters, KPI cards, the loss exposure model with editable
loss-per-attempt values, key findings, trend, attack mix, targeted services heatmap and the event explorer.
Loss-per-attempt values edited here are the same values the simulation uses for loss magnitude.

### Scenarios — `docs/screenshots/scenarios.png`
- **Risk appetite editor.** Both numbers are editable, and the page shows how many scenarios are over the limit
  before and after controls.
- **Portfolio: before vs. after.** Overlaid loss exceedance curves for all scenarios combined, with the
  appetite limit marked. Hover for exact probabilities.
- **Portfolio statistics.** Mean ALE, median, P90, P95 and the probability of exceeding the threshold, side by
  side.
- **Scenario table.** Over/within appetite badge per scenario, and a checkbox to show only flagged scenarios.

### Scenario detail — `docs/screenshots/scenarios-sql-injection.png`
- Before vs. after loss exceedance curves for the scenario, plus a side-by-side statistics table.
- Tick or untick controls to attach them; curves and stats update immediately.
- FAIR inputs: min / most likely / max frequency and loss, with editable range widths.

### Controls — `docs/screenshots/controls.png`
- Controls ranked by ROI, with a ✓ Worth it / ✕ Not worth it verdict, annualized cost, risk reduction, ROI and
  payback.
- Add, edit or delete controls: name, description, costs, min/likely/max % reduction to frequency and/or
  magnitude, and which scenarios they apply to.
- Editable amortization period, and a button to restore the demo controls.

### Executive Summary — `docs/screenshots/summary.png`
Written without technical terms:
- Expected yearly loss with and without protections, plus a "bad year (1 in 10)" figure.
- The top 5 risks, each as one plain sentence.
- How many risks are above the agreed limit.
- The top 3 recommended protections, with cost, avoided loss and payback in words.

**Export to PDF** opens the browser's print dialog with a print stylesheet (light theme, navigation hidden).
Choose "Save as PDF". The result is a two-page report.

## Demo data

`src/lib/seedControls.js` ships 8 illustrative controls, chosen so every feature shows something:

| Control | Covers | Effect | Result with the sample data |
|---|---|---|---|
| Web application firewall | SQL injection, XSS, command injection | frequency −35/55/75% | Worth it |
| Multi-factor authentication | Credential stuffing, brute force | frequency −60/80/95% | Worth it |
| Endpoint detection & response | C2, exploit attempts, command injection | both | Worth it |
| Phishing & awareness training | Credential stuffing, C2 | frequency −5/12/20% | Worth it |
| Immutable backups & restore drills | C2, exploit attempts | magnitude −15/30/45% | Worth it |
| Privileged access management | C2, command injection, brute force | both | Worth it |
| Always-on DDoS scrubbing | DDoS | magnitude −30/50/70% | **Not worth it** (costs more than it saves) |
| External attack surface monitoring | Port scan | frequency −20/40/60% | **Not worth it** (port scans are cheap) |

With these controls, 6 of 9 scenarios exceed the default appetite before controls. After controls, 1 still does
(SQL injection), which makes the flag and the filter visible in a demo. Costs and effectiveness are
placeholders, not benchmarks; replace them with your own quotes and estimates.

## Tests

`npm test` runs the unit tests in `src/lib/__tests__/`:

- `risk.test.js` covers the ROI, payback and worth-it verdict, combined reductions, residual risk, appetite
  flagging, portfolio aggregation, control ranking and the executive wording.
- `simulation.test.js` covers seed determinism, PERT and Poisson correctness, that zero-effect controls change
  nothing, that controls never raise a year's loss, percentiles and exceedance curves.
- `store.test.js` covers the v1 → v2 migration, repair of bad data, and that legacy data is preserved.

## Caveats

Dollar figures are model outputs driven by editable assumptions. Use them to compare and prioritize, not as
audited loss forecasts.
