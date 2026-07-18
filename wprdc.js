// wprdc.js — WPRDC (Western Pennsylvania Regional Data Center) fetch & query module.
// Exposes a global `WPRDC` object with three async methods:
//   WPRDC.findParcelByPoint({ lat, lon })            — spatial-first (preferred) parcel resolution
//   WPRDC.findParcelByAddress({ houseNumber, streetName, zip }) — text-match last resort
//   WPRDC.fetchComps({ schoolCode, minLat, maxLat, minLon, maxLon, startDate, endDate })
//
// CKAN datastore_search_sql API against data.wprdc.org (CORS enabled, Access-Control-Allow-Origin: *).
// No external dependencies.
//
// ── VERIFIED LIVE SCHEMA (queried 2026-07-15 via datastore_search?limit=1 and datastore_search_sql) ──
//
// Property Assessments  resource_id = 65855e14-549e-4992-b5be-d629afc676fa
//   PARID (text, 16-char parcel id) · PROPERTYHOUSENUM (text) · PROPERTYFRACTION (text)
//   PROPERTYADDRESS (text — full street incl. directional + suffix, e.g. "W MONROE CIR", no house number)
//   PROPERTYCITY · PROPERTYSTATE · PROPERTYUNIT · PROPERTYZIP (text)
//   MUNICODE · MUNIDESC (text, trailing-space padded, e.g. "Ross  ") · SCHOOLCODE · SCHOOLDESC
//   CLASS · CLASSDESC · USECODE · USEDESC (text, e.g. "SINGLE FAMILY")
//   BEDROOMS · FULLBATHS · HALFBATHS (float8) · FINISHEDLIVINGAREA (float8, sq ft) · YEARBLT (float8)
//   LOCALTOTAL (float8 — current local/school+muni assessed value, used here as "assessedValue")
//   COUNTYTOTAL (float8 — current county assessed value)
//   FAIRMARKETTOTAL (float8 — base-year appraised fair market value, used here as "fairMarketValue")
//   SALEDATE (text, MM-DD-YYYY format — NOT used for filtering; see sales table below) · SALEPRICE · SALECODE · SALEDESC
//
// Property Sale Transactions  resource_id = 5bbe6c55-bce6-4edb-9d04-68edeb6bf7b1
//   PARID (text) · FULL_ADDRESS (text) · PROPERTYHOUSENUM · PROPERTYFRACTION
//   PROPERTYADDRESSDIR (text, directional split out separately) · PROPERTYADDRESSSTREET · PROPERTYADDRESSSUF
//   PROPERTYCITY · PROPERTYSTATE · PROPERTYZIP · SCHOOLCODE · SCHOOLDESC · MUNICODE · MUNIDESC
//   SALEDATE (type "date", ISO YYYY-MM-DD — safe for BETWEEN string comparison)
//   PRICE (float8) · SALECODE (text — verified live: '0' = "VALID SALE") · SALEDESC
//
// Parcel Centroids  resource_id = 3fab7152-3f11-4788-8372-4c33f86ea813
//   PIN (text, joins to assessments/sales PARID) · LAT (numeric) · LONG (numeric)
//   COUNTY · MUNI_NAME · MUNI_LABEL · GEOID · FIPS_* · CITY_NEIGHBORHOOD · etc.
//
// LIVE TEST RESULTS (house 811, "W MONROE CIR", zip 15229):
//   - findParcelByAddress-style query returned exactly 1 row: PARID 0430N00249000000, SCHOOLCODE 28
//     (North Hills), BEDROOMS 3, FULLBATHS 1, HALFBATHS 1, FINISHEDLIVINGAREA 1794, YEARBLT 1937,
//     LOCALTOTAL 183800, FAIRMARKETTOTAL 183800, LAT 40.531648574654405, LONG -80.03182614.
//   - Disambiguation confirmed live: relaxing the query to "%MONROE CIR%" (no directional) returns
//     TWO rows — 811 E MONROE CIR (PARID 0430N00286000000) and 811 W MONROE CIR (PARID 0430N00249000000)
//     — proving the directional-prefix requirement is load-bearing, not theoretical.
//   - fetchComps 3-way JOIN (schoolCode=28, bbox 40.5166..40.5455 / -80.0501..-80.0121,
//     dates 2024-06-26..2026-06-26, SALECODE='0', PRICE>=30000, USEDESC='SINGLE FAMILY') returned
//     212 rows live (today's date is 2026-07-15; row counts drift over time as new sales record —
//     the task brief's "~170" estimate was from an earlier run). Query returned promptly, well
//     under the 20s timeout, confirming the bounding-box filter keeps this performant.

