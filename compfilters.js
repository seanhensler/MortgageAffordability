// Pure-logic comp filtering, sorting, and KPI derivation.
// The FILTERED array produced here is the single source of truth for BOTH the comps
// table rows and the KPI summary cards — app.js renders both from one apply() result,
// so they cannot fall out of sync. No DOM access, no fetch.

const CompFilters = {
  defaultFilters() {
    return { months: 24, minBeds: 0, minBaths: 0, maxDistance: 1.0, minSqft: null, maxSqft: null };
  },

  // Options the UI panel renders from (single place to add/change choices).
  FILTER_OPTIONS: {
    months: [
      { value: 6, label: "Last 6 months" },
      { value: 12, label: "Last 12 months" },
      { value: 24, label: "Last 24 months" },
    ],
    minBeds: [
      { value: 0, label: "Any beds" },
      { value: 2, label: "2+ beds" },
      { value: 3, label: "3+ beds" },
      { value: 4, label: "4+ beds" },
    ],
    minBaths: [
      { value: 0, label: "Any baths" },
      { value: 1.5, label: "1.5+ baths" },
      { value: 2, label: "2+ baths" },
    ],
    maxDistance: [
      { value: 0.25, label: "≤ 0.25 mi" },
      { value: 0.5, label: "≤ 0.5 mi" },
      { value: 0.75, label: "≤ 0.75 mi" },
      { value: 1.0, label: "≤ 1.0 mi" },
    ],
  },

  // 'YYYY-MM-DD' cutoff N calendar months before `now`, with month-end rollover clamped
  // (e.g. May 31 minus 6 months → Nov 30, never Dec 1).
  monthsAgoISO(now, months) {
    const d = new Date(now.getFullYear(), now.getMonth(), 1);
    d.setMonth(d.getMonth() - months);
    const lastDayOfTarget = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(now.getDate(), lastDayOfTarget));
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${d.getFullYear()}-${mm}-${dd}`;
  },

  totalBaths(row) {
    return (row.fullBaths || 0) + 0.5 * (row.halfBaths || 0);
  },

  apply({ rows, filters, now = new Date() }) {
    const f = { ...this.defaultFilters(), ...(filters || {}) };
    const dateCutoff = this.monthsAgoISO(now, f.months);

    const filtered = (rows || [])
      .filter((row) => {
        if (!row.saleDate || row.saleDate < dateCutoff) return false;
        if (f.minBeds > 0 && !(row.bedrooms >= f.minBeds)) return false; // null/missing fails
        if (f.minBaths > 0 && !(this.totalBaths(row) >= f.minBaths)) return false;
        if (!(row.distanceMiles <= f.maxDistance)) return false; // strict, full precision
        if (f.minSqft !== null && !(row.sqft >= f.minSqft)) return false; // null/0 sqft fails when bounded
        if (f.maxSqft !== null && !(row.sqft > 0 && row.sqft <= f.maxSqft)) return false;
        return true;
      })
      // Sale date descending; same-day ties broken by distance ascending (closest first).
      .sort((a, b) => b.saleDate.localeCompare(a.saleDate) || a.distanceMiles - b.distanceMiles);

    return { filtered, summary: this.summarize(filtered) };
  },

  // Identical KPI semantics to CompEngine._summarize (comps.js): avgPricePerSqft is the
  // MEAN OF PER-ROW price/sqft ratios (the app's established underwriting standard),
  // not sum(price)/sum(sqft).
  summarize(comps) {
    const count = comps.length;
    if (count === 0) {
      return {
        count: 0, avgPrice: null, medianPrice: null, avgPricePerSqft: null,
        pricePerSqftSkipped: 0, minSaleDate: null, maxSaleDate: null, maxDistance: null,
      };
    }

    const prices = comps.map((c) => c.price).filter((p) => typeof p === "number" && !isNaN(p));
    const avgPrice = prices.length ? prices.reduce((s, p) => s + p, 0) / prices.length : null;

    const sorted = [...prices].sort((a, b) => a - b);
    let medianPrice = null;
    if (sorted.length) {
      const mid = Math.floor(sorted.length / 2);
      medianPrice = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
    }

    let ratioSum = 0, ratioCount = 0, pricePerSqftSkipped = 0;
    comps.forEach((c) => {
      if (c.sqft && c.sqft > 0 && typeof c.price === "number") {
        ratioSum += c.price / c.sqft;
        ratioCount += 1;
      } else {
        pricePerSqftSkipped += 1;
      }
    });
    const avgPricePerSqft = ratioCount > 0 ? ratioSum / ratioCount : null;

    const saleDates = comps.map((c) => c.saleDate).filter(Boolean).sort();
    return {
      count,
      avgPrice,
      medianPrice,
      avgPricePerSqft,
      pricePerSqftSkipped,
      minSaleDate: saleDates[0] || null,
      maxSaleDate: saleDates[saleDates.length - 1] || null,
      maxDistance: comps.reduce((max, c) => Math.max(max, c.distanceMiles), 0),
    };
  },
};

if (typeof module !== "undefined") module.exports = CompFilters;
