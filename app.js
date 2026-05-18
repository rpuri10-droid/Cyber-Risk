const scenarios = [
  {
    id: "ransomware",
    name: "Ransomware",
    assetValue: 2400000,
    exposureFactor: 0.32,
    aro: 0.78,
    controls: 0.54,
    impact: 5,
    likelihood: 4,
    mitigation: "Immutable backups, segmentation, and restore drills",
  },
  {
    id: "phishing",
    name: "Business Email Compromise",
    assetValue: 1200000,
    exposureFactor: 0.18,
    aro: 1.35,
    controls: 0.41,
    impact: 4,
    likelihood: 5,
    mitigation: "MFA hardening, payment verification, and email auth",
  },
  {
    id: "cloud",
    name: "Cloud Misconfiguration",
    assetValue: 1800000,
    exposureFactor: 0.27,
    aro: 0.62,
    controls: 0.46,
    impact: 4,
    likelihood: 3,
    mitigation: "Policy-as-code, posture monitoring, and drift detection",
  },
  {
    id: "thirdParty",
    name: "Third-Party Breach",
    assetValue: 1500000,
    exposureFactor: 0.22,
    aro: 0.54,
    controls: 0.38,
    impact: 3,
    likelihood: 3,
    mitigation: "Vendor risk reviews, SBOMs, and least-privilege access",
  },
];

const state = scenarios.map((scenario) => ({ ...scenario }));

const refs = {
  aleValue: document.getElementById("aleValue"),
  aleDelta: document.getElementById("aleDelta"),
  portfolioScore: document.getElementById("portfolioScore"),
  portfolioLabel: document.getElementById("portfolioLabel"),
  ringProgress: document.getElementById("ringProgress"),
  residualScore: document.getElementById("residualScore"),
  controlEffect: document.getElementById("controlEffect"),
  vulnerableAssets: document.getElementById("vulnerableAssets"),
  expectedIncidents: document.getElementById("expectedIncidents"),
  riskBand: document.getElementById("riskBand"),
  scenarioControls: document.getElementById("scenarioControls"),
  scenarioTable: document.getElementById("scenarioTable"),
  actionList: document.getElementById("actionList"),
  baselinePath: document.getElementById("baselinePath"),
  linePath: document.getElementById("linePath"),
  areaPath: document.getElementById("areaPath"),
  chartGrid: document.getElementById("chartGrid"),
  aiSummary: document.getElementById("aiSummary"),
  aiRecommendation: document.getElementById("aiRecommendation"),
  aiImpact: document.getElementById("aiImpact"),
  aiSteps: document.getElementById("aiSteps"),
  aiRefresh: document.getElementById("aiRefresh"),
};

const fmtCurrency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const fmtDecimal = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

