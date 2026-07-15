// ============================================================================
// AddressSearch — self-contained address lookup module.
//
// INTEGRATION (add to index.html, before places.js, replacing YOUR_API_KEY):
//
//   <script async defer src="https://maps.googleapis.com/maps/api/js?key=YOUR_API_KEY&libraries=places"></script>
//   <script src="places.js"></script>
//
// No `callback=` query param is required on the Maps script tag. Because the
// script loads async/defer, window.google.maps.places may not exist yet at
// the moment AddressSearch.init() runs — init() polls briefly for readiness
// (see waitForGoogle below) before falling back to manual entry. If the
// <script> tag is omitted entirely (no API key available), AddressSearch
// falls back to manual entry immediately once polling times out.
//
// BILLING NOTES (Google path only):
//   - Autocomplete is restricted to fields: ['address_components', 'formatted_address', 'geometry']
//     via the constructor options, so no extra (billable) fields are ever requested.
//   - An AutocompleteSessionToken is created once per keystroke session and reused across
//     every keystroke; a fresh token is generated immediately after each place_changed
//     selection, per Google's session-based Autocomplete pricing model.
//   - Predictions are biased/restricted to Allegheny County, PA via setBounds/strictBounds
//     plus componentRestrictions: { country: 'us' }, cutting down irrelevant/out-of-area
//     predictions (and re-queries) during typing.
//
// PUBLIC CONTRACT:
//   AddressSearch.init({
//     inputEl,            // <input type="text"> for the address
//     statusEl,           // element to receive status/error text
//     onAddressResolved,  // callback({ formattedAddress, lat, lon, houseNumber, streetName, zip, source })
//   })
//   source is 'google' when resolved via Places Autocomplete, 'manual' when resolved via the
//   plain-text fallback parser (lat/lon are null in the manual case — a separate WPRDC module
//   is expected to resolve coordinates from county parcel centroids).
// ============================================================================

const AddressSearch = (() => {
  // Allegheny County, PA approximate bounding box.
  const COUNTY_BOUNDS_SW = { lat: 40.19, lng: -80.36 };
  const COUNTY_BOUNDS_NE = { lat: 40.67, lng: -79.69 };
  const REQUIRED_COUNTY = "Allegheny County";
  const REQUIRED_STATE_SHORT = "PA";

  const GOOGLE_POLL_INTERVAL_MS = 200;
  const GOOGLE_POLL_TIMEOUT_MS = 2500;

  let googleAutocomplete = null;
  let googleSessionToken = null;

  function isGoogleReady() {
    return !!(window.google && window.google.maps && window.google.maps.places && window.google.maps.places.Autocomplete);
  }

  // Polls briefly for the async/defer Maps script to finish loading before deciding
  // whether to wire up Google Autocomplete or fall back to manual entry.
  function waitForGoogle(onReady, onTimeout) {
    if (isGoogleReady()) {
      onReady();
      return;
    }
    const start = Date.now();
    const timer = setInterval(() => {
      if (isGoogleReady()) {
        clearInterval(timer);
        onReady();
      } else if (Date.now() - start > GOOGLE_POLL_TIMEOUT_MS) {
        clearInterval(timer);
        onTimeout();
      }
    }, GOOGLE_POLL_INTERVAL_MS);
  }

  // --- address_components helpers ---
  function getComponent(components, type, useShortName) {
    const match = (components || []).find((c) => c.types && c.types.includes(type));
    if (!match) return "";
    return useShortName ? match.short_name : match.long_name;
  }

  function setupGoogleAutocomplete(config) {
    const { inputEl, statusEl, onAddressResolved } = config;
    const bounds = new google.maps.LatLngBounds(COUNTY_BOUNDS_SW, COUNTY_BOUNDS_NE);
    googleSessionToken = new google.maps.places.AutocompleteSessionToken();

    googleAutocomplete = new google.maps.places.Autocomplete(inputEl, {
      fields: ["address_components", "formatted_address", "geometry"], // billing: minimum fields only
      sessionToken: googleSessionToken,
      bounds,
      strictBounds: true, // hard geofence to the Allegheny County box, not just a soft bias
      componentRestrictions: { country: "us" },
    });

    statusEl.textContent = "Start typing an address (Allegheny County, PA only).";

    googleAutocomplete.addListener("place_changed", () => {
      const place = googleAutocomplete.getPlace();

      if (!place || !place.geometry || !place.geometry.location) {
        statusEl.textContent = "No details available for that selection — try again.";
        regenerateSessionToken();
        return;
      }

      const components = place.address_components;
      const county = getComponent(components, "administrative_area_level_2", false);
      const stateShort = getComponent(components, "administrative_area_level_1", true);

      if (county !== REQUIRED_COUNTY || stateShort !== REQUIRED_STATE_SHORT) {
        statusEl.textContent = `That address is outside Allegheny County, PA (got: ${county || "unknown county"}, ${stateShort || "unknown state"}). Please choose an in-county address.`;
        regenerateSessionToken();
        return; // guard: do not fire onAddressResolved for out-of-county selections
      }

      const houseNumber = getComponent(components, "street_number", false);
      const streetName = getComponent(components, "route", false);
      const zip = getComponent(components, "postal_code", false);

      statusEl.textContent = `Resolved: ${place.formatted_address}`;

      onAddressResolved({
        formattedAddress: place.formatted_address,
        lat: place.geometry.location.lat(),
        lon: place.geometry.location.lng(),
        houseNumber,
        streetName,
        zip,
        source: "google",
      });

      regenerateSessionToken();
    });
  }

  function regenerateSessionToken() {
    googleSessionToken = new google.maps.places.AutocompleteSessionToken();
    if (googleAutocomplete) googleAutocomplete.set("sessionToken", googleSessionToken);
  }

  // --- Manual fallback ---
  // Parses forms like "811 W Monroe Cir, Pittsburgh, PA 15229". Directionals (N/S/E/W) are
  // kept as part of streetName. Zip is optional and only extracted, never required.
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

  function setupManualFallback(config) {
    const { inputEl, statusEl, onAddressResolved } = config;

    statusEl.textContent = "Google autocomplete is not configured — type a full address and press Enter or Look up. County-records lookup will resolve the parcel location.";

    const lookupBtn = document.createElement("button");
    lookupBtn.type = "button";
    lookupBtn.textContent = "Look up";
    lookupBtn.className = "secondary-btn";
    lookupBtn.style.marginLeft = "8px";
    if (inputEl.parentNode) inputEl.parentNode.insertBefore(lookupBtn, inputEl.nextSibling);

    const runLookup = () => {
      const parsed = parseManualAddress(inputEl.value);
      if (!parsed) {
        statusEl.textContent = 'Could not parse that address — try a format like "811 W Monroe Cir, Pittsburgh, PA 15229".';
        return;
      }

      statusEl.textContent = `Using manual entry: ${parsed.houseNumber} ${parsed.streetName}${parsed.zip ? ", " + parsed.zip : ""} — resolving location from county records.`;

      onAddressResolved({
        formattedAddress: inputEl.value.trim(),
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

    waitForGoogle(
      () => setupGoogleAutocomplete(config),
      () => setupManualFallback(config)
    );
  }

  return { init };
})();
