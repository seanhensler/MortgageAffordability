// 2025 federal tax brackets
const FED_BRACKETS = {
  single: [
    [0, 11925, 0.10], [11925, 48475, 0.12], [48475, 103350, 0.22],
    [103350, 197300, 0.24], [197300, 250525, 0.32], [250525, 626350, 0.35],
    [626350, Infinity, 0.37],
  ],
  mfj: [
    [0, 23850, 0.10], [23850, 96950, 0.12], [96950, 206700, 0.22],
    [206700, 394600, 0.24], [394600, 501050, 0.32], [501050, 751600, 0.35],
    [751600, Infinity, 0.37],
  ],
};
const STD_DEDUCTION = { single: 15000, mfj: 30000 };
const SS_WAGE_BASE = 176100; // 2025
const PA_FLAT_RATE = 0.0307;
const SS_RATE = 0.062;
const MEDICARE_RATE = 0.0145;
const ADDL_MEDICARE_RATE = 0.009;
const ADDL_MEDICARE_THRESHOLD = { single: 200000, mfj: 250000 };
const CASH_FLOW_HORIZON_MONTHS = 60; // 5-year outlook cap

let lastLoan = null; // shared between the Results and Amortization tabs
let lastAmortStats = null; // { extraTotalInterest, withExtraLength } from the no-lump-sum schedule
let lastCashFlowInputs = null; // granular monthly figures for the 5-year outlook tab
let expenseCount = 0;
let downPaymentSource = "pct"; // tracks which of downPct/downAmt the user edited last
let cashFlowChart = null;
const CASH_FLOW_ANNUAL_GROWTH = 0.03; // 3%/yr compounding for income, lifestyle expenses, maintenance, HOA, property tax

function bracketTax(taxableIncome, brackets) {
  let tax = 0;
  for (const [lo, hi, rate] of brackets) {
    if (taxableIncome <= lo) break;
    tax += (Math.min(taxableIncome, hi) - lo) * rate;
  }
  return tax;
}

function fmtMoney(n) {
  const sign = n < 0 ? "-" : "";
  return sign + "$" + Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 0 });
}

// --- Comma-formatted currency inputs ---
function parseMoney(id) {
  const el = document.getElementById(id);
  return parseFloat((el.value || "0").replace(/,/g, "")) || 0;
}

function formatMoneyInput(el) {
  const digits = el.value.replace(/[^\d]/g, "");
  el.value = digits === "" ? "" : (+digits).toLocaleString("en-US");
}

function wireMoneyInputs() {
  document.querySelectorAll(".money-input").forEach((el) => {
    el.addEventListener("input", () => formatMoneyInput(el));
    el.addEventListener("blur", () => formatMoneyInput(el));
  });
}

// --- County / municipality dropdowns ---
function populateCountyDropdown() {
  const sel = document.getElementById("county");
  Object.keys(COUNTY_DEFAULTS).forEach((key) => {
    const opt = document.createElement("option");
    opt.value = key;
    opt.textContent = COUNTY_DEFAULTS[key].label;
    sel.appendChild(opt);
  });
}

function populateMuniDropdown(countyKey) {
  const sel = document.getElementById("muni");
  sel.innerHTML = "";
  let lastRegion = null;
  MILLAGE_DATA.filter((row) => row.county === countyKey).forEach((row) => {
    const i = MILLAGE_DATA.indexOf(row);
    if (row.region !== lastRegion) {
      const og = document.createElement("optgroup");
      og.label = row.region;
      sel.appendChild(og);
      lastRegion = row.region;
    }
    const opt = document.createElement("option");
    opt.value = i;
    opt.textContent = `${row.muni} (${row.school})`;
    sel.lastChild.appendChild(opt);
  });
}

function applyCountyDefaults(countyKey) {
  const defaults = COUNTY_DEFAULTS[countyKey];
  document.getElementById("countyMillage").value = defaults.countyMillage;
  document.getElementById("ratio").value = defaults.ratioPercent;
  document.getElementById("countyMillageHint").textContent = `editable, current rate for ${defaults.label}`;
  document.getElementById("ratioHint").textContent = defaults.ratioNote;
}

