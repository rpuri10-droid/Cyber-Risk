import { formatPercent, formatUsdShort } from '../lib/analytics';

// Board-level page. All figures and sentences come from executiveSummary() in lib/risk.js.
export default function ExecutiveSummary({ summary, source }) {
  const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const scale = Math.max(1, summary.exposureBefore, summary.exposureAfter);

  const exportPdf = () => {
    const previous = document.title;
    document.title = `Cyber risk executive summary ${new Date().toISOString().slice(0, 10)}`;
    window.print();
    document.title = previous;
  };

  return (
    <article className="panel section-card exec" aria-labelledby="exec-title">
      <header className="exec-head">
        <div>
          <p className="eyebrow">Executive summary</p>
          <h2 id="exec-title">What cyber attacks could cost us this year</h2>
          <p className="muted small">
            {today} · based on activity recorded in {source}
          </p>
        </div>
        <button type="button" className="primary-button no-print" onClick={exportPdf}>
          Export to PDF
        </button>
      </header>

      <section className="exec-tiles" aria-label="Headline figures">
        <div className="exec-tile">
          <span className="stat-label">Expected yearly loss, no protections</span>
          <strong>{formatUsdShort(summary.exposureBefore)}</strong>
          <span className="muted small">A bad year (1 in 10) could reach {formatUsdShort(summary.badYearBefore)}</span>
        </div>
        <div className="exec-tile accent">
          <span className="stat-label">Expected yearly loss, with protections</span>
          <strong>{formatUsdShort(summary.exposureAfter)}</strong>
          <span className="muted small">A bad year (1 in 10) could reach {formatUsdShort(summary.badYearAfter)}</span>
        </div>
        <div className="exec-tile">
          <span className="stat-label">Loss avoided each year</span>
          <strong>{formatUsdShort(summary.exposureReduction)}</strong>
          <span className="muted small">{formatPercent(summary.exposureReductionShare, 0)} lower than with no protections</span>
        </div>
        <div className="exec-tile">
          <span className="stat-label">Risks above our limit</span>
          <strong>
            {summary.flaggedCount} of {summary.scenarioCount}
          </strong>
          <span className="muted small">Down from {summary.flaggedBeforeCount} with no protections</span>
        </div>
      </section>

      <section className="exec-bars" aria-label="Expected yearly loss with and without protections">
        {[
          { label: 'No protections', value: summary.exposureBefore, tone: 'before' },
          { label: 'With protections', value: summary.exposureAfter, tone: 'after' },
        ].map((bar) => (
          <div key={bar.label} className="exec-bar-row">
            <span>{bar.label}</span>
            <span className="bar-track" aria-hidden="true">
              <span className={`exec-bar ${bar.tone}`} style={{ width: `${(bar.value / scale) * 100}%` }} />
            </span>
            <strong>{formatUsdShort(bar.value)}</strong>
          </div>
        ))}
      </section>

      <section aria-labelledby="exec-risks">
        <h3 id="exec-risks">Our five biggest risks</h3>
        <p className="muted small">Ranked by expected loss per year, with our protections in place.</p>
        <ol className="exec-list">
          {summary.topRisks.map((risk) => (
            <li key={risk.id}>
              <p>{risk.sentence}</p>
              <span className="exec-meta">
                <span>Expected loss {formatUsdShort(risk.expectedLoss)} a year</span>
                {risk.flagged && (
                  <span className="badge badge-over">
                    <span aria-hidden="true">▲</span> Above our limit
                  </span>
                )}
              </span>
            </li>
          ))}
        </ol>
        {summary.topRisks.length === 0 && <p className="empty">No attack activity in the data.</p>}
      </section>

      <section aria-labelledby="exec-appetite">
        <h3 id="exec-appetite">Are we within the risk we agreed to accept?</h3>
        <p>{summary.appetiteSentence}</p>
        <p>
          {summary.flaggedCount === 0 ? (
            <>
              <strong>All {summary.scenarioCount} risks are within that limit</strong> with our protections in place.
            </>
          ) : (
            <>
              <strong>
                {summary.flaggedCount} of {summary.scenarioCount} risks {summary.flaggedCount === 1 ? 'is' : 'are'} above
                that limit
              </strong>{' '}
              even with our protections in place: {summary.flaggedNames.join('; ')}.
            </>
          )}
        </p>
      </section>

      <section aria-labelledby="exec-controls">
        <h3 id="exec-controls">Where the next dollar is best spent</h3>
        <p className="muted small">The three protections that return the most for what they cost.</p>
        {summary.recommended.length === 0 ? (
          <p className="empty">None of the protections reviewed currently pays for itself.</p>
        ) : (
          <ol className="exec-list">
            {summary.recommended.map((control) => (
              <li key={control.id}>
                <p>
                  <strong>{control.name}.</strong> {control.sentence}
                </p>
              </li>
            ))}
          </ol>
        )}
      </section>

      <p className="footnote">
        These figures are estimates from a model that replays thousands of possible years using our recorded attack
        activity and our cost assumptions. Use them to compare and prioritize, not as audited forecasts.
      </p>
    </article>
  );
}
