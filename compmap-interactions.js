// Interaction & event bridge between the Comparable Sales table and the comps map.
// The tbody is re-rendered (innerHTML) on every filter change (see app.js applyCompFilters),
// so this module binds ONE delegated listener pair on the tbody itself rather than per-row
// listeners — no rebinding needed after each re-render, and nothing to leak.
//
// Contract this module relies on:
//   - tbody rows carry data-key="${parid}|${saleDate}" (rows that are not .no-comps-row)
//   - CompMap.highlight(key, on) — scales/pans/opens the matching blue marker (on=true) or
//     reverts it (on=false)
//   - CompMap.onMarkerClick(cb) — cb(key) fires when a blue marker is clicked
//
// This module owns two CSS hooks on <tr> (styling is the integrator's job):
//   - 'row-active' — toggled on hover/leave, mirrors the map highlight state
//   - 'row-flash'  — added briefly when a table row is jumped-to from a marker click

const CompInteractions = (() => {
  const FLASH_DURATION_MS = 1600;

  let bound = false;
  let tbodyEl = null;
  let activeKey = null; // key of the row currently highlighted (mouse-hovered)
  let activeTr = null; // the <tr> that owns activeKey, tracked directly so reverting
                        // never needs a DOM query on the hover path
  let flashTimer = null;
  let flashedRow = null;

  function hasCompMap() {
    return typeof CompMap !== "undefined";
  }

  function rowForEvent(evt) {
    const tr = evt.target.closest ? evt.target.closest("tr[data-key]") : null;
    // closest() can walk outside the tbody if the tbody itself somehow matches nothing;
    // guard so we never act on a row that isn't actually inside our bound tbody.
    return tr && tbodyEl.contains(tr) ? tr : null;
  }

  // Revert whatever row/key is currently active (if any). No DOM query — uses the
  // tracked activeTr reference directly.
  function revertActive() {
    if (activeKey === null) return;
    if (activeTr) activeTr.classList.remove("row-active");
    if (hasCompMap()) CompMap.highlight(activeKey, false);
    activeKey = null;
    activeTr = null;
  }

  function setActive(tr, key) {
    if (key === activeKey) return; // no-op: same row re-entered via a child element
    revertActive(); // covers the "moved directly between adjacent rows" case too
    activeKey = key;
    activeTr = tr;
    tr.classList.add("row-active");
    if (hasCompMap()) CompMap.highlight(key, true);
  }

  function handleMouseOver(evt) {
    const tr = rowForEvent(evt);
    if (!tr) return;
    setActive(tr, tr.dataset.key);
  }

  function handleMouseOut(evt) {
    const tr = rowForEvent(evt);
    if (!tr) return;
    // If the pointer moved to another element still inside the same row, this isn't a
    // real "leave" — ignore it (relatedTarget is null for e.g. leaving the viewport).
    const related = evt.relatedTarget;
    if (related && tr.contains(related)) return;
    if (tr !== activeTr) return; // stale event churn, not the active row
    revertActive();
  }

  // Minimal CSS.escape fallback for building an attribute selector from a key that may
  // contain characters like quotes; composite keys here are `${parid}|${saleDate}` so this
  // is mostly defensive.
  function cssEscape(str) {
    if (typeof CSS !== "undefined" && CSS.escape) return CSS.escape(str);
    return String(str).replace(/["\\]/g, "\\$&");
  }

  function handleMarkerClick(key) {
    if (!tbodyEl) return;
    const tr = tbodyEl.querySelector(`tr[data-key="${cssEscape(key)}"]`);
    if (!tr) return;

    tr.scrollIntoView({ block: "nearest", behavior: "smooth" });

    if (flashTimer !== null) {
      clearTimeout(flashTimer);
      if (flashedRow) flashedRow.classList.remove("row-flash");
    }
    tr.classList.add("row-flash");
    flashedRow = tr;
    flashTimer = setTimeout(() => {
      tr.classList.remove("row-flash");
      flashTimer = null;
      flashedRow = null;
    }, FLASH_DURATION_MS);
  }

  function bind({ tbodyEl: el }) {
    if (bound) return; // idempotent — do not double-bind
    if (!el) {
      console.warn("CompInteractions.bind: no tbodyEl provided — skipping bind.");
      return;
    }
    tbodyEl = el;

    tbodyEl.addEventListener("mouseover", handleMouseOver);
    tbodyEl.addEventListener("mouseout", handleMouseOut);

    if (hasCompMap()) {
      CompMap.onMarkerClick(handleMarkerClick);
    } else {
      console.warn("CompInteractions.bind: CompMap module not loaded — map sync disabled, row highlighting still active.");
    }

    bound = true;
  }

  return { bind };
})();
