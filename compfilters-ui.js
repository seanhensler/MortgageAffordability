// Filter control panel for the Comparable Sales tab.
// Renders dropdowns/inputs from CompFilters.FILTER_OPTIONS and reports changes upward;
// performs NO filtering itself — app.js re-derives the filtered array + KPIs on change.

const CompFilterPanel = (() => {
  const SQFT_DEBOUNCE_MS = 250;

  let els = null; // { months, minBeds, minBaths, maxDistance, minSqft, maxSqft }

  function makeSelect(options, defaultValue) {
    const sel = document.createElement("select");
    options.forEach((opt) => {
      const o = document.createElement("option");
      o.value = opt.value;
      o.textContent = opt.label;
      if (opt.value === defaultValue) o.selected = true;
      sel.appendChild(o);
    });
    return sel;
  }

  function makeGroup(labelText, controlEl) {
    const label = document.createElement("label");
    label.className = "comp-filter-group";
    label.appendChild(document.createTextNode(labelText));
    label.appendChild(controlEl);
    return label;
  }

  function render(containerEl, { onChange }) {
    if (typeof CompFilters === "undefined") {
      console.error("CompFilterPanel: CompFilters module not loaded — panel not rendered.");
      return;
    }
    containerEl.innerHTML = ""; // idempotent re-render

    const defaults = CompFilters.defaultFilters();
    const opts = CompFilters.FILTER_OPTIONS;

    els = {
      months: makeSelect(opts.months, defaults.months),
      minBeds: makeSelect(opts.minBeds, defaults.minBeds),
      minBaths: makeSelect(opts.minBaths, defaults.minBaths),
      maxDistance: makeSelect(opts.maxDistance, defaults.maxDistance),
      minSqft: document.createElement("input"),
      maxSqft: document.createElement("input"),
    };
    [["minSqft", "min"], ["maxSqft", "max"]].forEach(([key, ph]) => {
      els[key].type = "number";
      els[key].min = "0";
      els[key].step = "50";
      els[key].placeholder = ph;
      els[key].className = "comp-filter-sqft";
    });

    const panel = document.createElement("div");
    panel.className = "comp-filters";
    panel.appendChild(makeGroup("Sale date", els.months));
    panel.appendChild(makeGroup("Beds", els.minBeds));
    panel.appendChild(makeGroup("Baths", els.minBaths));
    panel.appendChild(makeGroup("Distance", els.maxDistance));
    panel.appendChild(makeGroup("Min sq ft", els.minSqft));
    panel.appendChild(makeGroup("Max sq ft", els.maxSqft));

    const resetBtn = document.createElement("button");
    resetBtn.type = "button";
    resetBtn.className = "secondary-btn comp-filter-reset";
    resetBtn.textContent = "Reset";
    panel.appendChild(resetBtn);

    containerEl.appendChild(panel);

    const fire = () => onChange(getFilters());
    [els.months, els.minBeds, els.minBaths, els.maxDistance].forEach((sel) =>
      sel.addEventListener("change", fire)
    );

    let sqftTimer = null;
    const fireDebounced = () => {
      clearTimeout(sqftTimer);
      sqftTimer = setTimeout(fire, SQFT_DEBOUNCE_MS);
    };
    els.minSqft.addEventListener("input", fireDebounced);
    els.maxSqft.addEventListener("input", fireDebounced);

    resetBtn.addEventListener("click", () => {
      els.months.value = defaults.months;
      els.minBeds.value = defaults.minBeds;
      els.minBaths.value = defaults.minBaths;
      els.maxDistance.value = defaults.maxDistance;
      els.minSqft.value = "";
      els.maxSqft.value = "";
      fire();
    });
  }

  function getFilters() {
    if (!els) return CompFilters.defaultFilters();
    const numOrNull = (el) => (el.value.trim() === "" ? null : parseFloat(el.value));
    return {
      months: parseFloat(els.months.value),
      minBeds: parseFloat(els.minBeds.value),
      minBaths: parseFloat(els.minBaths.value),
      maxDistance: parseFloat(els.maxDistance.value),
      minSqft: numOrNull(els.minSqft),
      maxSqft: numOrNull(els.maxSqft),
    };
  }

  return { render, getFilters };
})();
