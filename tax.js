// Pure-logic Allegheny County, PA property/transfer tax engine.
// No DOM access, no fetch. This app has been stripped down to Allegheny County only —
// do not add other counties here.

const AlleghenyTax = {
  COUNTY_MILLAGE: 4.73,
  HOMESTEAD_EXCLUSION: 18000,
  // Common Level Ratio: STEB's published assessed/market ratio, used to back into an estimated
  // assessed value from a purchase price when the actual county-assessed value is unknown.
  CLR_PERCENT: 52,

  estimateAssessedValue(marketPrice) {
    return marketPrice * (this.CLR_PERCENT / 100);
  },

  // SIMPLIFICATION: in reality, each taxing body (county, municipality, school district) sets
  // its own homestead/farmstead exclusion under Act 50 (county) / Act 1 (school districts), and
  // those exclusions apply separately against each body's own millage before summing the tax.
  // Per spec, this applies a single county $18k exclusion against the COMBINED millage instead
  // of modeling three separate exclusion amounts — a reasonable approximation, not a precise
  // reproduction of an actual Allegheny County tax bill.
  annualPropertyTax({ assessedValue, homesteadEnabled, muniMills, schoolMills, countyMills = 4.73 }) {
    const taxableAssessed = Math.max(0, assessedValue - (homesteadEnabled ? this.HOMESTEAD_EXCLUSION : 0));
    const totalMills = muniMills + schoolMills + countyMills;
    const annualTax = taxableAssessed * totalMills / 1000;
    return { taxableAssessed, totalMills, annualTax };
  },

  // One-time closing cost (not a recurring monthly figure). Pennsylvania realty transfer tax is
  // 1% state-wide; localRatePct is the local (municipality + school district) share on top of
  // that — pass 3.0 for the City of Pittsburgh (1% city + 2% school), 1.0 for most other munis.
  transferTax({ price, localRatePct = 1.0 }) {
    const stateTax = price * 0.01;
    const localTax = price * (localRatePct / 100);
    return { stateTax, localTax, totalTax: stateTax + localTax };
  },

  defaultLocalTransferRate(muniDesc) {
    // City of Pittsburgh parcels appear in county data as ward entries ("14th Ward - PITTSBURGH").
    // A bare substring test would falsely match East Pittsburgh Borough (a separate municipality
    // with ordinary ~1% local transfer tax), so require the ward pattern or an exact city name.
    const upper = (muniDesc || "").toUpperCase().trim();
    const isCityProper = /^PITTSBURGH$/.test(upper) || /WARD\s*-?\s*PITTSBURGH/.test(upper) || upper === "CITY OF PITTSBURGH";
    return isCityProper ? 3.0 : 1.0;
  },
};

if (typeof module !== "undefined") module.exports = AlleghenyTax;
