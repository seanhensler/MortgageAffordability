// Sticky Bar — always-visible summary strip showing the four headline cash-flow numbers
// (net take-home, total housing PITI+HOA, net discretionary cash, DTI status) so the user
// doesn't have to scroll back up to the input column to see where they stand while reading
// results further down the page. No fetch, no calculation logic here — purely a rendering
// layer that mirrors whatever numbers app.js hands it. Global `StickyBar` object (IIFE),
// matches app.js / compmap.js code style.
//
// Layout contract (see stickybar.css):
//   - Desktop (>=768px): position: sticky; top: 0 — assumes containerEl is placed as a
//     direct child of <body>, at the very top (before .wrap), spanning full width.
//   - Mobile (<768px): position: fixed to the bottom of the viewport instead, so it doesn't
//     compete with the header for space. Same DOM position works either way since the CSS
//     switch is purely a @media (max-width: 767px) query on the container's own class.
//   - Hidden (display: none) until StickyBar.update() is called for the first time — the
//     app doesn't auto-calculate on load, so there's nothing to summarize yet.

const StickyBar = (() => {
  let root = null; // containerEl, owned entirely by this module once init() runs
  let els = null; // cached references to the four value spans + the dti dot
  let initialized = false;
  let everShown = false;

  const DTI_LABELS = {
    ok: "Within Guidelines",
    warn: "Approaching Limits",
    bad: "Exceeds Guidelines",
  };

  function warnNotReady(method) {
    console.warn(`StickyBar.${method}: called before StickyBar.init() succeeded — no-op.`);
  }

  function isReady() {
    return initialized && root !== null;
  }

  // "$" + rounded, comma-grouped magnitude, with toLocaleString supplying the sign for
  // negative values on its own (no manual "-" prefixing, which would double up).
  function fmtMoney(n) {
    const num = Number(n) || 0;
    return "$" + Math.round(num).toLocaleString("en-US");
  }

  function init(containerEl) {
    if (!containerEl) {
      console.warn("StickyBar.init: containerEl is required — no-op.");
      return;
    }
    root = containerEl;
    root.className = "stickybar";
    root.setAttribute("aria-live", "polite");
    root.innerHTML = `
      <div class="stickybar-inner">
        <div class="stickybar-stat" data-stat="net-monthly">
          <span class="stickybar-label">Net Take-Home</span>
          <span class="stickybar-value" data-field="netMonthly">$0</span>
        </div>
        <div class="stickybar-stat" data-stat="housing">
          <span class="stickybar-label">Housing PITI+HOA</span>
          <span class="stickybar-value" data-field="totalMonthlyHousing">$0</span>
        </div>
        <div class="stickybar-stat" data-stat="discretionary">
          <span class="stickybar-label">Net Discretionary</span>
          <span class="stickybar-value" data-field="netDiscretionary">$0</span>
        </div>
        <div class="stickybar-stat" data-stat="dti">
          <span class="stickybar-label">DTI Status</span>
          <span class="stickybar-value stickybar-dti" data-field="dtiStatus"><span class="stickybar-dot" data-field="dtiDot"></span><span data-field="dtiText">Within Guidelines</span></span>
        </div>
      </div>
    `;

    els = {
      netMonthly: root.querySelector('[data-field="netMonthly"]'),
      totalMonthlyHousing: root.querySelector('[data-field="totalMonthlyHousing"]'),
      netDiscretionary: root.querySelector('[data-field="netDiscretionary"]'),
      dtiStatus: root.querySelector('[data-field="dtiStatus"]'),
      dtiDot: root.querySelector('[data-field="dtiDot"]'),
      dtiText: root.querySelector('[data-field="dtiText"]'),
    };

    initialized = true;
    everShown = false;
  }

  function update(data) {
    if (!isReady()) {
      warnNotReady("update");
      return;
    }
    data = data || {};

    els.netMonthly.textContent = fmtMoney(data.netMonthly);

    els.totalMonthlyHousing.textContent = fmtMoney(data.totalMonthlyHousing);

    const disc = Number(data.netDiscretionary) || 0;
    els.netDiscretionary.textContent = fmtMoney(disc);
    els.netDiscretionary.classList.remove("is-ok", "is-bad");
    els.netDiscretionary.classList.add(disc < 0 ? "is-bad" : "is-ok");

    const tier = ["ok", "warn", "bad"].includes(data.dtiStatus) ? data.dtiStatus : "ok";
    const dtiStat = root.querySelector('[data-stat="dti"]');
    dtiStat.classList.remove("tier-ok", "tier-warn", "tier-bad");
    dtiStat.classList.add(`tier-${tier}`);
    els.dtiDot.className = "stickybar-dot";
    els.dtiDot.classList.add(`tier-${tier}`);
    els.dtiText.textContent = DTI_LABELS[tier];

    root.classList.add("stickybar-visible");
    if (!everShown) {
      everShown = true;
    }
  }

  function hide() {
    if (!isReady()) {
      warnNotReady("hide");
      return;
    }
    root.classList.remove("stickybar-visible");
  }

  return { init, update, hide };
})();
