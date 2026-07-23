// affordability.js — Personal "Ability to Pay" assessment: a holistic, cash-flow-first read on
// whether a household can sustainably absorb a given home purchase.
//
// Deliberately distinct from the Lender Underwriting Status card (28/36 rule) rendered
// elsewhere in app.js/index.html: that card reports what a conventional lender's
// qualification guidelines say. DTI and housing-ratio cutoffs are underwriting thresholds,
// not measures of a household's actual financial health — a household can clear 28/36 and
// still have no cushion, or miss it and still have thousands left over every month. This
// module treats those ratios as low-weight context, never the primary signal.
//
// No LLM/API call is involved — this is a static, client-side app with nowhere safe to hold
// an API key. buildNarrative() below plays the role of "the AI prompt": every sentence it
// emits is generated from the same numbers assess() computed, never a generic stock line.
//
// Global `Affordability` object (IIFE), matching the rest of the app's module style
// (AlleghenyTax, WPRDC, CompFilters, CompMap).
const Affordability = (() => {
  // Composite weights (sum to 100). Cash-flow adequacy dominates; DTI/housing ratio is
  // deliberately the smallest weight — informative context, never the decider. When reserves
  // aren't provided, its weight is redistributed proportionally across the rest (see assess())
  // rather than penalizing an unanswered question.
  const WEIGHTS = {
    cashFlow: 45,
    reserves: 20,
    savingsRate: 12,
    stressTest: 13,
    dtiHousing: 10,
  };

  // Small, bounded modifier — "should improve confidence," not a gate. Applied after the
  // weighted composite so it can never swing more than a few points either way.
  const STABILITY_MODIFIER = {
    salary: 4,
    retirement: 4,
    multiple: 2,
    hourly: -1,
    commission: -3,
    selfEmployed: -3,
  };

  function clamp(n, lo, hi) {
    return Math.max(lo, Math.min(hi, n));
  }

  function fmtMoney(n) {
    const sign = n < 0 ? "-" : "";
    return sign + "$" + Math.abs(Math.round(n)).toLocaleString("en-US");
  }

  // --- Sub-score 1: cash-flow adequacy (highest-priority metric, spec items #1 and #3 — they
  // are the same underlying quantity, "money left after every required expense," so scored
  // once rather than double-counted under two names). Primary scale is residual income as a
  // % of net take-home (scales sensibly across income levels, unlike a fixed dollar cutoff),
  // guarded by an absolute-dollar floor so a decent percentage on a very low net income
  // doesn't read as falsely comfortable. ---
  function scoreCashFlow(netAfterAll, netMonthly) {
    if (netAfterAll < 0) return { score: 0, tier: "Negative" };
    if (netAfterAll < 150) return { score: 15, tier: "Limited" };
    const pctOfNet = netMonthly > 0 ? (netAfterAll / netMonthly) * 100 : 0;
    if (pctOfNet >= 30) return { score: 100, tier: "Very High" };
    if (pctOfNet >= 18) return { score: 80, tier: "Healthy" };
    if (pctOfNet >= 8) return { score: 50, tier: "Limited" };
    return { score: 30, tier: "Limited" };
  }

  // --- Sub-score 2: emergency reserves after closing. `liquidSavings` is the household's TOTAL
  // current savings/investments (gross — before anything is spent on the purchase); the down
  // payment and closing costs are subtracted here, once, to find what's actually left over.
  // Returns null (excluded from the composite, NOT penalized) when the user hasn't entered
  // liquid savings — an unanswered question isn't evidence of zero reserves. Every field needed
  // to reconstruct the arithmetic in the narrative is returned alongside the score/tier. ---
  function scoreReserves(liquidSavings, downAmt, closingCosts, monthlyObligations) {
    if (!liquidSavings || liquidSavings <= 0) return null;
    const afterClosing = liquidSavings - downAmt - closingCosts;
    const months = monthlyObligations > 0 ? Math.max(0, afterClosing) / monthlyObligations : 0;
    let score, tier;
    if (afterClosing < 0) { score = 0; tier = "Insufficient for closing"; }
    else if (months < 3) { score = 20; tier = "High Risk"; }
    else if (months < 6) { score = 60; tier = "Adequate"; }
    else if (months < 12) { score = 85; tier = "Good"; }
    else { score = 100; tier = "Excellent"; }
    return { score, tier, months, afterClosing, liquidSavings, downAmt, closingCosts };
  }

  // --- Sub-score 3: savings rate — retirement contributions already being made PLUS leftover
  // cash, as a share of gross pay. Distinct from cash-flow adequacy: this rewards a household
  // already building wealth via 401k/Roth on top of whatever cash is left over, not just the
  // leftover cash alone. Capped low when net cash flow is actually negative — paper retirement
  // contributions don't offset spending down real cash every month. ---
  function scoreSavingsRate(netAfterAll, contrib401kMonthly, contribRothMonthly, grossMonthly) {
    if (grossMonthly <= 0) return { score: 0, pct: 0 };
    const pct = ((contrib401kMonthly + contribRothMonthly + Math.max(0, netAfterAll)) / grossMonthly) * 100;
    let score;
    if (netAfterAll < 0) score = Math.min(25, pct * 2);
    else if (pct >= 20) score = 100;
    else if (pct >= 12) score = 80;
    else if (pct >= 6) score = 55;
    else score = 30;
    return { score, pct };
  }

  // --- Sub-score 4: stress test — property tax, insurance, and maintenance bumped 15%
  // (midpoint of the requested 10-20% band) to approximate a bad-year reassessment, premium
  // hike, or repair year. PMI, HOA, and P&I are held flat (rate-locked / not reassessment
  // driven). ---
  function scoreStressTest(netMonthly, otherExpenses, monthlyPI, monthlyPropertyTax, monthlyInsurance, monthlyMaintenance, hoa, monthlyPMI, netAfterAll) {
    const BUMP = 0.15;
    const stressedHousing =
      monthlyPI + monthlyPropertyTax * (1 + BUMP) + monthlyInsurance * (1 + BUMP) + monthlyMaintenance * (1 + BUMP) + hoa + monthlyPMI;
    const stressedCashFlow = netMonthly - otherExpenses - stressedHousing;
    let score;
    if (stressedCashFlow >= netAfterAll * 0.5 || stressedCashFlow > 500) score = 100;
    else if (stressedCashFlow > 0) score = 70;
    else if (stressedCashFlow > -300) score = 40;
    else score = 15;
    return { score, stressedCashFlow };
  }

  // --- Sub-score 5: DTI / housing ratio — deliberately the lowest-weighted input. Each ratio
  // is scored against its own conventional target (28% front-end, 36% back-end) as a RATIO to
  // that target rather than a hard pass/fail cliff, and the worse of the two decides the
  // sub-score. Still reported for context here, and still drives the separate Lender
  // Underwriting card at its own unmodified 28/36 cutoffs — but capped at 10% of the composite
  // so it can never dominate the personal-affordability category. ---
  function scoreDtiHousing(frontEndPct, backEndPct) {
    const scoreAgainst = (pct, target) => {
      const ratio = target > 0 ? pct / target : 0;
      if (ratio <= 1.0) return 100;
      if (ratio <= 1.15) return 75;
      if (ratio <= 1.4) return 45;
      return 20;
    };
    return Math.min(scoreAgainst(frontEndPct, 28), scoreAgainst(backEndPct, 36));
  }

  const CATEGORY_COPY = {
    Excellent: "Home is comfortably affordable, with strong monthly cash flow, excellent reserves, and minimal financial stress.",
    Comfortable: "Affordable while maintaining financial flexibility — savings should continue growing after the purchase.",
    Manageable: "The home fits the budget but should be monitored — keep building or maintaining emergency savings.",
    Stretch: "The payment is affordable but leaves limited flexibility; a large unexpected expense may require a lifestyle adjustment.",
    "High Risk": "Remaining cash flow is limited — an unexpected expense could create real financial strain.",
    "Not Affordable": "Monthly obligations exceed sustainable cash flow at this price and rate.",
  };

  function categoryFor(composite, netAfterAll) {
    if (netAfterAll < 0) return "Not Affordable"; // hard floor: obligations aren't covered, full stop
    if (composite >= 85) return "Excellent";
    if (composite >= 70) return "Comfortable";
    if (composite >= 55) return "Manageable";
    if (composite >= 40) return "Stretch";
    if (composite >= 20) return "High Risk";
    return "Not Affordable";
  }

  // Composes the explanation: why this category, which strengths pulled the score up, which
  // risks pulled it down, and what would improve it — every clause is tied to a computed
  // number, never a stock line like "you may be stretching your budget."
  function buildNarrative(m, category) {
    const strengths = [];
    const risks = [];

    if (m.cashFlow.tier === "Very High" || m.cashFlow.tier === "Healthy") {
      strengths.push(
        `you retain ${fmtMoney(m.netAfterAll)}/mo in discretionary cash flow after every recurring obligation (housing, debts, and estimated living expenses) — a ${m.cashFlow.tier.toLowerCase()} cushion`
      );
    } else if (m.netAfterAll >= 0) {
      risks.push(`only ${fmtMoney(m.netAfterAll)}/mo remains after all recurring obligations, which leaves limited room for the unplanned`);
    } else {
      risks.push(`recurring obligations exceed take-home pay by ${fmtMoney(Math.abs(m.netAfterAll))}/mo`);
    }

    if (m.reserves) {
      const rv = m.reserves;
      if (rv.afterClosing < 0) {
        risks.push(
          `your ${fmtMoney(rv.liquidSavings)} in savings would not fully cover the ${fmtMoney(rv.downAmt)} down payment plus ${fmtMoney(rv.closingCosts)} in closing costs (short by ${fmtMoney(Math.abs(rv.afterClosing))}), leaving no cash reserve after closing`
        );
      } else if (rv.months >= 6) {
        strengths.push(
          `after the ${fmtMoney(rv.downAmt)} down payment and ${fmtMoney(rv.closingCosts)} in closing costs, the remaining ${fmtMoney(rv.afterClosing)} in savings covers roughly ${rv.months.toFixed(1)} months of obligations (${rv.tier.toLowerCase()})`
        );
      } else {
        risks.push(
          `after the ${fmtMoney(rv.downAmt)} down payment and ${fmtMoney(rv.closingCosts)} in closing costs, the remaining ${fmtMoney(rv.afterClosing)} in savings covers only about ${rv.months.toFixed(1)} months of obligations`
        );
      }
    }

    if (m.stressTest.score >= 70) {
      strengths.push(`a simulated 15% jump in property tax, insurance, and maintenance still leaves ${fmtMoney(m.stressTest.stressedCashFlow)}/mo positive`);
    } else if (m.stressTest.stressedCashFlow < 0) {
      risks.push(`a 15% increase in property tax, insurance, or maintenance would push cash flow negative (est. ${fmtMoney(m.stressTest.stressedCashFlow)}/mo)`);
    }

    if (m.savingsRate.score >= 80) {
      strengths.push(`combined retirement contributions and leftover cash equal ${m.savingsRate.pct.toFixed(1)}% of gross pay, so this household keeps building savings after the purchase`);
    }

    if (m.dtiScore <= 45) {
      risks.push("front-end/back-end DTI runs above conventional lender targets (see the Lender Underwriting card) — informative here, but not a deciding factor given the cash flow above");
    }

    if (m.stability > 0) {
      strengths.push("stable, predictable income improves confidence in this assessment");
    } else if (m.stability < 0) {
      risks.push("variable or self-employed income adds some uncertainty to relying on this cash flow every month");
    }

    const parts = [CATEGORY_COPY[category]];
    if (strengths.length) parts.push(`<strong>Why:</strong> ${strengths.join("; ")}.`);
    if (risks.length) parts.push(`<strong>Watch for:</strong> ${risks.join("; ")}.`);

    const improve = [];
    if (!m.reserves) improve.push("add your liquid savings above to include reserve strength in this assessment");
    if (m.cashFlow.score < 80 && m.netAfterAll >= 0) improve.push("a larger down payment or a lower rate would widen the monthly cushion");
    if (m.stressTest.score < 70) improve.push("a larger reserve would better absorb a tax or insurance increase");
    if (improve.length) parts.push(`<strong>Could improve:</strong> ${improve.join("; ")}.`);

    return parts.join("<br><br>");
  }

  // --- Public entry point ---
  function assess(inputs) {
    const {
      netMonthly, grossMonthly, otherExpenses, totalMonthlyHousing,
      monthlyPI, monthlyPropertyTax, monthlyInsurance, monthlyMaintenance, monthlyPMI, hoa,
      contrib401kMonthly, contribRothMonthly,
      downAmt, closingCosts, liquidSavings, incomeStability,
      frontEndPct, backEndPct,
    } = inputs;

    const netAfterAll = netMonthly - otherExpenses - totalMonthlyHousing;

    const cashFlow = scoreCashFlow(netAfterAll, netMonthly);
    const reserves = scoreReserves(liquidSavings, downAmt, closingCosts, otherExpenses + totalMonthlyHousing);
    const savingsRate = scoreSavingsRate(netAfterAll, contrib401kMonthly, contribRothMonthly, grossMonthly);
    const stressTest = scoreStressTest(
      netMonthly, otherExpenses, monthlyPI, monthlyPropertyTax, monthlyInsurance, monthlyMaintenance, hoa, monthlyPMI, netAfterAll
    );
    const dtiScore = scoreDtiHousing(frontEndPct, backEndPct);

    const parts = [
      { score: cashFlow.score, weight: WEIGHTS.cashFlow },
      { score: savingsRate.score, weight: WEIGHTS.savingsRate },
      { score: stressTest.score, weight: WEIGHTS.stressTest },
      { score: dtiScore, weight: WEIGHTS.dtiHousing },
    ];
    if (reserves) parts.push({ score: reserves.score, weight: WEIGHTS.reserves });

    const weightSum = parts.reduce((s, p) => s + p.weight, 0);
    const weighted = parts.reduce((s, p) => s + p.score * (p.weight / weightSum), 0);

    const stability = STABILITY_MODIFIER[incomeStability] || 0;
    const composite = clamp(weighted + stability, 0, 100);

    const category = categoryFor(composite, netAfterAll);
    const metrics = { netAfterAll, cashFlow, reserves, savingsRate, stressTest, dtiScore, stability };
    const narrative = buildNarrative(metrics, category);

    return { category, composite, metrics, narrative };
  }

  return { assess };
})();
