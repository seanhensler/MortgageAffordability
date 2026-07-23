// ============================================================================
// AddressSearch — self-contained address lookup module.
//
// Geocoding is done via the US Census Bureau Geocoder — a free, keyless public
// API (no API key, no billing account required). Just include this file:
//
//   <script src="places.js"></script>
//
// CENSUS GEOCODER:
//   Endpoint:  https://geocoding.geo.census.gov/geocoder/locations/onelineaddress
//   Params:    address=<the raw text the user typed, URL-encoded>
//              benchmark=Public_AR_Current
//              format=jsonp&callback=<generated>
//   TRANSPORT IS JSONP, NOT fetch(): verified live 2026-07-17 that this endpoint
//   sends NO Access-Control-Allow-Origin header (with or without an Origin on the
//   request), so a browser fetch() always fails CORS. The Census geocoder
//   officially supports format=jsonp&callback=, so the request is made by
//   injecting a <script> tag (exempt from CORS, works from file:// too) whose
//   response invokes a one-shot generated global callback. A 10s timer treats a
//   slow/unreachable service as "no match"; the callback + tag are always
//   cleaned up.
//
//   Response shape (relevant parts):
//     {
//       result: {
//         addressMatches: [
//           {
//             matchedAddress: "811 W MONROE CIR, PITTSBURGH, PA, 15229",
//             coordinates: { x: <longitude>, y: <latitude> },
//             ...
//           },
//           ...
//         ]
//       }
//     }
//   Note coordinates.x is LONGITUDE and coordinates.y is LATITUDE (GeoJSON-style
//   x/y ordering, not lat/lon ordering) — every access below is guarded since
//   addressMatches may be missing, empty, or malformed.
//
//   The first match (addressMatches[0]) is used. Its lat/lon are sanity-checked
//   against a generous Allegheny County, PA bounding box; a match outside that
//   box is treated the same as "no match".
//
// PUBLIC CONTRACT:
//   AddressSearch.init({
//     inputEl,            // <input type="text"> for the address
//     statusEl,           // element to receive status/error text
//     onAddressResolved,  // callback({ formattedAddress, lat, lon, houseNumber, streetName, zip, source })
//     countyBadgeEl,      // OPTIONAL <span>/<div> — live "✓ Allegheny County" /
//                         // "⚠ Outside Allegheny County" confirmation badge, debounced
//                         // 600ms after typing pauses. Independent of the Look up/Enter
//                         // flow below: it never calls onAddressResolved, never fetches
//                         // comps, never switches tabs — validation feedback only. Omit
//                         // to skip this feature entirely (no behavior change otherwise).
//   })
//
//   A "Look up" button is always rendered after inputEl, and Enter on inputEl
//   triggers the same lookup.
//
//   On a successful, in-county Census match:
//     onAddressResolved({ formattedAddress: matchedAddress, lat, lon,
//                          houseNumber, streetName, zip, source: 'census' })
//     — houseNumber/streetName/zip come from parseManualAddress() run on the
//     ORIGINAL typed input; they ride along as fallback-only fields even
//     though the app resolves the parcel spatially from lat/lon in this case.
//
//   On no match, an out-of-county match, or a fetch/timeout failure:
//     statusEl explains what happened, and — as long as the typed text still
//     parses as a manual address — onAddressResolved is still called:
//       onAddressResolved({ formattedAddress: <raw input>, lat: null, lon: null,
//                            houseNumber, streetName, zip, source: 'manual' })
//     app.js is expected to take it from there (Nominatim geocode, then a
//     county text-match fallback). The callback is skipped only when
//     parseManualAddress() also fails to make sense of the input, in which
//     case statusEl shows a parse-error message instead.
// ============================================================================