// --- Monthly expenses, split into debt obligations (DTI) vs lifestyle (budgeting only) ---
function addExpenseRow(containerId, description = "", amount = "", perpetual = true, durationMonths = 12) {
  expenseCount += 1;
  const id = `expense-${expenseCount}`;
  const row = document.createElement("div");
  row.className = "expense-row";
  row.dataset.id = id;
  row.innerHTML = `
    <div class="expense-row-top">
      <input type="text" class="expense-desc" placeholder="Description (e.g. car payment)" value="${description}">
      <button type="button" class="remove-expense-btn" title="Remove">&times;</button>
    </div>
    <div class="expense-row-bottom">
      <input type="text" class="money-input expense-amt" placeholder="$/mo" value="${amount}">
      <label class="perpetual-toggle"><input type="checkbox" class="expense-perpetual" ${perpetual ? "checked" : ""}> Perpetual</label>
      <input type="number" class="expense-duration" min="1" step="1" placeholder="months" value="${durationMonths}" ${perpetual ? "disabled" : ""}>
    </div>
  `;
  document.getElementById(containerId).appendChild(row);
  const amtEl = row.querySelector(".expense-amt");
  amtEl.addEventListener("input", () => formatMoneyInput(amtEl));
  amtEl.addEventListener("blur", () => formatMoneyInput(amtEl));
  const perpetualEl = row.querySelector(".expense-perpetual");
  const durationEl = row.querySelector(".expense-duration");
  perpetualEl.addEventListener("change", () => {
    durationEl.disabled = perpetualEl.checked;
  });
  row.querySelector(".remove-expense-btn").addEventListener("click", () => row.remove());
}

function getExpensesFrom(containerId) {
  return Array.from(document.querySelectorAll(`#${containerId} .expense-row`)).map((row) => {
    const description = row.querySelector(".expense-desc").value || "Expense";
    const amount = parseFloat((row.querySelector(".expense-amt").value || "0").replace(/,/g, "")) || 0;
    const perpetual = row.querySelector(".expense-perpetual").checked;
    const durationMonths = perpetual ? Infinity : Math.max(0, parseInt(row.querySelector(".expense-duration").value, 10) || 0);
    return { description, amount, perpetual, durationMonths };
  });
}

// --- Down payment sync ---
function syncDownPayment(source) {
  const price = parseMoney("homePrice");
  const pctEl = document.getElementById("downPct");
  const amtEl = document.getElementById("downAmt");
  if (source === "pct") {
    const pct = parseFloat(pctEl.value) || 0;
    amtEl.value = Math.round(price * pct / 100).toLocaleString("en-US");
  } else {
    const amt = parseMoney("downAmt");
    pctEl.value = price > 0 ? +(amt / price * 100).toFixed(2) : 0;
  }
}

function monthlyPaymentByMonths(loanAmount, annualRate, numMonths) {
  const monthlyRate = annualRate / 12;
  if (loanAmount <= 0 || numMonths <= 0) return 0;
  return monthlyRate === 0
    ? loanAmount / numMonths
    : loanAmount * (monthlyRate * Math.pow(1 + monthlyRate, numMonths)) / (Math.pow(1 + monthlyRate, numMonths) - 1);
}

function monthlyPayment(loanAmount, annualRate, years) {
  return monthlyPaymentByMonths(loanAmount, annualRate, years * 12);
}

