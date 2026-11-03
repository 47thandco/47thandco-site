(() => {
  const SHAPES = ["Round","Oval","Cushion","Emerald","Princess","Radiant","Pear","Marquise","Asscher","Heart","Other"];
  const COLORS = ["D","E","F","G","H","I","J","K","L","M","Fancy"];
  const CLARITY = ["FL","IF","VVS1","VVS2","VS1","VS2","SI1","SI2","I1"];
  const CLARITY_RANK = Object.fromEntries(["FL","IF","VVS1","VVS2","VS1","VS2","SI1","SI2","SI3","I1","I2","I3"].map((c,i)=>[c,i]));
  const LABS = ["GIA","IGI","Other"];
  const GRADE = {EX:"Excellent",ID:"Ideal",VG:"Very Good",G:"Good",GD:"Good",F:"Fair",P:"Poor"};
  const FLUOR = {N:"None",NON:"None",F:"Faint",FNT:"Faint",M:"Medium",MED:"Medium",S:"Strong",STG:"Strong",VS:"Very Strong",VST:"Very Strong",SL:"Slight",VSL:"Very Slight"};
  const PAGE = 48;
  const DEFAULT_SORT = { N: "price-desc", L: "price-asc" };
  const $ = (id) => document.getElementById(id);
  const money = (n) => "$" + n.toLocaleString("en-US");
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

  let stones = [], byId = new Map(), store = {}, filtered = [], shown = 0;
  const state = { type: "N", shapes: new Set(), colors: new Set(), clarity: new Set(), labs: new Set(),
                  caratMin: null, caratMax: null, priceMin: null, priceMax: null, sort: "price-desc" };

  const shapeGroup = (s) => {
    const l = s.toLowerCase();
    for (const g of SHAPES) if (g !== "Other" && l.startsWith(g.toLowerCase())) return g;
    if (l.includes("round") && !l.includes("old")) return "Round";
    return "Other";
  };
  const labGroup = (l) => (l === "GIA" || l === "IGI") ? l : "Other";

  function chips(el, values, set) {
    el.innerHTML = values.map(v => `<button type="button" class="chip" aria-pressed="false" data-v="${esc(v)}">${esc(v)}</button>`).join("");
    el.addEventListener("click", e => {
      const b = e.target.closest(".chip"); if (!b) return;
      const v = b.dataset.v;
      set.has(v) ? set.delete(v) : set.add(v);
      b.setAttribute("aria-pressed", set.has(v));
      apply();
    });
  }

  function numInput(id, key) {
    $(id).addEventListener("input", e => { const v = parseFloat(e.target.value); state[key] = isNaN(v) ? null : v; apply(); });
  }

  function apply() {
    const s = state;
    filtered = stones.filter(d =>
      d.type === s.type &&
      (!s.shapes.size || s.shapes.has(d.shapeGroup)) &&
      (!s.colors.size || s.colors.has(d.fancy ? "Fancy" : d.color)) &&
      (!s.clarity.size || s.clarity.has(d.clarity)) &&
      (!s.labs.size || s.labs.has(labGroup(d.lab))) &&
      (s.caratMin == null || d.carat >= s.caratMin) && (s.caratMax == null || d.carat <= s.caratMax) &&
      (s.priceMin == null || d.price >= s.priceMin) && (s.priceMax == null || d.price <= s.priceMax));
    const [k, dir] = s.sort.split("-"); const m = dir === "asc" ? 1 : -1;
    filtered.sort((a, b) => (a[k] - b[k]) * m || a.price - b.price);
    shown = 0; $("grid").innerHTML = ""; renderMore();
    $("count").textContent = filtered.length.toLocaleString() + (filtered.length === 1 ? " diamond" : " diamonds");
  }

  const placeholder = `<svg class="ph" viewBox="0 0 64 64" fill="none" stroke="#1c1d22" stroke-width="2"><path d="M14 10h36l10 14-28 32L4 24z"/><path d="M4 24h56M22 10l-6 14 16 32 16-32-6-14"/></svg>`;

  function title(d) { return `${d.carat.toFixed(2)} ct ${d.shape}`; }
  function grades(d) { return [d.fancy ? d.color : d.color + " color", d.clarity, d.lab].filter(Boolean).join(" · "); }

  function renderMore() {
    const slice = filtered.slice(shown, shown + PAGE);
    if (!filtered.length) { $("grid").innerHTML = `<p class="empty">No diamonds match these filters. Try widening the carat or price range.</p>`; }
    $("grid").insertAdjacentHTML("beforeend", slice.map(d => `
      <button class="card" data-id="${esc(d.id)}">
        <div class="img">${d.image ? `<img loading="lazy" src="${esc(d.image)}" alt="${esc(title(d))}" onerror="this.replaceWith(document.createRange().createContextualFragment('${placeholder.replace(/"/g,"&quot;")}'))">` : placeholder}</div>
        <div class="meta"><p class="t">${esc(title(d))}</p><p class="g">${esc(grades(d))}</p><p class="p">${money(d.price)}</p></div>
      </button>`).join(""));
    shown += slice.length;
    $("moreBtn").hidden = shown >= filtered.length;
  }

  function openDetail(id, push = true) {
    const d = byId.get(id); if (!d) return;
    $("dType").textContent = d.type === "L" ? "Lab-grown diamond" : "Natural diamond";
    $("dTitle").textContent = title(d);
    $("dPrice").textContent = money(d.price);
    const media = d.video && /\.html?$/i.test(d.video)
      ? `<iframe src="${esc(d.video)}" title="360° video" loading="lazy" allowfullscreen></iframe><a class="vlink" href="${esc(d.video)}" target="_blank" rel="noopener">Open 360° video in a new tab</a>`
      : d.video ? `<video src="${esc(d.video)}" controls autoplay muted loop playsinline style="width:100%;flex:1"></video>`
      : d.image ? `<img src="${esc(d.image)}" alt="${esc(title(d))}">` : `<div style="flex:1;display:flex;align-items:center;justify-content:center">${placeholder}</div>`;
    $("dMedia").innerHTML = media;
    const subject = encodeURIComponent(`Inquiry: ${title(d)} (#${d.id})`);
    const body = encodeURIComponent(`Hi, I'm interested in this diamond:\n\n${title(d)}, ${grades(d)}\nPrice: ${money(d.price)}\nReference: #${d.id}\n\nIs it available?`);
    $("dActions").innerHTML =
      (store.contact_email ? `<a class="btn primary" href="mailto:${esc(store.contact_email)}?subject=${subject}&body=${body}">Inquire about this diamond</a>` : "") +
      (store.contact_phone ? `<a class="btn ghost" href="tel:${esc(store.contact_phone.replace(/[^\d+]/g,""))}">Call ${esc(store.contact_phone)}</a>` : "") +
      (d.cert ? `<a class="btn ghost" href="${esc(d.cert)}" target="_blank" rel="noopener">View ${esc(d.lab || "grading")} report</a>` : "");
    const g = (v) => GRADE[v] || v;
    const rows = [
      ["Shape", d.shape], ["Carat", d.carat.toFixed(2)], ["Color", d.color], ["Clarity", d.clarity],
      ["Cut", g(d.cut)], ["Polish", g(d.polish)], ["Symmetry", g(d.symmetry)], ["Fluorescence", FLUOR[d.fluor] || d.fluor],
      ["Measurements", d.measurements ? d.measurements.toLowerCase().replace(/ x /g, " × ") + " mm" : ""],
      ["L/W ratio", d.ratio ? d.ratio.toFixed(2) : ""], ["Depth", d.depth ? d.depth + "%" : ""], ["Table", d.table ? d.table + "%" : ""],
      ["Grading lab", d.lab], ["Growth method", d.type === "L" ? d.treatment : ""],
    ].filter(r => r[1]);
    $("dSpecs").innerHTML = rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("");
    $("dRef").textContent = `Reference #${d.id}`;
    if (!$("detail").open) $("detail").showModal();
    if (push) history.replaceState(null, "", "#stone=" + encodeURIComponent(d.id));
  }

  function closeDetail() { $("detail").close(); }
  $("detail").addEventListener("close", () => { $("dMedia").innerHTML = ""; history.replaceState(null, "", location.pathname + location.search); });
  $("dClose").addEventListener("click", closeDetail);
  $("detail").addEventListener("click", e => { if (e.target === $("detail")) closeDetail(); });

  $("grid").addEventListener("click", e => { const c = e.target.closest(".card"); if (c) openDetail(c.dataset.id); });
  $("moreBtn").addEventListener("click", renderMore);
  $("sort").addEventListener("change", e => { state.sort = e.target.value; apply(); });
  $("typeSeg").addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    state.type = b.dataset.type;
    // Natural opens high to low, lab-grown low to high.
    state.sort = DEFAULT_SORT[state.type]; $("sort").value = state.sort;
    $("typeSeg").querySelectorAll("button").forEach(x => x.setAttribute("aria-selected", x === b));
    apply();
  });
  $("openFilters").addEventListener("click", () => $("filters").classList.add("open"));
  $("closeFilters").addEventListener("click", () => $("filters").classList.remove("open"));
  $("resetBtn").addEventListener("click", () => {
    ["shapes","colors","clarity","labs"].forEach(k => state[k].clear());
    ["caratMin","caratMax","priceMin","priceMax"].forEach(k => { state[k] = null; $(k).value = ""; });
    document.querySelectorAll(".chip").forEach(c => c.setAttribute("aria-pressed", "false"));
    apply();
  });

  chips($("shapeChips"), SHAPES, state.shapes);
  chips($("colorChips"), COLORS, state.colors);
  chips($("clarityChips"), CLARITY, state.clarity);
  chips($("labChips"), LABS, state.labs);
  numInput("caratMin", "caratMin"); numInput("caratMax", "caratMax");
  numInput("priceMin", "priceMin"); numInput("priceMax", "priceMax");

  fetch("inventory.json", { cache: "no-cache" }).then(r => r.json()).then(data => {
    store = data.store || {};
    const F = data.fields;
    stones = data.rows.map(r => { const o = {}; F.forEach((f, i) => o[f] = r[i]); o.shapeGroup = shapeGroup(o.shape); o.fancy = !!o.fancy; return o; });
    stones.forEach(s => byId.set(s.id, s));
    const name = store.store_name || "Loose Diamonds";
    $("brand").textContent = name; document.title = name + " | Loose Diamonds";
    $("footStore").textContent = "© " + new Date().getFullYear() + " " + name;
    $("contact").innerHTML = [store.contact_phone && `<a href="tel:${esc(store.contact_phone.replace(/[^\d+]/g,""))}">${esc(store.contact_phone)}</a>`,
                              store.contact_email && `<a href="mailto:${esc(store.contact_email)}">${esc(store.contact_email)}</a>`].filter(Boolean).join("");
    if (data.updated) $("updated").textContent = "Inventory updated " + new Date(data.updated).toLocaleDateString("en-US", {month:"short",day:"numeric",year:"numeric"}) + ".";
    apply();
    const m = location.hash.match(/stone=([^&]+)/); if (m) openDetail(decodeURIComponent(m[1]), false);
  }).catch(() => { $("count").textContent = "Couldn't load inventory. Run sync.py, then refresh."; });
})();