const WPRDC = (() => {
  const BASE = "https://data.wprdc.org/api/3/action/";
  const RESOURCE_ASSESSMENTS = "65855e14-549e-4992-b5be-d629afc676fa";
  const RESOURCE_SALES = "5bbe6c55-bce6-4edb-9d04-68edeb6bf7b1";
  const RESOURCE_CENTROIDS = "3fab7152-3f11-4788-8372-4c33f86ea813";
  const TIMEOUT_MS = 20000;

  // --- low-level fetch helper: datastore_search_sql with timeout + CKAN error handling ---
  async function runSql(sql) {
    const url = `${BASE}datastore_search_sql?sql=${encodeURIComponent(sql)}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let res;
    try {
      res = await fetch(url, { signal: controller.signal });
    } catch (err) {
      if (err.name === "AbortError") {
        throw new Error(`WPRDC request timed out after ${TIMEOUT_MS / 1000}s.`);
      }
      throw new Error(`WPRDC request failed: ${err.message}`);
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      let bodyText = "";
      try { bodyText = await res.text(); } catch (_) { /* ignore */ }
      throw new Error(`WPRDC HTTP error ${res.status} ${res.statusText}${bodyText ? `: ${bodyText}` : ""}`);
    }
    let body;
    try {
      body = await res.json();
    } catch (err) {
      throw new Error(`WPRDC returned invalid JSON: ${err.message}`);
    }
    if (!body.success) {
      const msg = (body.error && (body.error.message || body.error.__type)) || "unknown CKAN error";
      throw new Error(`WPRDC query failed: ${msg}`);
    }
    return body.result.records || [];
  }

  // --- helpers ---
  function sqlEscape(str) {
    return String(str).replace(/'/g, "''");
  }

  function trimField(v) {
    return typeof v === "string" ? v.trim() : v;
  }

  function num(v) {
    if (v === null || v === undefined || v === "") return null;
    const n = parseFloat(v);
    return Number.isNaN(n) ? null : n;
  }

  function intNum(v) {
    if (v === null || v === undefined || v === "") return null;
    const n = parseInt(v, 10);
    return Number.isNaN(n) ? null : n;
  }

  // Common directional prefixes that matter for disambiguation (e.g. "W MONROE CIR" vs "E MONROE CIR").
  const DIRECTIONALS = {
    N: "N", NORTH: "N",
    S: "S", SOUTH: "S",
    E: "E", EAST: "E",
    W: "W", WEST: "W",
  };

  // Common street suffixes to strip for the relaxed fallback match.
  const SUFFIXES = [
    "STREET", "ST", "AVENUE", "AVE", "DRIVE", "DR", "CIRCLE", "CIR", "ROAD", "RD",
    "LANE", "LN", "COURT", "CT", "PLACE", "PL", "BOULEVARD", "BLVD", "TERRACE", "TER",
    "WAY", "TRAIL", "TRL", "PARKWAY", "PKWY", "SQUARE", "SQ", "HIGHWAY", "HWY",
    "ALLEY", "AL", "LOOP", "PATH", "RUN", "PIKE", "EXTENSION", "EXT",
  ];

  function parseStreet(streetNameRaw) {
    const upper = String(streetNameRaw || "").trim().toUpperCase().replace(/\s+/g, " ");
    const tokens = upper.split(" ").filter(Boolean);
    let directional = null;
    let rest = tokens;
    if (tokens.length > 1 && DIRECTIONALS[tokens[0]]) {
      directional = DIRECTIONALS[tokens[0]];
      // Normalize to the single-letter form used in PROPERTYADDRESS (e.g. "W MONROE CIR").
      rest = [directional, ...tokens.slice(1)];
    }
    const full = rest.join(" ");
    let relaxed = full;
    if (rest.length > 1 && SUFFIXES.includes(rest[rest.length - 1])) {
      relaxed = rest.slice(0, -1).join(" ");
    }
    return { full, relaxed, directional };
  }

  // Columns shared by both parcel resolvers (a = assessments, c = centroids).
  const PARCEL_SELECT_COLS = `a."PARID", a."PROPERTYHOUSENUM", a."PROPERTYADDRESS", a."PROPERTYCITY", a."PROPERTYZIP",
       a."MUNICODE", a."MUNIDESC", a."SCHOOLCODE", a."SCHOOLDESC", a."BEDROOMS", a."FULLBATHS",
       a."HALFBATHS", a."FINISHEDLIVINGAREA", a."YEARBLT", a."USEDESC", a."LOCALTOTAL",
       a."COUNTYTOTAL", a."FAIRMARKETTOTAL", c."LAT", c."LONG"`;

  function mapParcelRow(r) {
    return {
      parid: trimField(r.PARID),
      address: `${trimField(r.PROPERTYHOUSENUM)} ${trimField(r.PROPERTYADDRESS)}`.trim(),
      municipality: trimField(r.MUNIDESC),
      muniCode: trimField(r.MUNICODE),
      schoolCode: trimField(r.SCHOOLCODE),
      schoolDistrict: trimField(r.SCHOOLDESC),
      bedrooms: intNum(r.BEDROOMS),
      fullBaths: intNum(r.FULLBATHS),
      halfBaths: intNum(r.HALFBATHS),
      sqft: num(r.FINISHEDLIVINGAREA),
      yearBuilt: intNum(r.YEARBLT),
      useDesc: trimField(r.USEDESC),
      assessedValue: num(r.LOCALTOTAL),
      fairMarketValue: num(r.FAIRMARKETTOTAL),
      lat: num(r.LAT),
      lon: num(r.LONG),
    };
  }

  // --- WPRDC.findParcelByAddress ---
  async function findParcelByAddress({ houseNumber, streetName, zip } = {}) {
    if (!houseNumber || !streetName) {
      throw new Error("findParcelByAddress requires houseNumber and streetName.");
    }
    const house = sqlEscape(String(houseNumber).trim());
    const { full, relaxed, directional } = parseStreet(streetName);
    const zipClause = zip ? ` AND a."PROPERTYZIP" = '${sqlEscape(String(zip).trim())}'` : "";

    const selectCols = PARCEL_SELECT_COLS;
    const fromJoin = `FROM "${RESOURCE_ASSESSMENTS}" a
LEFT JOIN "${RESOURCE_CENTROIDS}" c ON a."PARID" = c."PIN"`;

    async function queryFragment(fragment) {
      const sql = `SELECT ${selectCols}
${fromJoin}
WHERE a."PROPERTYHOUSENUM" = '${house}' AND a."PROPERTYADDRESS" LIKE '%${sqlEscape(fragment)}%'${zipClause}`;
      return runSql(sql);
    }

    // Try exact match first (with directional if present), then relaxed (suffix stripped) as fallback.
    let rows = await queryFragment(full);
    if (rows.length === 0 && relaxed !== full) {
      rows = await queryFragment(relaxed);
    }

    if (rows.length === 0) {
      throw new Error(
        `No parcel found for ${houseNumber} ${streetName}${zip ? `, ${zip}` : ""}. ` +
        `Verify the house number, street name, and zip against the county's records.`
      );
    }

    // Disambiguation: if a leading directional was given, require it in the match.
    if (rows.length > 1 && directional) {
      const directionalRows = rows.filter((r) => {
        const addr = trimField(r.PROPERTYADDRESS) || "";
        const firstToken = addr.split(" ")[0];
        return DIRECTIONALS[firstToken] === directional;
      });
      if (directionalRows.length >= 1) rows = directionalRows;
    }

    if (rows.length > 1) {
      const candidates = rows
        .map((r) => `${trimField(r.PROPERTYHOUSENUM)} ${trimField(r.PROPERTYADDRESS)}, ${trimField(r.PROPERTYCITY)} ${trimField(r.PROPERTYZIP)} (PARID ${trimField(r.PARID)})`)
        .join("; ");
      throw new Error(
        `Multiple parcels matched ${houseNumber} ${streetName}${zip ? `, ${zip}` : ""} — please disambiguate: ${candidates}`
      );
    }

    return mapParcelRow(rows[0]);
  }

  // --- WPRDC.findParcelByPoint ---
  // Spatial-first parcel resolution: identifies the host parcel from geocoded lat/lon by
  // querying parcel centroids in an expanding bounding box and taking the nearest centroid.
  // Immune to street-string drift that breaks text matching — county records abbreviate
  // ("WASHINGTON BLVD" vs Nominatim's "Washington Boulevard") and sometimes file a parcel
  // under a different street entirely (verified live 2026-07-17: 1400 Washington Blvd,
  // Pittsburgh 15206 geocodes onto parcel 0124F00248000000, recorded as "0 ORPHAN ST").
  // Expansion tiers: ±0.0002° (~70 ft) covers typical rooftop-to-centroid offsets; large
  // parcels park their centroid much farther from the rooftop (the 1400 Washington Blvd
  // parcel needed ±0.001°), hence the wider tiers. Nearest-centroid is a proxy for true
  // point-in-polygon (datastore_search_sql has no geometry ops) — the small starting box
  // minimizes the chance a neighboring parcel's centroid outranks the host's.
  const POINT_DELTAS = [0.0002, 0.0005, 0.001, 0.002];

  async function findParcelByPoint({ lat, lon } = {}) {
    const latN = Number(lat);
    const lonN = Number(lon);
    if (!Number.isFinite(latN) || !Number.isFinite(lonN)) {
      throw new Error("findParcelByPoint requires numeric lat and lon.");
    }

    for (const d of POINT_DELTAS) {
      const sql = `SELECT ${PARCEL_SELECT_COLS}
FROM "${RESOURCE_CENTROIDS}" c
JOIN "${RESOURCE_ASSESSMENTS}" a ON c."PIN" = a."PARID"
WHERE c."LAT" BETWEEN ${latN - d} AND ${latN + d}
  AND c."LONG" BETWEEN ${lonN - d} AND ${lonN + d}
LIMIT 50`;
      const rows = await runSql(sql);
      const candidates = rows.filter((r) => num(r.LAT) !== null && num(r.LONG) !== null);
      if (candidates.length > 0) {
        candidates.sort((p, q) =>
          ((num(p.LAT) - latN) ** 2 + (num(p.LONG) - lonN) ** 2) -
          ((num(q.LAT) - latN) ** 2 + (num(q.LONG) - lonN) ** 2));
        return mapParcelRow(candidates[0]);
      }
    }

    throw new Error(
      `No parcel found near (${latN.toFixed(6)}, ${lonN.toFixed(6)}) — ` +
      `the location may be outside Allegheny County or on unparceled land.`
    );
  }

  // --- WPRDC.fetchComps ---
  const COMPS_LIMIT = 2000;

  async function fetchComps({ schoolCode, minLat, maxLat, minLon, maxLon, startDate, endDate } = {}) {
    if (schoolCode === undefined || schoolCode === null || schoolCode === "") {
      throw new Error("fetchComps requires schoolCode.");
    }
    if ([minLat, maxLat, minLon, maxLon].some((v) => v === undefined || v === null || Number.isNaN(Number(v)))) {
      throw new Error("fetchComps requires a numeric bounding box: minLat, maxLat, minLon, maxLon.");
    }
    if (!startDate || !endDate) {
      throw new Error("fetchComps requires startDate and endDate (YYYY-MM-DD).");
    }

    const sql = `SELECT s."PARID", s."FULL_ADDRESS", a."MUNIDESC", s."SALEDATE", s."PRICE",
       a."BEDROOMS", a."FULLBATHS", a."HALFBATHS", a."FINISHEDLIVINGAREA", a."YEARBLT", c."LAT", c."LONG"
FROM "${RESOURCE_SALES}" s
JOIN "${RESOURCE_ASSESSMENTS}" a ON s."PARID" = a."PARID"
JOIN "${RESOURCE_CENTROIDS}" c ON s."PARID" = c."PIN"
WHERE c."LAT" BETWEEN ${Number(minLat)} AND ${Number(maxLat)}
  AND c."LONG" BETWEEN ${Number(minLon)} AND ${Number(maxLon)}
  AND s."SCHOOLCODE" = '${sqlEscape(String(schoolCode).trim())}'
  AND s."SALEDATE" BETWEEN '${sqlEscape(startDate)}' AND '${sqlEscape(endDate)}'
  AND s."SALECODE" = '0'
  AND s."PRICE" >= 30000
  AND a."USEDESC" = 'SINGLE FAMILY'
LIMIT ${COMPS_LIMIT}`;

    const rows = await runSql(sql);
    // Note: capped at COMPS_LIMIT (2000) rows — if the bounding box + filters legitimately
    // exceed this, narrow the bounding box or date range rather than raising the cap blindly,
    // since datastore_search_sql is not built for unbounded county-wide scans.
    return rows.map((r) => ({
      parid: trimField(r.PARID),
      address: trimField(r.FULL_ADDRESS),
      municipality: trimField(r.MUNIDESC),
      saleDate: trimField(r.SALEDATE),
      price: num(r.PRICE),
      bedrooms: intNum(r.BEDROOMS),
      fullBaths: intNum(r.FULLBATHS),
      halfBaths: intNum(r.HALFBATHS),
      sqft: num(r.FINISHEDLIVINGAREA),
      yearBuilt: intNum(r.YEARBLT),
      lat: num(r.LAT),
      lon: num(r.LONG),
    }));
  }

  return { findParcelByAddress, findParcelByPoint, fetchComps };
})();