// --- Affordability calculation ---
function calculate() {
  const salary = parseMoney("salary");
  const filingStatus = document.getElementById("filingStatus").value;
  const contrib401k = parseMoney("contrib401k");
  const contribRoth = parseMoney("contribRoth");
  const payFrequency = parseInt(document.getElementById("payFrequency").value, 10) || 26;
  const payrollInsurance = parseMoney("payrollInsurancePerPaycheck") * payFrequency;
  const eitRate = (parseFloat(document.getElementById("eitRate").value) || 0) / 100;
  const debtExpenses = getExpensesFrom("debtExpenseRows");
  const lifestyleExpenses = getExpensesFrom("lifestyleExpenseRows");
  const debtTotal = debtExpenses.reduce((s, e) => s + e.amount, 0);
  const lifestyleTotal = lifestyleExpenses.reduce((s, e) => s + e.amount, 0);
  const otherExpenses = debtTotal + lifestyleTotal;
  const expenses = debtExpenses.concat(lifestyleExpenses);

  const homePrice = parseMoney("homePrice");
  const downAmt = parseMoney("downAmt");
  const rate = (parseFloat(document.getElementById("rate").value) || 0) / 100;
  const termYears = parseFloat(document.getElementById("term").value) || 30;
  const muniIdx = parseInt(document.getElementById("muni").value, 10);
  const countyMillage = parseFloat(document.getElementById("countyMillage").value) || 0;
  const ratio = (parseFloat(document.getElementById("ratio").value) || 100) / 100;
  const insurance = parseMoney("insurance");
  const pmiRate = (parseFloat(document.getElementById("pmiRate").value) || 0) / 100;
  const hoa = parseMoney("hoa");
  const sqft = parseFloat(document.getElementById("sqft").value) || 0;

  // --- Take-home pay ---
  // Section 125 payroll health insurance premiums are pre-tax for federal, FICA, AND PA
  // state/local wages (unlike a traditional 401k, which only reduces federal taxable income).
  const federalTaxableIncome = Math.max(0, salary - contrib401k - payrollInsurance - STD_DEDUCTION[filingStatus]);
  const federalTax = bracketTax(federalTaxableIncome, FED_BRACKETS[filingStatus]);

  const ficaWages = Math.max(0, salary - payrollInsurance);
  const ssTax = Math.min(ficaWages, SS_WAGE_BASE) * SS_RATE;
  const medicareTax = ficaWages * MEDICARE_RATE;
  const addlThreshold = ADDL_MEDICARE_THRESHOLD[filingStatus];
  const addlMedicareTax = Math.max(0, ficaWages - addlThreshold) * ADDL_MEDICARE_RATE;
  const ficaTax = ssTax + medicareTax + addlMedicareTax;

  // PA does not exclude 401k/Roth deferrals from state or local taxable wages, but does exclude Section 125 premiums
  const paLocalWages = Math.max(0, salary - payrollInsurance);
  const paStateTax = paLocalWages * PA_FLAT_RATE;
  const localEIT = paLocalWages * eitRate;

  const totalTax = federalTax + ficaTax + paStateTax + localEIT;
  const netAnnual = salary - totalTax - contrib401k - contribRoth - payrollInsurance;
  const netMonthly = netAnnual / 12;
  const grossMonthly = salary / 12;

  // --- Housing cost (Feature A: HOA folded directly into PITI) ---
  const loanAmount = Math.max(0, homePrice - downAmt);
  const monthlyPI = monthlyPayment(loanAmount, rate, termYears);

  const muni = MILLAGE_DATA[muniIdx];
  const totalMills = (muni ? muni.muniMills + muni.schoolMills : 0) + countyMillage;
  const assessedValue = homePrice * ratio;
  const annualPropertyTax = assessedValue * totalMills / 1000;
  const monthlyPropertyTax = annualPropertyTax / 12;

  const monthlyInsurance = insurance / 12;
  const downPct = homePrice > 0 ? downAmt / homePrice : 0;
  const annualPMI = downPct < 0.20 ? loanAmount * pmiRate : 0;
  const monthlyPMI = annualPMI / 12;
  const monthlyMaintenance = sqft * 1.0 / 12; // Square Footage Rule: $1/sq ft annually

  const totalMonthlyHousing = monthlyPI + monthlyPropertyTax + monthlyInsurance + monthlyPMI + hoa + monthlyMaintenance;

  lastLoan = { loanAmount, rate, termYears, monthlyPI };

  renderResults({
    salary, contrib401k, contribRoth, payrollInsurance, federalTax, ficaTax, paStateTax, localEIT,
    eitRatePct: eitRate * 100,
    totalTax, netAnnual, netMonthly, grossMonthly, otherExpenses, debtTotal, lifestyleTotal,
    loanAmount, monthlyPI, muni, totalMills, assessedValue, annualPropertyTax, monthlyPropertyTax,
    monthlyInsurance, monthlyPMI, hoa, monthlyMaintenance, totalMonthlyHousing, downPct,
  });

  renderUnderwriting(grossMonthly, totalMonthlyHousing, debtTotal);

  lastCashFlowInputs = {
    netMonthly, monthlyPI, monthlyPropertyTax, monthlyInsurance, monthlyPMI, hoa, monthlyMaintenance,
    debtExpenses, lifestyleExpenses,
  };
  renderCashFlowChart();
}