function quantize(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function baselineAle(scenario) {
  return scenario.assetValue * scenario.exposureFactor * scenario.aro;
}

function residualAle(scenario) {
  return baselineAle(scenario) * (1 - scenario.controls);
}

function riskScore(scenario) {
  const impactWeight = (scenario.impact / 5) * 35;
  const likelihoodWeight = (scenario.likelihood / 5) * 35;
  const exposureWeight = scenario.exposureFactor * 20;
  const controlPenalty = (1 - scenario.controls) * 10;
  return quantize(impactWeight + likelihoodWeight + exposureWeight + controlPenalty, 8, 100);
}

function overallControlEffect() {
  const weighted = state.reduce((total, scenario) => total + scenario.controls * scenario.assetValue, 0);
  const denominator = state.reduce((total, scenario) => total + scenario.assetValue, 0);
  return weighted / denominator;
}

function renderControls() {
  refs.scenarioControls.innerHTML = "";

  state.forEach((scenario) => {
    const card = document.createElement("div");
    card.className = "scenario";
    card.innerHTML = `
      <div class="scenario-top">
        <h3>${scenario.name}</h3>
        <span class="badge">${fmtCurrency.format(baselineAle(scenario))} ALE</span>
      </div>
      <div class="row">
        <label for="${scenario.id}-control">Control effectiveness</label>
        <output id="${scenario.id}-control-output">${Math.round(scenario.controls * 100)}%</output>
      </div>
      <input id="${scenario.id}-control" type="range" min="5" max="90" step="1" value="${Math.round(
        scenario.controls * 100,
      )}" aria-label="${scenario.name} control effectiveness" />
      <div class="row">
        <label for="${scenario.id}-aro">Annual rate of occurrence</label>
        <output id="${scenario.id}-aro-output">${scenario.aro.toFixed(2)}</output>
      </div>
      <input id="${scenario.id}-aro" type="range" min="0.10" max="2.20" step="0.01" value="${scenario.aro.toFixed(
        2,
      )}" aria-label="${scenario.name} annual rate of occurrence" />
    `;

    refs.scenarioControls.appendChild(card);

    const controlInput = card.querySelector(`#${scenario.id}-control`);
    const controlOutput = card.querySelector(`#${scenario.id}-control-output`);
    const aroInput = card.querySelector(`#${scenario.id}-aro`);
    const aroOutput = card.querySelector(`#${scenario.id}-aro-output`);

    controlInput.addEventListener("input", (event) => {
      scenario.controls = Number(event.target.value) / 100;
      controlOutput.textContent = `${event.target.value}%`;
      updateDashboard();
    });

    aroInput.addEventListener("input", (event) => {
      scenario.aro = Number(event.target.value);
      aroOutput.textContent = scenario.aro.toFixed(2);
      updateDashboard();
    });
  });
}

function renderTable() {
  refs.scenarioTable.innerHTML = state
    .map((scenario) => {
      const sle = scenario.assetValue * scenario.exposureFactor;
      const ale = baselineAle(scenario);
      const residual = residualAle(scenario);
      return `
        <tr>
          <td>${scenario.name}</td>
          <td>${fmtCurrency.format(sle)}</td>
          <td>${scenario.aro.toFixed(2)}</td>
          <td>${fmtCurrency.format(ale)}</td>
          <td>${fmtCurrency.format(residual)}</td>
        </tr>
      `;
    })
    .join("");
}

function renderActions() {
  const sorted = [...state].sort((left, right) => residualAle(right) - residualAle(left));
  refs.actionList.innerHTML = sorted
    .slice(0, 3)
    .map((scenario, index) => {
      const score = riskScore(scenario);
      const priority = index === 0 ? "Immediate" : index === 1 ? "Near-term" : "Strategic";
      return `
        <article class="action">
          <div class="action-top">
            <h3>${scenario.name}</h3>
            <span class="badge">${priority}</span>
          </div>
          <p>${scenario.mitigation}</p>
          <div class="scenario-top">
            <span class="muted">Risk score</span>
            <strong>${Math.round(score)}</strong>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderAgenticAI() {
  const rankedByResidual = [...state].sort((left, right) => residualAle(right) - residualAle(left));
  const topScenario = rankedByResidual[0];
  const topResidual = residualAle(topScenario);
  const topBaseline = baselineAle(topScenario);
  const controlGap = Math.round((1 - topScenario.controls) * 100);
  const portfolioReduction = Math.round(((state.reduce((total, scenario) => total + baselineAle(scenario), 0) - state.reduce((total, scenario) => total + residualAle(scenario), 0)) / state.reduce((total, scenario) => total + baselineAle(scenario), 0)) * 100);

  const steps = [
    `Prioritize ${topScenario.name} because it holds the largest residual loss at ${fmtCurrency.format(topResidual)} per year.`,
    `Close the ${controlGap}% control gap with the highest-return safeguard from the action list and verify the reduction with a drill.`,
    `If the portfolio target is a ${portfolioReduction + 10}% loss reduction, the current control mix is within range; otherwise, raise controls on the top two scenarios first.`,
  ];

  refs.aiSummary.textContent = `${topScenario.name} is the dominant loss driver with ${fmtCurrency.format(topResidual)} residual ALE against ${fmtCurrency.format(topBaseline)} baseline ALE.`;
  refs.aiRecommendation.textContent = `Harden ${topScenario.name} controls first and reduce expected loss by ${fmtCurrency.format(topResidual * 0.28)}.`;
  refs.aiImpact.textContent = fmtCurrency.format(topResidual * 0.28);
  refs.aiSteps.innerHTML = steps
    .map(
      (step, index) => `
        <div class="ai-step">
          <span class="ai-step-number">${index + 1}</span>
          <p>${step}</p>
        </div>
      `,
    )
    .join("");
}

function renderChartGrid() {
  const width = 640;
  const height = 280;
  const padding = 36;

  const maxBaseline = Math.max(...state.map((scenario) => baselineAle(scenario)));
  const maxResidual = Math.max(...state.map((scenario) => residualAle(scenario)));
  const maxValue = Math.max(maxBaseline, maxResidual) * 1.15;

  const ticks = 4;
  const fragments = [];

  for (let tick = 0; tick <= ticks; tick += 1) {
    const y = padding + ((height - padding * 2) / ticks) * tick;
    const label = fmtCurrency.format(maxValue - (maxValue / ticks) * tick);
    fragments.push(`<line x1="${padding}" y1="${y}" x2="${width - padding}" y2="${y}" />`);
    fragments.push(`<text x="8" y="${y + 4}">${label}</text>`);
  }

  refs.chartGrid.innerHTML = fragments.join("");
}

function renderChart() {
  const width = 640;
  const height = 280;
  const padding = 36;
  const points = 6;
  const maxValue = Math.max(
    ...state.map((scenario) => baselineAle(scenario)),
    ...state.map((scenario) => residualAle(scenario)),
  );

  const residualSeries = Array.from({ length: points }, (_, index) => {
    const t = index / (points - 1);
    const scenario = state[index % state.length];
    const seasonalLift = 0.9 + 0.2 * Math.sin((t * Math.PI * 2) + index * 0.3);
    return residualAle(scenario) * seasonalLift;
  });

  const baselineSeries = Array.from({ length: points }, (_, index) => {
    const t = index / (points - 1);
    const scenario = state[index % state.length];
    const seasonalLift = 0.92 + 0.15 * Math.cos((t * Math.PI * 2) + index * 0.22);
    return baselineAle(scenario) * seasonalLift;
  });

  const xFor = (index) => padding + ((width - padding * 2) / (points - 1)) * index;
  const yFor = (value) => height - padding - ((height - padding * 2) * value) / (maxValue * 1.15);

  const linePoints = residualSeries.map((value, index) => `${xFor(index)},${yFor(value)}`);
  const baselinePoints = baselineSeries.map((value, index) => `${xFor(index)},${yFor(value)}`);
  const startX = xFor(0);
  const startY = yFor(residualSeries[0]);
  const endX = xFor(points - 1);
  const baseY = height - padding;

  refs.baselinePath.setAttribute("d", `M ${baselinePoints.join(" L ")}`);
  refs.linePath.setAttribute("d", `M ${linePoints.join(" L ")}`);
  refs.areaPath.setAttribute("d", `M ${startX},${baseY} L ${linePoints.join(" L ")} L ${endX},${baseY} Z`);
}

function updateDashboard() {
  const baseline = state.reduce((total, scenario) => total + baselineAle(scenario), 0);
  const residual = state.reduce((total, scenario) => total + residualAle(scenario), 0);
  const controlEffect = overallControlEffect();
  const avgRisk = state.reduce((total, scenario) => total + riskScore(scenario), 0) / state.length;
  const incidentExpectation = state.reduce((total, scenario) => total + scenario.aro, 0);
  const residualIndex = quantize(Math.round((residual / baseline) * 100), 15, 95);

  refs.aleValue.textContent = fmtCurrency.format(residual);
  refs.aleDelta.textContent = `${Math.round(((baseline - residual) / baseline) * 100)}% below baseline`;
  refs.portfolioScore.textContent = Math.round(avgRisk);
  refs.portfolioLabel.textContent = avgRisk >= 70 ? "High pressure" : avgRisk >= 45 ? "Watch" : "Stable";
  refs.residualScore.textContent = residualIndex;
  refs.controlEffect.textContent = `${Math.round(controlEffect * 100)}%`;
  refs.vulnerableAssets.textContent = `${state.filter((scenario) => scenario.controls < 0.5).length}/${state.length}`;
  refs.expectedIncidents.textContent = fmtDecimal.format(incidentExpectation);
  refs.riskBand.textContent = residualIndex >= 70 ? "High" : residualIndex >= 45 ? "Moderate" : "Low";

  refs.ringProgress.style.strokeDashoffset = 427 - (427 * residualIndex) / 100;

  renderTable();
  renderActions();
  renderAgenticAI();
  renderChartGrid();
  renderChart();
}

renderControls();
refs.aiRefresh.addEventListener("click", updateDashboard);
updateDashboard();