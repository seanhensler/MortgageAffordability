// DTI Gauge — visual progress-bar gauges for the Lender Underwriting card's 28/36 rule
// (Front-End DTI = PITI + HOA ÷ gross income, Back-End DTI = PITI + HOA + debt ÷ gross income).
// Pure render layer: no state of its own, no event listeners, no fetch. render() fully replaces
// containerEl's innerHTML every call, so it's safe (and expected) to call on every recalculation.
// Global `DtiGauge` object (IIFE), matches this codebase's other modules (CompMap, AlleghenyTax).
const DtiGauge = (() => {
  // Bar "scale" = the DTI% that maps to a 100%-filled track. Deliberately larger than the
  // risk-tier ceiling (31 / 43) so the high-risk zone reads as a real band of the track instead
  // of a razor-thin sliver at the far right edge.
  const FRONT_END_SCALE = 50;
  const BACK_END_SCALE = 60;

  // Conventional 28/36 guideline tiers (per spec).
  const FRONT_END_CAUTION_AT = 28;
  const FRONT_END_RISK_AT = 31;
  const BACK_END_CAUTION_AT = 36;
  const BACK_END_RISK_AT = 43;

  function tierFor(pct, cautionAt, riskAt) {
    if (pct > riskAt) return { key: "bad", label: "High Risk" };
    if (pct >= cautionAt) return { key: "warn", label: "Caution" };
    return { key: "ok", label: "Safe" };
  }

  function fmtMoney(n) {
    return `$${Math.round(n).toLocaleString("en-US")}`;
  }

  function fmtPct(n) {
    return `${n.toFixed(1)}%`;
  }

  // Renders one gauge row (track + label + badge + threshold ticks + $ context line).
  function renderBar({ label, pct, scale, cautionAt, riskAt, maxAmount }) {
    const t = tierFor(pct, cautionAt, riskAt);
    const fillPct = Math.min(Math.max((pct / scale) * 100, 0), 100);
    // Tick/label positions are expressed as a % of this bar's OWN scale, so "28%" and "31%"
    // land at the correct spot on the front-end track and "36%"/"43%" on the back-end track.
    const cautionTickPct = Math.min((cautionAt / scale) * 100, 100);
    const riskTickPct = Math.min((riskAt / scale) * 100, 100);

    return `
      <div class="dti-gauge-row">
        <div class="dti-gauge-label-row">
          <span class="dti-gauge-label">${label}</span>
          <span class="dti-gauge-value">${fmtPct(pct)}</span>
        </div>
        <div
          class="dti-gauge-track"
          role="progressbar"
          aria-valuenow="${pct.toFixed(1)}"
          aria-valuemin="0"
          aria-valuemax="${scale}"
          aria-label="${label}: ${fmtPct(pct)}, ${t.label}"
        >
          <div class="dti-gauge-fill dti-gauge-fill-${t.key}" style="width: ${fillPct}%;"></div>
          <span class="dti-gauge-tick" style="left: ${cautionTickPct}%;"></span>
          <span class="dti-gauge-tick" style="left: ${riskTickPct}%;"></span>
        </div>
        <div class="dti-gauge-footer-row">
          <div class="dti-gauge-ticklabels">
            <span style="left: ${cautionTickPct}%;">${cautionAt}%</span>
            <span style="left: ${riskTickPct}%;">${riskAt}%</span>
          </div>
          <span class="dti-gauge-badge dti-gauge-badge-${t.key}">${t.label}</span>
        </div>
        <div class="dti-gauge-context">${fmtMoney(maxAmount)} max at ${cautionAt}% target</div>
      </div>`;
  }

  // Worst tier wins across both bars.
  function overallStatus(frontTier, backTier) {
    if (frontTier.key === "bad" || backTier.key === "bad") {
      return { key: "bad", text: "Exceeds Preferred Guidelines" };
    }
    if (frontTier.key === "warn" || backTier.key === "warn") {
      return { key: "warn", text: "Approaching Guideline Limits" };
    }
    return { key: "ok", text: "Meets Conventional Guidelines" };
  }

  function render(containerEl, { frontEndPct, backEndPct, maxFrontEndPayment, maxBackEndTotal }) {
    if (!containerEl) return;

    const frontTier = tierFor(frontEndPct, FRONT_END_CAUTION_AT, FRONT_END_RISK_AT);
    const backTier = tierFor(backEndPct, BACK_END_CAUTION_AT, BACK_END_RISK_AT);
    const overall = overallStatus(frontTier, backTier);

    containerEl.innerHTML = `
      <div class="dti-gauge">
        ${renderBar({
          label: "Front-End DTI",
          pct: frontEndPct,
          scale: FRONT_END_SCALE,
          cautionAt: FRONT_END_CAUTION_AT,
          riskAt: FRONT_END_RISK_AT,
          maxAmount: maxFrontEndPayment,
        })}
        ${renderBar({
          label: "Back-End DTI",
          pct: backEndPct,
          scale: BACK_END_SCALE,
          cautionAt: BACK_END_CAUTION_AT,
          riskAt: BACK_END_RISK_AT,
          maxAmount: maxBackEndTotal,
        })}
        <div class="dti-gauge-overall dti-gauge-overall-${overall.key}">${overall.text}</div>
      </div>`;
  }

  return { render };
})();

if (typeof module !== "undefined") module.exports = DtiGauge;