function renderResults(r) {
  document.getElementById("results").style.display = "";

  const netDiscretionary = r.netMonthly - r.otherExpenses - r.totalMonthlyHousing;
  document.getElementById("snapNetTakeHome").textContent = fmtMoney(r.netMonthly);
  document.getElementById("snapHousing").textContent = fmtMoney(r.totalMonthlyHousing);
  document.getElementById("snapDiscretionary").textContent = fmtMoney(netDiscretionary);

  document.getElementById("eitIndicator").innerHTML =
    `<span class="eit-badge">Local EIT Rate: ${r.eitRatePct.toFixed(2)}%</span>`;

  const preTaxPay = r.grossMonthly - r.contrib401k / 12 - r.payrollInsurance / 12;

  const payRows = [
    ["Gross monthly pay", fmtMoney(r.grossMonthly), ""],
    ["401(k) contribution (pre-tax)", "-" + fmtMoney(r.contrib401k / 12), ""],
    ["Health insurance premiums (pre-tax)", "-" + fmtMoney(r.payrollInsurance / 12), ""],
    ["Taxable pay (federal basis)", fmtMoney(preTaxPay), "subtotal"],
    ["Federal income tax", "-" + fmtMoney(r.federalTax / 12), ""],
    ["FICA (SS + Medicare)", "-" + fmtMoney(r.ficaTax / 12), ""],
    ["PA state tax (3.07%)", "-" + fmtMoney(r.paStateTax / 12), ""],
    ["Local EIT", "-" + fmtMoney(r.localEIT / 12), ""],
    ["Roth contribution (post-tax)", "-" + fmtMoney(r.contribRoth / 12), ""],
    ["Net take-home (monthly)", fmtMoney(r.netMonthly), "total"],
    ["Debt obligations (underwriting)", "-" + fmtMoney(r.debtTotal), ""],
    ["Lifestyle & living expenses", "-" + fmtMoney(r.lifestyleTotal), ""],
    ["Net after expenses", fmtMoney(r.netMonthly - r.otherExpenses), "total"],
  ];
  document.getElementById("payTable").innerHTML = payRows.map((row) =>
    `<tr class="${row[2]}"><td>${row[0]}</td><td>${row[1]}</td></tr>`
  ).join("") + `<tr class="footnote"><td colspan="2">FICA, PA state, and local EIT are calculated on gross pay minus health insurance only — 401(k) contributions reduce federal tax but not those.</td></tr>`;

  const muniLabel = r.muni ? `${r.muni.muni} / ${r.muni.school}` : "—";
  const houseRows = [
    ["Loan amount", fmtMoney(r.loanAmount)],
    ["Principal & interest", fmtMoney(r.monthlyPI)],
    [`Property tax (${muniLabel}, ${r.totalMills.toFixed(2)} mills)`, fmtMoney(r.monthlyPropertyTax)],
    ["Homeowners insurance", fmtMoney(r.monthlyInsurance)],
    ["PMI" + (r.downPct >= 0.20 ? " (n/a, ≥20% down)" : ""), fmtMoney(r.monthlyPMI)],
    ["HOA fees", fmtMoney(r.hoa)],
    ["Maintenance ($1/sq ft/yr)", fmtMoney(r.monthlyMaintenance)],
    ["Total monthly housing cost (PITI + HOA)", fmtMoney(r.totalMonthlyHousing)],
  ];
  document.getElementById("houseTable").innerHTML = houseRows.map((row, i) =>
    `<tr class="${i === houseRows.length - 1 ? 'total' : ''}"><td>${row[0]}</td><td>${row[1]}</td></tr>`
  ).join("");

  const netAfterAll = r.netMonthly - r.otherExpenses - r.totalMonthlyHousing;
  const pctOfGross = (r.totalMonthlyHousing + r.otherExpenses) / r.grossMonthly * 100;
  const pctOfNet = (r.totalMonthlyHousing + r.otherExpenses) / r.netMonthly * 100;

  let verdictClass = "ok";
  let verdictText = "Comfortable";
  if (netAfterAll < 0 || pctOfGross > 36 || pctOfNet > 50) { verdictClass = "bad"; verdictText = "Stretching too far"; }
  else if (pctOfGross > 28 || pctOfNet > 40) { verdictClass = "warn"; verdictText = "Tight, proceed carefully"; }

  document.getElementById("verdict").innerHTML = `
    <div class="verdict-box ${verdictClass}">
      <strong>${verdictText}</strong><br>
      Housing + other monthly expenses are ${pctOfGross.toFixed(1)}% of gross income (lender 28/36 rule)
      and ${pctOfNet.toFixed(1)}% of your actual net take-home pay.<br>
      Leftover after housing and other expenses: ${fmtMoney(netAfterAll)}/mo.
    </div>`;
}

