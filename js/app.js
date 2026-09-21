/* CAFI Climate Week Planner – application logic (vanilla JS, no build step). */
(function () {
  "use strict";

  const D = window.PLANNER_DATA;
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  /* ---------------- persistence ---------------- */
  const LS_PLAN = "cafi-cw26-plan";
  const LS_WHO = "cafi-cw26-who";
  const load = (k, fallback) => {
    try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
  };
  const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } };

  const state = {
    view: "agenda",
    day: null,               // "YYYY-MM-DD" or "all"
    who: load(LS_WHO, "all"),
    type: "all",
    q: "",
    plan: new Set(load(LS_PLAN, [])),
  };

  const participantsById = Object.fromEntries(D.participants.map((p) => [p.id, p]));
  const sessionsById = Object.fromEntries(D.sessions.map((s) => [s.id, s]));
  const TT = {};
  for (const [a, b, mins, mode] of D.travel) { TT[a + "|" + b] = { mins, mode }; TT[b + "|" + a] = { mins, mode }; }

  /* ---------------- helpers ---------------- */
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const mins = (hhmm) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };
  const hhmm = (total) => { const t = ((total % 1440) + 1440) % 1440; return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`; };
  const DEFAULT_DURATION = 60; // assumed length for events that list only a start time
  const endMins = (s) => (s.end ? mins(s.end) : mins(s.start) + DEFAULT_DURATION);
  const sessionParticipants = (s) => (s.participants === "all" ? D.participants.map((p) => p.id) : s.participants);
  const hasParticipant = (s, id) => id === "all" || sessionParticipants(s).includes(id);
  const areaLabel = (id) => D.areas[id]?.label || id;
  const byTime = (a, b) => a.date.localeCompare(b.date) || mins(a.start) - mins(b.start);

  function nyNow() {
    try {
      const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: D.event.timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
      const parts = Object.fromEntries(fmt.formatToParts(new Date()).map((p) => [p.type, p.value]));
      return { date: `${parts.year}-${parts.month}-${parts.day}`, minutes: (Number(parts.hour) % 24) * 60 + Number(parts.minute) };
    } catch {
      const d = new Date();
      return { date: d.toISOString().slice(0, 10), minutes: d.getHours() * 60 + d.getMinutes() };
    }
  }

  function durationLabel(s) {
    if (!s.end) return "";
    const d = mins(s.end) - mins(s.start);
    if (d <= 0) return "";
    const h = Math.floor(d / 60), m = d % 60;
    return h ? (m ? `${h}h${String(m).padStart(2, "0")}` : `${h}h`) : `${m} min`;
  }

  function longDate(iso) {
    const d = new Date(iso + "T12:00:00");
    return d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
  }

  function overlaps(a, b) {
    if (a.date !== b.date) return false;
    return mins(a.start) < endMins(b) && mins(b.start) < endMins(a);
  }

  function status(s) {
    const now = nyNow();
    if (s.date !== now.date) return "";
    const st = mins(s.start), en = endMins(s);
    if (now.minutes >= st && now.minutes < en) return "live";
    if (now.minutes < st && st - now.minutes <= 60) return "soon";
    return "";
  }

  /* ---------------- travel ---------------- */
  function getTravel(a, b) {
    if (D.areas[a]?.unknown || D.areas[b]?.unknown) return null;
    return TT[a + "|" + b] || { mins: 30, mode: "Estimate – verify on Google Maps" };
  }

  // Describes the transition from event `from` to event `to` on the same day.
  function sameVenue(a, b) {
    if (a.tbc || b.tbc) return false;
    const key = (s) => (s.address || s.venue || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    return key(a) && key(a) === key(b);
  }

  function transition(from, to) {
    const gap = mins(to.start) - endMins(from);
    const venue = sameVenue(from, to);
    const t = venue ? { mins: 0, mode: "Same venue – no travel" } : getTravel(from.area, to.area);
    if (!t) return { kind: "unknown", gap, label: "Venue to be confirmed", route: `${areaLabel(from.area)} → ${areaLabel(to.area)}` };
    const buffer = gap - t.mins;
    const leaveBy = hhmm(mins(to.start) - t.mins - 5);
    const same = venue || from.area === to.area;
    let kind;
    if (gap < 0 || overlaps(from, to)) kind = "conflict";
    else if (venue) kind = "ok";
    else if (buffer < 0) kind = "early";
    else if (buffer < 15) kind = "tight";
    else kind = "ok";
    return { kind, gap, buffer, leaveBy, same, mins: t.mins, mode: t.mode,
      route: venue ? `${from.venue} · same venue` : same ? `${areaLabel(from.area)} · same area` : `${areaLabel(from.area)} → ${areaLabel(to.area)}` };
  }

  const KIND_LABEL = { ok: "Comfortable", tight: "Tight", early: "Leave early", conflict: "Overlap", unknown: "Check travel" };

  function connectorHTML(from, to) {
    const tr = transition(from, to);
    const detail = tr.kind === "unknown"
      ? `<span>Travel time unknown until the venue is confirmed</span>`
      : tr.same
        ? `<span>${esc(tr.mode)}</span><span>~${tr.mins} min</span><span>Gap: ${tr.gap} min</span>`
        : `<span>${esc(tr.mode)}</span><span>~${tr.mins} min</span><span class="leave">Leave by <strong>${tr.leaveBy}</strong></span><span>Buffer: ${tr.buffer} min</span>`;
    return `
<div class="connector k-${tr.kind}" role="note">
  <span class="k-dot" aria-hidden="true"></span>
  <div class="c-body">
    <div class="c-row1"><strong>${KIND_LABEL[tr.kind]}</strong><span class="route">${esc(tr.route)}</span></div>
    <div class="c-row2">${detail}</div>
  </div>
</div>`;
  }

  function fromEarlierHTML(s, earlier) {
    if (!earlier.length) return "";
    const rows = earlier.map((prev) => {
      const tr = transition(prev, s);
      const leave = tr.kind === "unknown" ? "—" : tr.mins === 0 ? "Same venue" : tr.same ? "Walk within area" : `Leave by <strong>${tr.leaveBy}</strong>`;
      const buf = tr.kind === "unknown" ? "Venue TBC" : tr.kind === "conflict" ? "Overlaps" : tr.buffer < 0 ? `${Math.abs(tr.buffer)} min short` : `${tr.buffer} min buffer`;
      return `<tr class="k-${tr.kind}"><td>${esc(prev.title)}<div class="muted">${esc(prev.start)}–${esc(prev.end || "?")}</div></td><td>${tr.kind === "unknown" ? "—" : `~${tr.mins} min`}<div class="muted">${esc(tr.mode || "")}</div></td><td>${leave}<div class="muted">${buf}</div></td><td><span class="k-dot" aria-hidden="true"></span></td></tr>`;
    }).join("");
    return `<details class="from-earlier"><summary>Travel from earlier events today</summary><table><thead><tr><th>From</th><th>Travel</th><th>Leave by</th><th></th></tr></thead><tbody>${rows}</tbody></table></details>`;
  }

  /* ---------------- toast ---------------- */
  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => (t.hidden = true), 2200);
  }

  /* ---------------- routing ---------------- */
  function parseHash() {
    const h = location.hash.replace(/^#\/?/, "");
    const [view, arg] = h.split("/");
    const views = ["agenda", "plan", "info", "contacts"];
    state.view = views.includes(view) ? view : "agenda";
    if (state.view === "agenda" && arg && (arg === "all" || D.days.some((d) => d.date === arg))) state.day = arg;
  }

  function navigate(view, day) {
    const target = view === "agenda" ? `#/agenda/${day || state.day}` : `#/${view}`;
    if (location.hash === target) render(); else location.hash = target;
  }

  function defaultDay() {
    const today = nyNow().date;
    const found = D.days.find((d) => d.date === today);
    if (found) return found.date;
    if (today > D.days[D.days.length - 1].date) return "all";
    return D.days[0].date;
  }

  /* ---------------- rendering: shared pieces ---------------- */
  function avatar(pid, extraClass = "") {
    const p = participantsById[pid];
    if (!p) return "";
    return `<span class="avatar p-${p.id} ${extraClass}" title="${esc(p.name)}" aria-label="${esc(p.name)}">${esc(p.initials)}</span>`;
  }

  function whoBlock(s) {
    if (s.participants === "all") {
      return `<div class="who"><span class="all"><svg class="ico" style="width:13px;height:13px"><use href="#i-people"/></svg>All CAFI staff</span></div>`;
    }
    if (!s.participants.length) {
      return `<div class="who"><span class="none">${esc(s.participantsNote || "Participants to be confirmed")}</span></div>`;
    }
    const names = s.participants.map((id) => participantsById[id]?.name).filter(Boolean);
    const label = names.length <= 2 ? names.join(" · ") : `${names.length} participants`;
    return `<div class="who"><span class="avatar-stack">${s.participants.map((id) => avatar(id)).join("")}</span><span class="lbl">${esc(label)}</span></div>`;
  }

  function cardHTML(s, opts = {}) {
    const type = D.types[s.type] || { label: s.type };
    const starred = state.plan.has(s.id);
    const st = status(s);
    const conflicts = opts.conflicts || [];
    const venueClass = s.tbc ? "venue tbc" : "venue";
    const timeEnd = s.end ? `<span class="end">– ${esc(s.end)}</span>` : `<span class="end">start</span>`;
    const dur = durationLabel(s);

    return `
<article class="card ${starred ? "starred" : ""} ${st === "live" ? "live" : ""} ${conflicts.length ? "has-conflict" : ""}" style="--c: var(--t-${esc(s.type)})" data-id="${esc(s.id)}">
  <div class="time">
    <span class="start">${esc(s.start)}</span>
    ${timeEnd}
    ${dur ? `<span class="dur">${esc(dur)}</span>` : ""}
  </div>
  <div class="body">
    <div class="meta-row">
      <span class="type-pill">${esc(type.label)}</span>
      ${s.tbc ? `<span class="pill-tbc">TBC</span>` : ""}
      ${conflicts.length ? `<span class="pill-tbc">Overlap</span>` : ""}
      ${st === "live" ? `<span class="pill-live">Now</span>` : st === "soon" ? `<span class="pill-tbc" style="color:var(--brand);background:var(--brand-soft)">Soon</span>` : ""}
      ${opts.showDate ? `<span class="muted">${esc(longDate(s.date))}</span>` : ""}
    </div>
    <h3>${esc(s.title)}</h3>
    ${s.subtitle ? `<p class="sub">${esc(s.subtitle)}</p>` : ""}
    <div class="${venueClass}">
      <svg class="ico"><use href="#i-pin"/></svg>
      <div>${esc(s.venue || "Venue to be confirmed")}${s.address ? `<div class="addr">${esc(s.address)}</div>` : ""}
        ${!D.areas[s.area]?.unknown ? `<span class="area-pill">${esc(areaLabel(s.area))}</span>` : ""}</div>
    </div>
    ${s.notes ? `<div class="notes">${esc(s.notes)}</div>` : ""}
    ${conflicts.length ? `<div class="conflict"><svg class="ico"><use href="#i-warn"/></svg>Overlaps with ${esc(conflicts.map((c) => c.title).join(" · "))}</div>` : ""}
    ${opts.earlier ? fromEarlierHTML(s, opts.earlier) : ""}
    <div class="foot">
      ${whoBlock(s)}
      <div class="actions">
        ${s.map ? `<a class="link-btn" href="${esc(s.map)}" target="_blank" rel="noopener"><svg class="ico"><use href="#i-pin"/></svg>Map</a>` : ""}
        ${s.contact ? `<a class="link-btn" href="mailto:${esc(s.contact)}"><svg class="ico"><use href="#i-mail"/></svg>Contact</a>` : ""}
      </div>
    </div>
  </div>
  <button class="star-btn ${starred ? "on" : ""}" type="button" data-star="${esc(s.id)}" aria-pressed="${starred}" aria-label="${starred ? "Remove from my plan" : "Add to my plan"}" title="${starred ? "Remove from my plan" : "Add to my plan"}">
    <svg class="ico"><use href="#i-star"/></svg>
  </button>
</article>`;
  }

  function emptyHTML(icon, title, text) {
    return `<div class="empty"><svg class="ico"><use href="#${icon}"/></svg><strong>${esc(title)}</strong><span>${esc(text)}</span></div>`;
  }

  // Renders a day's events as a timeline: cards joined by travel connectors when `travel` is on.
  function timelineHTML(dayItems, opts) {
    const out = [];
    dayItems.forEach((s, i) => {
      if (opts.travel && i > 0) out.push(connectorHTML(dayItems[i - 1], s));
      const conflicts = opts.pool.filter((o) => o.id !== s.id && overlaps(s, o));
      out.push(cardHTML(s, { conflicts, showDate: opts.showDate, earlier: opts.travel && i > 0 ? dayItems.slice(0, i) : null }));
    });
    return `<div class="cards ${opts.travel ? "timeline" : ""}">${out.join("")}</div>`;
  }

  function statsHTML(items, travel) {
    let ok = 0, tight = 0, bad = 0, transitions = 0;
    if (travel) {
      for (const d of D.days) {
        const day = items.filter((s) => s.date === d.date);
        for (let i = 1; i < day.length; i++) {
          const tr = transition(day[i - 1], day[i]);
          transitions++;
          if (tr.kind === "ok" || tr.kind === "unknown") ok++;
          else if (tr.kind === "tight") tight++;
          else bad++;
        }
      }
    }
    const tile = (n, label, cls = "") => `<div class="stat ${cls}"><b>${n}</b><span>${label}</span></div>`;
    return `<div class="stats">
      ${tile(items.length, "events")}
      ${travel ? tile(transitions, "transitions") : ""}
      ${travel ? tile(bad, "conflicts / leave early", "s-bad") : ""}
      ${travel ? tile(tight, "tight transitions", "s-tight") : ""}
      ${travel ? tile(ok, "comfortable", "s-ok") : ""}
    </div>`;
  }

  const LEGEND = `<div class="legend"><strong>Legend</strong>
    <span><i class="k-dot k-ok"></i>Comfortable</span>
    <span><i class="k-dot k-tight"></i>Tight (&lt;15 min buffer)</span>
    <span><i class="k-dot k-early"></i>Leave early</span>
    <span><i class="k-dot k-conflict"></i>Time overlap</span>
    <span><i class="k-dot k-unknown"></i>Venue TBC</span>
    <em>Travel times are estimates – verify on Google Maps.</em></div>`;

  /* ---------------- rendering: agenda ---------------- */
  function renderDayStrip() {
    const today = nyNow().date;
    const total = D.sessions.filter((s) => hasParticipant(s, state.who)).length;
    const week = `<button type="button" role="tab" class="day-btn week ${state.day === "all" ? "active" : ""}" data-day="all" aria-selected="${state.day === "all"}">
        <span class="dow">Week</span><span class="num">21–25</span><span class="n">${total} events</span></button>`;
    $("#day-strip").innerHTML = week + D.days.map((d) => {
      const n = D.sessions.filter((s) => s.date === d.date && hasParticipant(s, state.who)).length;
      return `<button type="button" role="tab" class="day-btn ${d.date === state.day ? "active" : ""} ${d.date === today ? "today" : ""}" data-day="${d.date}" aria-selected="${d.date === state.day}">
        <span class="dow">${d.label}</span><span class="num">${d.num}</span><span class="n">${n} event${n === 1 ? "" : "s"}</span>
      </button>`;
    }).join("");
  }

  function renderChips() {
    const who = [{ id: "all", name: "Everyone" }, ...D.participants];
    $("#who-chips").innerHTML = who.map((p) => `
      <button type="button" class="chip ${state.who === p.id ? "active" : ""}" data-who="${p.id}" aria-pressed="${state.who === p.id}">
        ${p.id === "all" ? `<svg class="ico" style="width:14px;height:14px"><use href="#i-people"/></svg>` : avatar(p.id)}${esc(p.name)}
      </button>`).join("");

    const types = [["all", "All types"], ...Object.entries(D.types).map(([k, v]) => [k, v.label])];
    $("#type-chips").innerHTML = types.map(([k, label]) => `
      <button type="button" class="chip ${state.type === k ? "active" : ""}" data-type="${k}" aria-pressed="${state.type === k}" ${k !== "all" ? `style="--c: var(--t-${k})"` : ""}>
        ${k !== "all" ? `<span class="dot"></span>` : `<svg class="ico" style="width:14px;height:14px"><use href="#i-filter"/></svg>`}${esc(label)}
      </button>`).join("");
  }

  function filteredSessions() {
    const q = state.q.trim().toLowerCase();
    return D.sessions
      .filter((s) => (q || state.day === "all" ? true : s.date === state.day))
      .filter((s) => hasParticipant(s, state.who))
      .filter((s) => state.type === "all" || s.type === state.type)
      .filter((s) => {
        if (!q) return true;
        const hay = [s.title, s.subtitle, s.venue, s.address, s.notes, s.contact, D.types[s.type]?.label, areaLabel(s.area),
          ...sessionParticipants(s).map((id) => participantsById[id]?.name)].join(" ").toLowerCase();
        return hay.includes(q);
      })
      .sort(byTime);
  }

  function renderAgenda() {
    renderDayStrip();
    renderChips();
    const list = filteredSessions();
    const q = state.q.trim();
    const travel = state.who !== "all" && !q && state.type === "all";
    const multiDay = q || state.day === "all";
    $("#day-title").textContent = q ? `Results for “${q}”` : state.day === "all" ? "Whole week" : longDate(state.day);
    $("#result-count").textContent = `${list.length} event${list.length === 1 ? "" : "s"}`;
    $("#search-clear").hidden = !q;

    const host = $("#agenda-list");
    if (!list.length) {
      host.innerHTML = emptyHTML("i-calendar", "Nothing here", q ? "Try a different search term." : "No events match these filters on this day.");
      return;
    }
    // Overlap pool: everything this participant attends (or everything, for "Everyone").
    const pool = D.sessions.filter((s) => hasParticipant(s, state.who));
    const hint = state.who === "all" && !q
      ? `<div class="hint"><svg class="ico"><use href="#i-info"/></svg>Select a participant above to see their personal timeline with travel times, transport suggestions and departure alerts between events.</div>`
      : "";
    const head = travel ? statsHTML(list, true) + LEGEND : "";
    const days = D.days.filter((d) => list.some((s) => s.date === d.date));
    const body = days.map((d) => {
      const dayItems = list.filter((s) => s.date === d.date);
      const heading = multiDay ? `<h3 class="day-heading">${esc(longDate(d.date))} <span class="badge">${dayItems.length}</span></h3>` : "";
      return `<section class="day-block">${heading}${timelineHTML(dayItems, { travel, pool, showDate: false })}</section>`;
    }).join("");
    host.innerHTML = hint + head + body;
  }

  /* ---------------- rendering: plan ---------------- */
  function renderPlan() {
    const items = D.sessions.filter((s) => state.plan.has(s.id)).sort(byTime);
    const host = $("#plan-list");
    $("#btn-ics").disabled = !items.length;
    $("#btn-clear-plan").disabled = !items.length;
    if (!items.length) {
      host.innerHTML = emptyHTML("i-star", "Your plan is empty", "Star events in the agenda to build your personal schedule.");
      return;
    }
    host.innerHTML = statsHTML(items, true) + LEGEND + D.days.map((d) => {
      const dayItems = items.filter((s) => s.date === d.date);
      if (!dayItems.length) return "";
      return `<section class="day-block"><h3 class="day-heading">${esc(longDate(d.date))} <span class="badge">${dayItems.length}</span></h3>${
        timelineHTML(dayItems, { travel: true, pool: items, showDate: false })}</section>`;
    }).join("");
  }

  /* ---------------- rendering: info ---------------- */
  function renderInfo() {
    $("#info-grid").innerHTML = D.info.map((c) => `
      <article class="info-card" id="info-${esc(c.id)}">
        <div class="head"><span class="ico-wrap"><svg class="ico"><use href="#i-${esc(c.icon)}"/></svg></span><h3>${esc(c.title)}</h3></div>
        <ul>${c.lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>
        ${c.address ? `<div class="addr"><svg class="ico"><use href="#i-pin"/></svg><span>${esc(c.address)}</span></div>` : ""}
        <div class="actions">
          ${c.map ? `<a class="link-btn" href="${esc(c.map)}" target="_blank" rel="noopener"><svg class="ico"><use href="#i-pin"/></svg>Open in Maps</a>` : ""}
          ${(c.phones || []).map((p) => `<a class="link-btn" href="tel:${esc(p.replace(/[^\d+]/g, ""))}"><svg class="ico"><use href="#i-phone"/></svg>${esc(p)}</a>`).join("")}
          ${(c.links || []).map((l) => `<a class="link-btn" href="${esc(l.href)}" target="_blank" rel="noopener"><svg class="ico"><use href="#i-link"/></svg>${esc(l.label)}</a>`).join("")}
        </div>
      </article>`).join("");
  }

  /* ---------------- rendering: contacts ---------------- */
  function renderContacts() {
    $("#contact-list").innerHTML = D.contacts.map((c) => {
      const digits = c.phone.replace(/[^\d+]/g, "");
      const initials = c.name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
      const wa = c.whatsapp && digits.startsWith("+") ? `https://wa.me/${digits.slice(1)}` : "";
      return `<div class="contact">
        <span class="avatar" style="--pc: var(--brand)">${esc(initials)}</span>
        <div class="cbody"><div class="cname">${esc(c.name)}</div><div class="crole">${esc(c.role)}</div><div class="cphone">${esc(c.phone)}</div></div>
        <div class="cactions">
          <a class="round-btn" href="tel:${esc(digits)}" title="Call" aria-label="Call ${esc(c.name)}"><svg class="ico"><use href="#i-phone"/></svg></a>
          ${wa ? `<a class="round-btn" href="${wa}" target="_blank" rel="noopener" title="WhatsApp" aria-label="WhatsApp ${esc(c.name)}"><svg class="ico"><use href="#i-chat"/></svg></a>` : ""}
        </div>
      </div>`;
    }).join("");

    $("#delegation").innerHTML = D.participants.map((p) => {
      const n = D.sessions.filter((s) => hasParticipant(s, p.id)).length;
      return `<button type="button" class="delegate" data-who-go="${p.id}">${avatar(p.id)}<span><span class="dname">${esc(p.name)}</span><br><span class="dcount">${n} event${n === 1 ? "" : "s"} this week</span></span></button>`;
    }).join("");
  }

  /* ---------------- render root ---------------- */
  function render() {
    $$(".view").forEach((v) => (v.hidden = v.dataset.view !== state.view));
    $$(".tab").forEach((t) => t.classList.toggle("active", t.dataset.view === state.view));
    const n = state.plan.size;
    const badge = $("#plan-count");
    badge.textContent = n;
    badge.hidden = n === 0;

    if (state.view === "agenda") renderAgenda();
    else if (state.view === "plan") renderPlan();
    else if (state.view === "info") renderInfo();
    else if (state.view === "contacts") renderContacts();
    const label = state.view === "agenda" ? (state.day === "all" ? "Whole week" : longDate(state.day)) : $(`#view-${state.view} h2`).textContent;
    document.title = `${label} · CAFI Climate Week Planner`;
  }

  /* ---------------- .ics export ---------------- */
  function icsEscape(s) { return String(s ?? "").replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n"); }
  function fold(line) {
    const out = []; let s = line;
    while (s.length > 73) { out.push(s.slice(0, 73)); s = " " + s.slice(73); }
    out.push(s); return out.join("\r\n");
  }
  function buildICS(items) {
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
    const tz = D.event.timezone;
    const lines = [
      "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//CAFI//Climate Week Planner//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
      "X-WR-CALNAME:CAFI Climate Week 2026", `X-WR-TIMEZONE:${tz}`,
      "BEGIN:VTIMEZONE", `TZID:${tz}`,
      "BEGIN:DAYLIGHT", "TZOFFSETFROM:-0500", "TZOFFSETTO:-0400", "TZNAME:EDT", "DTSTART:19700308T020000", "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU", "END:DAYLIGHT",
      "BEGIN:STANDARD", "TZOFFSETFROM:-0400", "TZOFFSETTO:-0500", "TZNAME:EST", "DTSTART:19701101T020000", "RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU", "END:STANDARD",
      "END:VTIMEZONE",
    ];
    for (const s of items) {
      const d = s.date.replace(/-/g, "");
      const st = s.start.replace(":", "") + "00";
      const en = hhmm(endMins(s)).replace(":", "") + "00";
      const loc = [s.venue, s.address].filter(Boolean).join(", ");
      const desc = [s.subtitle, s.notes, s.contact ? `Contact: ${s.contact}` : "", s.map ? `Map: ${s.map}` : "",
        `CAFI participants: ${s.participants === "all" ? "All staff" : sessionParticipants(s).map((id) => participantsById[id]?.name).join(", ") || (s.participantsNote || "TBC")}`].filter(Boolean).join("\n");
      lines.push("BEGIN:VEVENT", `UID:${s.id}@cafi-climate-week-2026`, `DTSTAMP:${stamp}`,
        `DTSTART;TZID=${tz}:${d}T${st}`, `DTEND;TZID=${tz}:${d}T${en}`,
        fold(`SUMMARY:${icsEscape(s.title)}${s.tbc ? " (TBC)" : ""}`),
        fold(`LOCATION:${icsEscape(loc || "To be confirmed")}`),
        fold(`DESCRIPTION:${icsEscape(desc)}`));
      if (s.map) lines.push(fold(`URL:${s.map}`));
      lines.push("END:VEVENT");
    }
    lines.push("END:VCALENDAR");
    return lines.join("\r\n") + "\r\n";
  }
  function downloadICS() {
    const items = D.sessions.filter((s) => state.plan.has(s.id)).sort(byTime);
    if (!items.length) return;
    const blob = new Blob([buildICS(items)], { type: "text/calendar;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "cafi-climate-week-2026.ics";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast(`Exported ${items.length} event${items.length === 1 ? "" : "s"} to calendar`);
  }

  /* ---------------- events ---------------- */
  function toggleStar(id) {
    if (!sessionsById[id]) return;
    if (state.plan.has(id)) { state.plan.delete(id); toast("Removed from my plan"); }
    else { state.plan.add(id); toast("Added to my plan"); }
    save(LS_PLAN, [...state.plan]);
    render();
  }

  document.addEventListener("click", (e) => {
    const star = e.target.closest("[data-star]");
    if (star) { toggleStar(star.dataset.star); return; }

    const day = e.target.closest("[data-day]");
    if (day) { state.day = day.dataset.day; navigate("agenda", state.day); return; }

    const who = e.target.closest("[data-who]");
    if (who) { state.who = who.dataset.who; save(LS_WHO, state.who); render(); return; }

    const type = e.target.closest("[data-type]");
    if (type) { state.type = type.dataset.type; render(); return; }

    const go = e.target.closest("[data-who-go]");
    if (go) { state.who = go.dataset.whoGo; save(LS_WHO, state.who); state.q = ""; $("#search").value = ""; state.day = "all"; navigate("agenda", "all"); window.scrollTo({ top: 0 }); return; }
  });

  $("#search").addEventListener("input", (e) => { state.q = e.target.value; renderAgenda(); });
  $("#search-clear").addEventListener("click", () => { state.q = ""; $("#search").value = ""; renderAgenda(); $("#search").focus(); });
  $("#btn-ics").addEventListener("click", downloadICS);
  $("#btn-clear-plan").addEventListener("click", () => {
    if (!state.plan.size) return;
    if (confirm("Remove all events from your plan?")) { state.plan.clear(); save(LS_PLAN, []); render(); toast("Plan cleared"); }
  });
  $("#btn-print").addEventListener("click", () => window.print());
  window.addEventListener("hashchange", () => { parseHash(); render(); });

  // Refresh "Now / Soon" badges every minute while the agenda is visible.
  setInterval(() => { if (state.view === "agenda" && !document.hidden) renderAgenda(); }, 60_000);

  /* ---------------- init ---------------- */
  state.day = defaultDay();
  parseHash();
  if (!location.hash) history.replaceState(null, "", `#/agenda/${state.day}`);
  render();
})();
