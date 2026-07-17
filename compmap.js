// Comp Map — renders the same filtered comps array (see comps.js / app.js compState) onto a
// Leaflet map: one red target marker + 1-mile radius circle, one blue marker per comp.
// No fetch, no filtering logic here — purely a rendering + interaction layer that mirrors
// whatever array app.js hands it. Global `CompMap` object (IIFE), matches app.js code style.
//
// Requires globals `L` (Leaflet) and, optionally, `GeoSearch` (leaflet-geosearch UMD) —
// see index.html CDN tags. Geosearch is optional: if window.GeoSearch is missing, the map
// still renders, just without the address search bar.

const CompMap = (() => {
  const DEFAULT_CENTER = [40.44, -80.0]; // Allegheny County center
  const DEFAULT_ZOOM = 11;
  const TARGET_ZOOM = 14;
  const RADIUS_METERS = 1609.34; // 1.0 mile
  const TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
  const TILE_ATTRIBUTION = "&copy; OpenStreetMap contributors";
  // Strict Allegheny County bounding box (west,south,east,north) for Nominatim's `viewbox`.
  const ALLEGHENY_VIEWBOX = "-80.35,40.19,-79.68,40.68";

  let map = null;
  let compLayerGroup = null; // single L.layerGroup for all blue comp markers — clearLayers()
                              // drops markers AND their listeners together (no leak on re-render)
  let targetMarker = null;
  let targetCircle = null;
  let markerRegistry = new Map(); // composite key (parid|saleDate) -> L.Marker
  let clickCallbacks = [];
  let initialized = false;

  function warnNotReady(method) {
    console.warn(`CompMap.${method}: called before CompMap.init() succeeded, or window.L (Leaflet) is missing — no-op.`);
  }

  function isReady() {
    return initialized && typeof window.L !== "undefined" && map !== null;
  }

  // Composite key: two recorded sales can share a parid (a property that sold twice in the
  // lookback window), so parid alone is not unique — pair it with saleDate.
  function keyFor(row) {
    return `${row.parid}|${row.saleDate}`;
  }

  // Builds a CSS-only pin (no external image assets) via L.divIcon.
  //
  // IMPORTANT implementation note: Leaflet positions a marker's icon element by writing an
  // inline `transform: translate3d(...)` (plus inline margin-left/margin-top for the anchor)
  // directly onto the div returned by createIcon() — which is exactly the element
  // marker.getElement() returns. A plain (non-!important) CSS rule setting `transform` on
  // that same element would be silently beaten by Leaflet's inline style, so rotating/scaling
  // that outer div via CSS is unsafe (it would either no-op or, if forced with !important,
  // wipe out Leaflet's positioning transform and the marker would jump to the wrong pixel).
  // So the outer div (className below, exactly 'cm-pin cm-pin-red'/'cm-pin cm-pin-blue' per
  // spec) stays untransformed and is used only as Leaflet's positioning anchor + a class hook;
  // the actual visual pin (circle + pointer + dot) is drawn on an INNER <span class="cm-pin-shape">
  // that highlight() scales via a descendant selector (.cm-pin-highlight .cm-pin-shape) in
  // compmap.css. See CompMap.highlight() below for the other half of this.
  function buildPinIcon(color, opts) {
    opts = opts || {};
    const target = !!opts.target;
    const size = target ? 32 : 24;
    const classes = ["cm-pin", `cm-pin-${color}`];
    if (target) classes.push("cm-pin-target");
    return L.divIcon({
      className: classes.join(" "),
      html: '<span class="cm-pin-shape"><span class="cm-pin-dot"></span></span>',
      iconSize: [size, size],
      iconAnchor: [size / 2, size],
      popupAnchor: [0, -size + 4],
    });
  }

  function fmtMoney(n) {
    if (typeof n !== "number" || isNaN(n)) return "n/a";
    return "$" + Math.round(n).toLocaleString("en-US");
  }

  function fmtSqft(n) {
    if (!n && n !== 0) return "n/a";
    return Math.round(n).toLocaleString("en-US") + " sq ft";
  }

  function compPopupHtml(row) {
    return `
      <div class="cm-popup">
        <div class="cm-popup-addr">${row.address || "Unknown address"}</div>
        <div class="cm-popup-row">${fmtMoney(row.price)}</div>
        <div class="cm-popup-row">${row.saleDate || ""}</div>
        <div class="cm-popup-row">${fmtSqft(row.sqft)}</div>
      </div>`;
  }

  function targetPopupHtml(label) {
    return `
      <div class="cm-popup">
        <div class="cm-popup-addr">${label || "Search location"}</div>
        <div class="cm-popup-row">Search center &mdash; 1 mile radius</div>
      </div>`;
  }

  // --- Nominatim address-field parsing (primary path: addressdetails=1 on the request) ---
  function parseFromAddressDetails(raw) {
    const addr = (raw && raw.address) || {};
    return {
      houseNumber: addr.house_number || null,
      streetName: addr.road || addr.pedestrian || addr.street || null,
      zip: addr.postcode || null,
      county: addr.county || null,
    };
  }

  // Fallback if raw.address is missing for some reason: label looks like
  // "811, West Monroe Circle, Pittsburgh, Allegheny County, Pennsylvania, 15229, United States"
  function parseFromLabel(label) {
    const parts = (label || "").split(",").map((s) => s.trim()).filter(Boolean);
    const houseNumber = parts.length && /^\d+[A-Za-z]?$/.test(parts[0]) ? parts[0] : null;
    const streetName = parts.length > 1 ? parts[1] : null;
    const zipMatch = (label || "").match(/\b\d{5}\b/);
    return {
      houseNumber,
      streetName,
      zip: zipMatch ? zipMatch[0] : null,
      county: parts.find((p) => /county/i.test(p)) || null,
    };
  }

  function wireGeosearch(opts) {
    if (typeof window.GeoSearch === "undefined") {
      console.warn("CompMap.init: window.GeoSearch not found — address search control skipped (map still functional).");
      return;
    }

    const provider = new GeoSearch.OpenStreetMapProvider({
      params: {
        viewbox: ALLEGHENY_VIEWBOX,
        bounded: 1,
        countrycodes: "us",
        addressdetails: 1,
      },
    });

    // autoComplete: false — Nominatim's usage policy prohibits per-keystroke autocomplete
    // queries; search fires only when the user submits.
    const searchControl = new GeoSearch.GeoSearchControl({
      provider,
      style: "bar",
      autoComplete: false,
      showMarker: false, // CompMap.setTarget() owns the target marker; avoid a duplicate
      showPopup: false,
      searchLabel: "Search address (Allegheny County)…",
      autoClose: true,
      keepResult: true,
    });
    map.addControl(searchControl);

    map.on("geosearch/showlocation", (e) => {
      const loc = e.location || {};
      const lat = loc.y;
      const lon = loc.x;
      const label = loc.label || "";
      const raw = loc.raw || {};
      const details = parseFromAddressDetails(raw);
      const fallback = parseFromLabel(label);
      const county = details.county || fallback.county || "";

      // Belt-and-suspenders on top of the viewbox/bounded params: Nominatim's bounding box
      // can still admit results right at the county line, so double check the county field.
      if (county && county.indexOf("Allegheny") === -1) {
        console.warn(`CompMap: geosearch result outside Allegheny County ("${county}") — ignored.`);
        return;
      }

      if (typeof opts.onAddressPicked === "function") {
        opts.onAddressPicked({
          lat,
          lon,
          label,
          houseNumber: details.houseNumber || fallback.houseNumber,
          streetName: details.streetName || fallback.streetName,
          zip: details.zip || fallback.zip,
        });
      }
    });
  }

  function init(containerEl, opts) {
    opts = opts || {};
    if (typeof window.L === "undefined") {
      console.warn("CompMap.init: window.L (Leaflet) is not loaded — map not initialized.");
      return;
    }
    if (initialized) return; // idempotent

    map = L.map(containerEl, {
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
    });

    L.tileLayer(TILE_URL, { maxZoom: 19, attribution: TILE_ATTRIBUTION }).addTo(map);

    compLayerGroup = L.layerGroup().addTo(map);

    wireGeosearch(opts);

    initialized = true;
  }

  function setTarget(point) {
    if (!isReady()) return warnNotReady("setTarget");
    if (!point || typeof point.lat !== "number" || typeof point.lon !== "number") {
      console.warn("CompMap.setTarget: point requires numeric lat/lon — ignored.");
      return;
    }
    const latlng = [point.lat, point.lon];

    if (targetMarker) map.removeLayer(targetMarker);
    if (targetCircle) map.removeLayer(targetCircle);

    targetMarker = L.marker(latlng, {
      icon: buildPinIcon("red", { target: true }),
      zIndexOffset: 1000, // stay above blue comp markers
    })
      .addTo(map)
      .bindPopup(targetPopupHtml(point.label));

    targetCircle = L.circle(latlng, {
      radius: RADIUS_METERS,
      color: "#C0392B",
      weight: 1.5,
      dashArray: "6 6",
      fillColor: "#C0392B",
      fillOpacity: 0.05,
      interactive: false,
    }).addTo(map);

    map.setView(latlng, TARGET_ZOOM);
  }

  function renderComps(comps) {
    if (!isReady()) return warnNotReady("renderComps");

    compLayerGroup.clearLayers(); // drops old markers + their click listeners together
    markerRegistry = new Map();

    const rows = Array.isArray(comps) ? comps : [];
    const plottedLatLngs = [];

    rows.forEach((row) => {
      if (typeof row.lat !== "number" || typeof row.lon !== "number") return;
      const key = keyFor(row);
      const marker = L.marker([row.lat, row.lon], { icon: buildPinIcon("blue") });
      marker.bindPopup(compPopupHtml(row));
      marker.on("click", () => {
        clickCallbacks.forEach((cb) => {
          try {
            cb(key);
          } catch (err) {
            console.error("CompMap: onMarkerClick callback threw:", err);
          }
        });
      });
      marker.addTo(compLayerGroup);
      markerRegistry.set(key, marker);
      plottedLatLngs.push([row.lat, row.lon]);
    });

    if (plottedLatLngs.length) {
      if (targetMarker) plottedLatLngs.push(targetMarker.getLatLng());
      map.fitBounds(L.latLngBounds(plottedLatLngs), { padding: [30, 30], maxZoom: 15 });
    }
  }

  function highlight(key, on) {
    if (!isReady()) return warnNotReady("highlight");
    const marker = markerRegistry.get(key);
    if (!marker) return;

    const el = marker.getElement(); // outer Leaflet-positioned div — see buildPinIcon() note
    if (on) {
      if (el) el.classList.add("cm-pin-highlight");
      marker.openPopup();
      if (!map.getBounds().contains(marker.getLatLng())) {
        map.panTo(marker.getLatLng(), { animate: true, duration: 0.4 });
      }
    } else {
      if (el) el.classList.remove("cm-pin-highlight");
      marker.closePopup();
    }
  }

  function onMarkerClick(cb) {
    if (!isReady()) return warnNotReady("onMarkerClick");
    if (typeof cb === "function") clickCallbacks.push(cb);
  }

  function invalidate() {
    if (!isReady()) return warnNotReady("invalidate");
    map.invalidateSize();
  }

  return { init, setTarget, renderComps, highlight, onMarkerClick, invalidate };
})();