// --- Lender Underwriting Status (28/36 rule): front-end uses PITI+HOA only,
// back-end adds debt obligations only — lifestyle expenses are excluded from both. ---
function renderUnderwriting(grossMonthly, totalMonthlyHousing, debtTotal) {
  document.getElementById("underwritingCard").style.display = "";

  const frontEndPct = grossMonthly > 0 ? totalMonthlyHousing / grossMonthly * 100 : 0;
  const maxFrontEndPayment = grossMonthly * 0.28;
  const backEndAmount = totalMonthlyHousing + debtTotal;
  const backEndPct = grossMonthly > 0 ? backEndAmount / grossMonthly * 100 : 0;
  const maxBackEndTotal = grossMonthly * 0.36;
  const maxPitiUnderBackEnd = Math.max(0, maxBackEndTotal - debtTotal);

  const rows = [
    ["Gross monthly income", fmtMoney(grossMonthly)],
    ["Front-End DTI (PITI + HOA ÷ gross)", `${frontEndPct.toFixed(1)}%`],
    ["Max qualifying PITI + HOA (28% target)", fmtMoney(maxFrontEndPayment)],
    ["Back-End DTI (PITI + HOA + debt ÷ gross)", `${backEndPct.toFixed(1)}%`],
    ["Max qualifying total debt (36% target)", fmtMoney(maxBackEndTotal)],
  ];
  document.getElementById("underwritingTable").innerHTML = rows.map((row) =>
    `<tr><td>${row[0]}</td><td>${row[1]}</td></tr>`
  ).join("");

  const failFront = frontEndPct > 28;
  const failBack = backEndPct > 36;

  let badgeHtml;
  if (!failFront && !failBack) {
    badgeHtml = `<div class="qualify-badge ok">✓ Meets Conventional Guidelines</div>`;
  } else {
    const reasons = [];
    if (failFront) {
      reasons.push(`Front-End DTI is ${frontEndPct.toFixed(1)}% (over the 28% target) — max qualifying PITI + HOA is ${fmtMoney(maxFrontEndPayment)}/mo.`);
    }
    if (failBack) {
      reasons.push(`Back-End DTI is ${backEndPct.toFixed(1)}% (over the 36% target) — max qualifying PITI + HOA given current debt is ${fmtMoney(maxPitiUnderBackEnd)}/mo.`);
    }
    badgeHtml = `<div class="qualify-badge warn">⚠️ Exceeds Preferred 28/36 Guidelines</div>
      <div class="qualify-reasons">${reasons.map((reason) => `<p>${reason}</p>`).join("")}</div>`;
  }
  document.getElementById("qualifyBadge").innerHTML = badgeHtml;
}

// --- Monthly cash-flow projection + chart, with 3%/yr compounding ---
// Compounds: net income, lifestyle expenses, maintenance, HOA, property tax.
// Held flat: mortgage P&I, homeowners insurance, PMI, and debt obligations (which still
// respect their own duration drop-off, just without growth applied to the dollar amount).
function buildCashFlowProjection(inputs, horizonMonths) {
  const { netMonthly, monthlyPI, monthlyPropertyTax, monthlyInsurance, monthlyPMI, hoa, monthlyMaintenance, debtExpenses, lifestyleExpenses } = inputs;
  const months = [];
  for (let m = 1; m <= horizonMonths; m++) {
    const yearsElapsed = Math.floor((m - 1) / 12);
    const growth = Math.pow(1 + CASH_FLOW_ANNUAL_GROWTH, yearsElapsed);

    const netIncomeAtMonth = netMonthly * growth;
    const compoundingHousing = (monthlyPropertyTax + hoa + monthlyMaintenance) * growth;
    const flatHousing = monthlyPI + monthlyInsurance + monthlyPMI;
    const pitiHoaAtMonth = compoundingHousing + flatHousing;

    const debtAtMonth = debtExpenses.reduce((sum, e) => sum + (m <= e.durationMonths ? e.amount : 0), 0);
    const lifestyleAtMonth = lifestyleExpenses.reduce((sum, e) => sum + (m <= e.durationMonths ? e.amount * growth : 0), 0);
    const expensesAtMonth = debtAtMonth + lifestyleAtMonth;

    months.push({
      month: m,
      netIncome: netIncomeAtMonth,
      pitiHoa: pitiHoaAtMonth,
      expenses: expensesAtMonth,
      discretionary: netIncomeAtMonth - pitiHoaAtMonth - expensesAtMonth,
    });
  }
  return months;
}