const AddressSearch = (() => {
  // Allegheny County, PA approximate bounding box — used only as a sanity
  // check on Census results, not to restrict what the user can type.
  const COUNTY_MIN_LAT = 40.19;
  const COUNTY_MAX_LAT = 40.67;
  const COUNTY_MIN_LON = -80.36;
  const COUNTY_MAX_LON = -79.69;

  const CENSUS_ENDPOINT = "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress";
  const CENSUS_BENCHMARK = "Public_AR_Current";
  const FETCH_TIMEOUT_MS = 10000;

  function isWithinCounty(lat, lon) {
    return (
      typeof lat === "number" &&
      typeof lon === "number" &&
      lat >= COUNTY_MIN_LAT &&
      lat <= COUNTY_MAX_LAT &&
      lon >= COUNTY_MIN_LON &&
      lon <= COUNTY_MAX_LON
    );
  }

  // --- Manual address parser ---
  // Parses forms like "811 W Monroe Cir, Pittsburgh, PA 15229". Directionals (N/S/E/W) are
  // kept as part of streetName. Zip is optional and only extracted, never required.
  // Used both as the last-resort fallback (when Census can't resolve an address) and to
  // populate the fallback-only houseNumber/streetName/zip fields even on a Census success.
  function parseManualAddress(raw) {
    const trimmed = (raw || "").trim();
    if (!trimmed) return null;

    const houseMatch = trimmed.match(/^(\d+[A-Za-z]?)\s+(.+)/);
    if (!houseMatch) return null; // no leading house number — can't parse

    const houseNumber = houseMatch[1];
    const rest = houseMatch[2];

    const zipMatch = rest.match(/\b(\d{5})(?:-\d{4})?\b/);
    const zip = zipMatch ? zipMatch[1] : "";

    let streetName = rest.split(",")[0].trim();
    if (!rest.includes(",")) {
      // No commas at all — strip a trailing zip and/or 2-letter state code that may have
      // been typed directly after the street (e.g. "811 W Monroe Cir PA 15229").
      streetName = streetName.replace(/\b\d{5}(-\d{4})?\b/, "").trim();
      streetName = streetName.replace(/\b[A-Za-z]{2}\b$/, "").trim();
    }

    if (!streetName) return null;
    return { houseNumber, streetName, zip };
  }

  // --- Census geocoder lookup (JSONP transport — see header for why not fetch) ---
  // Resolves to { lat, lon, matchedAddress } or null. Never rejects: timeout, script
  // load failure, and malformed payloads all resolve null so the caller's fallback
  // chain runs. The generated callback is one-shot and both it and the <script> tag
  // are removed on every exit path.
  function fetchCensusMatch(rawAddress) {
    return new Promise((resolve) => {
      const cbName = "__censusJsonp" + Date.now() + "_" + Math.floor(Math.random() * 1e6);
      const script = document.createElement("script");
      let settled = false;

      const finish = (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try { delete window[cbName]; } catch (_) { window[cbName] = undefined; }
        if (script.parentNode) script.parentNode.removeChild(script);
        resolve(value);
      };

      const timer = setTimeout(() => finish(null), FETCH_TIMEOUT_MS);

      window[cbName] = (data) => {
        const matches =
          data && data.result && Array.isArray(data.result.addressMatches) ? data.result.addressMatches : [];
        if (matches.length === 0) return finish(null);

        const best = matches[0];
        const coordinates = best && best.coordinates ? best.coordinates : null;
        const lat = coordinates && typeof coordinates.y === "number" ? coordinates.y : null;
        const lon = coordinates && typeof coordinates.x === "number" ? coordinates.x : null;
        const matchedAddress = best && typeof best.matchedAddress === "string" ? best.matchedAddress : "";

        if (lat === null || lon === null || !matchedAddress) return finish(null);
        finish({ lat, lon, matchedAddress });
      };

      script.src =
        CENSUS_ENDPOINT +
        "?address=" +
        encodeURIComponent(rawAddress) +
        "&benchmark=" +
        encodeURIComponent(CENSUS_BENCHMARK) +
        "&format=jsonp&callback=" +
        cbName;
      script.onerror = () => finish(null);
      document.head.appendChild(script);
    });
  }

  // --- Debounced live county-confirmation badge ---
  // Independent of the explicit Look up/Enter flow below: as the user types, once the text
  // plausibly parses as a full address, a debounced (600ms after typing pauses) Census probe
  // updates a small "Allegheny County" badge next to the input — validation feedback only, no
  // parcel resolution, no comps fetch, no tab switch. A monotonic request token discards any
  // response that resolves after a newer keystroke has already fired a fresher probe.
  const BADGE_DEBOUNCE_MS = 600;

  function setupCountyBadge(inputEl, badgeEl) {
    if (!badgeEl) return;
    let timer = null;
    let requestToken = 0;

    function setBadge(state) {
      badgeEl.className = "county-badge" + (state ? ` county-badge-${state}` : "");
      badgeEl.textContent =
        state === "in" ? "✓ Allegheny County" : state === "out" ? "⚠ Outside Allegheny County" : "";
    }

    inputEl.addEventListener("input", () => {
      clearTimeout(timer);
      const trimmed = (inputEl.value || "").trim();
      setBadge(null); // clear stale confirmation immediately on any edit

      if (!trimmed || !parseManualAddress(trimmed)) return; // not yet a plausible full address

      timer = setTimeout(async () => {
        const token = ++requestToken;
        const match = await fetchCensusMatch(trimmed);
        if (token !== requestToken) return; // a newer keystroke has since superseded this probe
        if (!match) { setBadge(null); return; } // inconclusive — still mid-typing, no verdict
        setBadge(isWithinCounty(match.lat, match.lon) ? "in" : "out");
      }, BADGE_DEBOUNCE_MS);
    });
  }

  function setupLookup(config) {
    const { inputEl, statusEl, onAddressResolved, countyBadgeEl } = config;
    setupCountyBadge(inputEl, countyBadgeEl);

    statusEl.textContent =
      "Type a full address and press Enter or Look up — resolved via the free US Census geocoder.";

    const lookupBtn = document.createElement("button");
    lookupBtn.type = "button";
    lookupBtn.textContent = "Look up";
    lookupBtn.className = "lookup-btn";
    if (inputEl.parentNode) inputEl.parentNode.insertBefore(lookupBtn, inputEl.nextSibling);

    let lookupInFlight = false;

    const runLookup = async () => {
      if (lookupInFlight) return;

      const raw = inputEl.value;
      const trimmed = (raw || "").trim();
      if (!trimmed) {
        statusEl.textContent = "Enter an address first.";
        return;
      }

      const parsed = parseManualAddress(trimmed);

      lookupInFlight = true;
      statusEl.textContent = "Looking up address via US Census geocoder…";

      const match = await fetchCensusMatch(trimmed);
      lookupInFlight = false;

      if (match && isWithinCounty(match.lat, match.lon)) {
        statusEl.textContent = `Census match: ${match.matchedAddress}`;
        onAddressResolved({
          formattedAddress: match.matchedAddress,
          lat: match.lat,
          lon: match.lon,
          houseNumber: parsed ? parsed.houseNumber : "",
          streetName: parsed ? parsed.streetName : "",
          zip: parsed ? parsed.zip : "",
          source: "census",
        });
        return;
      }

      if (match && !isWithinCounty(match.lat, match.lon)) {
        statusEl.textContent = "That address appears to be outside Allegheny County — trying map geocoder + county records…";
      } else {
        statusEl.textContent = "Census geocoder found no match — trying map geocoder + county records…";
      }

      if (!parsed) {
        statusEl.textContent = 'Could not parse that address — try a format like "811 W Monroe Cir, Pittsburgh, PA 15229".';
        return;
      }

      onAddressResolved({
        formattedAddress: trimmed,
        lat: null,
        lon: null,
        houseNumber: parsed.houseNumber,
        streetName: parsed.streetName,
        zip: parsed.zip,
        source: "manual",
      });
    };

    lookupBtn.addEventListener("click", runLookup);
    inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        runLookup();
      }
    });
  }

  function init(config) {
    if (!config || !config.inputEl || !config.statusEl || typeof config.onAddressResolved !== "function") {
      throw new Error("AddressSearch.init requires inputEl, statusEl, and onAddressResolved");
    }

    setupLookup(config);
  }

  return { init };
})();
