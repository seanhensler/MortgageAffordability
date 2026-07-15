// Pure-logic comp (comparable sale) engine — distance filtering, ranking, and summary stats.
// No DOM access, no fetch. Consumed by app.js and unit-tested directly via Node.
//
// Expected comp row shape (see comps_*.csv for real examples):
//   { parid, lat, lon, price, saleDate ('YYYY-MM-DD'), sqft, beds, baths, ... }

const CompEngine = {
  // Degrees of latitude per mile. Longitude degrees-per-mile shrinks as you move away from the
  // equator, so it's derived per-call from the target latitude (see boundingBox/haversineMiles).
  MILES_TO_LAT_DEGREES: 0.014472,
  EARTH_RADIUS_MILES: 3958.8,

  // A cheap pre-filter box (e.g. for a SQL WHERE clause or an in-memory pre-filter) — NOT the
  // final radius cutoff. filterAndRank() below re-checks the true great-circle distance.
  boundingBox(lat, lon, radiusMiles) {
    const latDegrees = this.MILES_TO_LAT_DEGREES * radiusMiles;
    const lonDegrees = latDegrees / Math.cos(lat * Math.PI / 180);
    return {
      minLat: lat - latDegrees,
      maxLat: lat + latDegrees,
      minLon: lon - lonDegrees,
      maxLon: lon + lonDegrees,
    };
  },

  // Great-circle distance between two lat/lon points, in miles.
  haversineMiles(lat1, lon1, lat2, lon2) {
    const toRad = (deg) => deg * Math.PI / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return this.EARTH_RADIUS_MILES * c;
  },

  // Recorded-deed lookback window, computed fresh from "now" every call — never hardcode dates.
  dateWindow(years = 2) {
    const toISODate = (d) => d.toISOString().slice(0, 10);
    const end = new Date();
    const start = new Date(end);
    start.setFullYear(start.getFullYear() - years);
    return { startDate: toISODate(start), endDate: toISODate(end) };
  },

  // Filters `rows` to those within `radiusMiles` of the target (strict cutoff on full-precision
  // distance, no rounding before compare), excludes the subject property itself (by parid),
  // sorts nearest-first, and rolls up summary stats.
  filterAndRank({ rows, targetLat, targetLon, targetParid, radiusMiles = 1.0 }) {
    const comps = (rows || [])
      .filter((row) => row.parid !== targetParid)
      .map((row) => {
        const distanceMiles = this.haversineMiles(targetLat, targetLon, row.lat, row.lon);
        return { ...row, distanceMiles, distanceDisplay: +distanceMiles.toFixed(2) };
      })
      .filter((row) => row.distanceMiles <= radiusMiles)
      .sort((a, b) => a.distanceMiles - b.distanceMiles);

    const summary = this._summarize(comps);

    return { comps, summary };
  },

  _summarize(comps) {
    const count = comps.length;
    if (count === 0) {
      return {
        count: 0,
        avgPrice: null,
        medianPrice: null,
        avgPricePerSqft: null,
        pricePerSqftSkipped: 0,
        minSaleDate: null,
        maxSaleDate: null,
        maxDistance: null,
      };
    }

    const prices = comps.map((c) => c.price).filter((p) => typeof p === "number" && !isNaN(p));
    const avgPrice = prices.length ? prices.reduce((s, p) => s + p, 0) / prices.length : null;

    const sortedPrices = [...prices].sort((a, b) => a - b);
    let medianPrice = null;
    if (sortedPrices.length) {
      const mid = Math.floor(sortedPrices.length / 2);
      medianPrice = sortedPrices.length % 2 === 0
        ? (sortedPrices[mid - 1] + sortedPrices[mid]) / 2
        : sortedPrices[mid];
    }

    let ratioSum = 0;
    let ratioCount = 0;
    let pricePerSqftSkipped = 0;
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
    const minSaleDate = saleDates.length ? saleDates[0] : null;
    const maxSaleDate = saleDates.length ? saleDates[saleDates.length - 1] : null;

    const maxDistance = comps.reduce((max, c) => Math.max(max, c.distanceMiles), 0);

    return {
      count,
      avgPrice,
      medianPrice,
      avgPricePerSqft,
      pricePerSqftSkipped,
      minSaleDate,
      maxSaleDate,
      maxDistance,
    };
  },

  // User-facing caveats to display alongside any comp report.
  DISCLAIMERS: [
    "Comps are drawn from recorded arm's-length deeds, which typically lag actual sale dates by 1-2 months due to county recording queues.",
    "Beds, baths, and square footage reflect the current county assessment snapshot, not necessarily the property's condition as of the sale date.",
    "This tool provides an informational estimate only — it is not a formal appraisal.",
  ],
};

if (typeof module !== "undefined") module.exports = CompEngine;