function renderCashFlowChart() {
  if (typeof Chart === "undefined" || !lastCashFlowInputs) return;
  document.getElementById("cashFlowCard").style.display = "";
  const projection = buildCashFlowProjection(lastCashFlowInputs, CASH_FLOW_HORIZON_MONTHS);
  const labels = projection.map((p) => p.month);

  const data = {
    labels,
    datasets: [
      {
        label: "Net Income",
        data: projection.map((p) => p.netIncome),
        borderColor: "#5C6B7A",
        borderDash: [4, 4],
        borderWidth: 2,
        pointRadius: 0,
        fill: false,
        stepped: false,
      },
      {
        label: "PITI + HOA",
        data: projection.map((p) => p.pitiHoa),
        borderColor: "#0B2545",
        borderWidth: 2,
        pointRadius: 0,
        fill: false,
        stepped: false,
      },
      {
        label: "Limited-Duration Expenses",
        data: projection.map((p) => p.expenses),
        borderColor: "#D9722C",
        backgroundColor: "rgba(217, 114, 44, 0.14)",
        borderWidth: 2,
        pointRadius: 0,
        fill: true,
        stepped: "before",
      },
      {
        label: "Net Discretionary Cash Flow",
        data: projection.map((p) => p.discretionary),
        borderColor: "#1B3A5C",
        backgroundColor: "rgba(27, 58, 92, 0.14)",
        borderWidth: 2.5,
        pointRadius: 0,
        fill: true,
        stepped: "before",
      },
    ],
  };

  const config = {
    type: "line",
    data,
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { position: "bottom", labels: { font: { family: "Inter", size: 12 } } },
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.dataset.label}: ${fmtMoney(ctx.parsed.y)}`,
          },
        },
      },
      scales: {
        x: {
          title: { display: true, text: "Months", font: { family: "Inter" } },
          ticks: { callback: (val) => (labels[val] % 12 === 0 || val === 0 ? labels[val] : ""), font: { family: "Inter", size: 11 } },
          grid: { color: "#D7DEE5" },
        },
        y: {
          title: { display: true, text: "$ / month", font: { family: "Inter" } },
          ticks: { callback: (val) => "$" + val.toLocaleString("en-US"), font: { family: "Inter", size: 11 } },
          grid: { color: "#D7DEE5" },
        },
      },
    },
  };

  if (cashFlowChart) {
    cashFlowChart.data = data;
    cashFlowChart.options = config.options;
    cashFlowChart.update();
  } else {
    cashFlowChart = new Chart(document.getElementById("cashFlowChart"), config);
  }
}

// --- Amortization ---
function buildSchedule(loanAmount, annualRate, years, extraPayment) {
  const monthlyRate = annualRate / 12;
  const basePayment = monthlyPayment(loanAmount, annualRate, years);
  const payment = basePayment + extraPayment;
  let balance = loanAmount;
  const months = [];
  let month = 0;
  const maxMonths = years * 12 + 1200; // safety cap
  while (balance > 0.01 && month < maxMonths) {
    month += 1;
    const interest = balance * monthlyRate;
    let principal = payment - interest;
    if (principal > balance) principal = balance;
    balance -= principal;
    months.push({ month, interest, principal, balance });
  }
  return months;
}

function summarizeByYear(months) {
  const years = [];
  for (let i = 0; i < months.length; i += 12) {
    const yearMonths = months.slice(i, i + 12);
    years.push({
      year: Math.floor(i / 12) + 1,
      principal: yearMonths.reduce((s, m) => s + m.principal, 0),
      interest: yearMonths.reduce((s, m) => s + m.interest, 0),
      endingBalance: yearMonths[yearMonths.length - 1].balance,
      months: yearMonths,
    });
  }
  return years;
}

function renderAmortTable(months) {
  const yearRows = summarizeByYear(months);
  const tbody = document.getElementById("amortTableBody");
  tbody.innerHTML = "";
  yearRows.forEach((yr) => {
    const tr = document.createElement("tr");
    tr.className = "year-row";
    tr.innerHTML = `<td>${yr.year}</td><td>${fmtMoney(yr.principal)}</td><td>${fmtMoney(yr.interest)}</td><td>${fmtMoney(yr.endingBalance)}</td>`;
    tbody.appendChild(tr);

    const detailTr = document.createElement("tr");
    detailTr.className = "month-detail";
    detailTr.style.display = "none";
    const monthRowsHtml = yr.months.map((m) =>
      `<tr><td>Month ${m.month}</td><td>${fmtMoney(m.principal)}</td><td>${fmtMoney(m.interest)}</td><td>${fmtMoney(m.balance)}</td></tr>`
    ).join("");
    detailTr.innerHTML = `<td colspan="4"><table class="month-table">${monthRowsHtml}</table></td>`;
    tbody.appendChild(detailTr);

    tr.addEventListener("click", () => {
      detailTr.style.display = detailTr.style.display === "none" ? "" : "none";
    });
  });

  const totalPrincipal = months.reduce((s, m) => s + m.principal, 0);
  const totalInterest = months.reduce((s, m) => s + m.interest, 0);
  const finalBalance = months.length ? months[months.length - 1].balance : 0;
  const totalsTr = document.createElement("tr");
  totalsTr.className = "amort-totals-row";
  totalsTr.innerHTML = `<td>Total</td><td>${fmtMoney(totalPrincipal)}</td><td>${fmtMoney(totalInterest)}</td><td>${fmtMoney(finalBalance)}</td>`;
  tbody.appendChild(totalsTr);
}

function populateLumpSumMonthDropdown(termYears) {
  const sel = document.getElementById("lumpSumMonth");
  const prevValue = sel.value;
  sel.innerHTML = "";
  const totalMonths = termYears * 12;
  for (let m = 1; m <= totalMonths; m++) {
    const opt = document.createElement("option");
    opt.value = m;
    opt.textContent = `Month ${m} (Year ${Math.ceil(m / 12)})`;
    sel.appendChild(opt);
  }
  if (prevValue && +prevValue <= totalMonths) sel.value = prevValue;
}

function calculateAmortization() {
  if (!lastLoan) {
    alert("Calculate the Affordability tab first so the loan amount, rate, and term are set.");
    return;
  }
  const extraPayment = parseMoney("extraPayment");
  const { loanAmount, rate, termYears } = lastLoan;

  const baseline = buildSchedule(loanAmount, rate, termYears, 0);
  const withExtra = buildSchedule(loanAmount, rate, termYears, extraPayment);

  const baselineTotalInterest = baseline.reduce((s, m) => s + m.interest, 0);
  const extraTotalInterest = withExtra.reduce((s, m) => s + m.interest, 0);
  const interestSaved = baselineTotalInterest - extraTotalInterest;
  const monthsSaved = baseline.length - withExtra.length;

  lastAmortStats = { extraTotalInterest, withExtraLength: withExtra.length };

  document.getElementById("amortSummary").style.display = "";
  document.getElementById("amortTableWrap").style.display = "";

  const payoffYears = Math.floor(withExtra.length / 12);
  const payoffMonths = withExtra.length % 12;
  document.getElementById("payoffTime").textContent = `${payoffYears}y ${payoffMonths}mo`;
  document.getElementById("totalInterest").textContent = fmtMoney(extraTotalInterest);
  document.getElementById("interestSaved").textContent = fmtMoney(interestSaved);
  document.getElementById("timeSaved").textContent = monthsSaved > 0
    ? `${Math.floor(monthsSaved / 12)}y ${monthsSaved % 12}mo`
    : "—";

  renderAmortTable(withExtra);
  populateLumpSumMonthDropdown(termYears);
  document.getElementById("reforecastSummary").style.display = "none";
}

// --- Feature C: Reforecast engine (lump sum drop-in) ---
function computeReforecast(loanAmount, annualRate, termYears, extraPayment, lumpSum, targetMonth, mode) {
  const monthlyRate = annualRate / 12;
  const basePayment = monthlyPayment(loanAmount, annualRate, termYears) + extraPayment;
  const totalTermMonths = termYears * 12;

  // Phase 1: standard amortization up to the target month
  let balance = loanAmount;
  const months = [];
  let m = 0;
  while (m < targetMonth && balance > 0.01) {
    m += 1;
    const interest = balance * monthlyRate;
    let principal = basePayment - interest;
    if (principal > balance) principal = balance;
    balance -= principal;
    months.push({ month: m, interest, principal, balance });
  }

  // Apply lump sum at the end of the target month
  const lumpApplied = Math.min(lumpSum, balance);
  balance = Math.max(0, balance - lumpApplied);

  // Phase 2: continue with either the same payment (shorten term) or a recast lower payment
  let payment = basePayment;
  if (mode === "recast" && balance > 0) {
    const remainingMonths = Math.max(1, totalTermMonths - m);
    payment = monthlyPaymentByMonths(balance, annualRate, remainingMonths);
  }

  const safetyCap = totalTermMonths + 1200;
  while (balance > 0.01 && m < safetyCap) {
    m += 1;
    const interest = balance * monthlyRate;
    let principal = payment - interest;
    if (principal > balance) principal = balance;
    balance -= principal;
    months.push({ month: m, interest, principal, balance });
  }

  const totalInterest = months.reduce((s, mo) => s + mo.interest, 0);
  return { months, totalInterest, payment, lumpApplied };
}

function runReforecast() {
  if (!lastLoan || !lastAmortStats) {
    alert("Calculate the Affordability and Amortization tabs first.");
    return;
  }
  const { loanAmount, rate, termYears } = lastLoan;
  const extraPayment = parseMoney("extraPayment");
  const lumpSum = parseMoney("lumpSum");
  const targetMonth = parseInt(document.getElementById("lumpSumMonth").value, 10) || 1;
  const mode = document.querySelector('input[name="reforecastMode"]:checked').value;

  const result = computeReforecast(loanAmount, rate, termYears, extraPayment, lumpSum, targetMonth, mode);

  document.getElementById("reforecastSummary").style.display = "";
  const payoffYears = Math.floor(result.months.length / 12);
  const payoffMonths = result.months.length % 12;
  document.getElementById("rfPayment").textContent = mode === "recast" ? fmtMoney(result.payment) : fmtMoney(result.payment) + " (unchanged)";
  document.getElementById("rfPayoffTime").textContent = `${payoffYears}y ${payoffMonths}mo`;
  document.getElementById("rfTotalInterest").textContent = fmtMoney(result.totalInterest);
  document.getElementById("rfInterestSaved").textContent = fmtMoney(lastAmortStats.extraTotalInterest - result.totalInterest);

  renderAmortTable(result.months);
}

// --- Output tabs: Results & Underwriting / Amortization Schedule / 5-Year Cash Flow Outlook ---
function setupTabs() {
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      document.querySelectorAll(".tab-panel").forEach((p) => (p.style.display = "none"));
      document.getElementById(`tab-${btn.dataset.tab}`).style.display = "";
      if (btn.dataset.tab === "amort") calculateAmortization();
      // Chart.js sizes itself off the canvas's container, which reports 0 height while
      // its tab panel is display:none — resize once the panel becomes visible.
      if (btn.dataset.tab === "cashflow" && cashFlowChart) cashFlowChart.resize();
    });
  });
}

// City of Pittsburgh's 3.00% rate (1% city + 2% school district) takes precedence over the
// generic 1% county baseline. Must run both on user selection AND after the dropdown is
// (re)populated programmatically, since "change" doesn't fire for the default-selected option.
function updateEitFromMuni() {
  const idx = parseInt(document.getElementById("muni").value, 10);
  const eitEl = document.getElementById("eitRate");
  eitEl.value = MILLAGE_DATA[idx] && MILLAGE_DATA[idx].eitDefault ? MILLAGE_DATA[idx].eitDefault : 1;
}

document.addEventListener("DOMContentLoaded", () => {
  wireMoneyInputs();
  populateCountyDropdown();

  const countySel = document.getElementById("county");
  countySel.addEventListener("change", () => {
    populateMuniDropdown(countySel.value);
    applyCountyDefaults(countySel.value);
    updateEitFromMuni();
  });
  countySel.value = "allegheny";
  populateMuniDropdown("allegheny");
  applyCountyDefaults("allegheny");
  updateEitFromMuni();

  document.getElementById("muni").addEventListener("change", updateEitFromMuni);

  document.getElementById("downPct").addEventListener("input", () => {
    downPaymentSource = "pct";
    syncDownPayment("pct");
  });
  document.getElementById("downAmt").addEventListener("input", () => {
    downPaymentSource = "amt";
    syncDownPayment("amt");
  });
  document.getElementById("homePrice").addEventListener("input", () => syncDownPayment(downPaymentSource));
  document.getElementById("addDebtExpenseBtn").addEventListener("click", () => addExpenseRow("debtExpenseRows"));
  document.getElementById("addLifestyleExpenseBtn").addEventListener("click", () => addExpenseRow("lifestyleExpenseRows"));
  document.getElementById("calcBtn").addEventListener("click", calculate);
  document.getElementById("reforecastBtn").addEventListener("click", runReforecast);

  let extraPaymentTimer = null;
  document.getElementById("extraPayment").addEventListener("input", () => {
    clearTimeout(extraPaymentTimer);
    extraPaymentTimer = setTimeout(() => {
      if (document.getElementById("tab-amort").style.display !== "none") calculateAmortization();
    }, 400);
  });

  setupTabs();
  syncDownPayment("pct");
  calculate();
});
