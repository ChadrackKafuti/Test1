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
    day: null,               // "YYYY-MM-DD"
    who: load(LS_WHO, "all"),
    type: "all",
    q: "",
    plan: new Set(load(LS_PLAN, [])),
  };

  const participantsById = Object.fromEntries(D.participants.map((p) => [p.id, p]));
  const sessionsById = Object.fromEntries(D.sessions.map((s) => [s.id, s]));

  /* ---------------- helpers ---------------- */
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const mins = (hhmm) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };
  const sessionParticipants = (s) => (s.participants === "all" ? D.participants.map((p) => p.id) : s.participants);
  const hasParticipant = (s, id) => id === "all" || sessionParticipants(s).includes(id);

  function nyNow() {
    // Returns {date:"YYYY-MM-DD", minutes} in New York time.
    try {
      const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: D.event.timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
      const parts = Object.fromEntries(fmt.formatToParts(new Date()).map((p) => [p.type, p.value]));
      return { date: `${parts.year}-${parts.month}-${parts.day}`, minutes: Number(parts.hour) % 24 * 60 + Number(parts.minute) };
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
    const aS = mins(a.start), aE = a.end ? mins(a.end) : aS + 30;
    const bS = mins(b.start), bE = b.end ? mins(b.end) : bS + 30;
    return aS < bE && bS < aE;
  }

  function status(s) {
    const now = nyNow();
    if (s.date !== now.date) return "";
    const st = mins(s.start), en = s.end ? mins(s.end) : st + 30;
    if (now.minutes >= st && now.minutes < en) return "live";
    if (now.minutes < st && st - now.minutes <= 60) return "soon";
    if (now.minutes >= en) return "past";
    return "";
  }

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
    if (state.view === "agenda" && arg && D.days.some((d) => d.date === arg)) state.day = arg;
  }

  function navigate(view, day) {
    const target = view === "agenda" ? `#/agenda/${day || state.day}` : `#/${view}`;
    if (location.hash === target) render(); else location.hash = target;
  }

  function defaultDay() {
    const today = nyNow().date;
    const found = D.days.find((d) => d.date === today);
    if (found) return found.date;
    if (today > D.days[D.days.length - 1].date) return D.days[D.days.length - 1].date;
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
<article class="card ${starred ? "starred" : ""} ${st === "live" ? "live" : ""}" style="--c: var(--t-${esc(s.type)})" data-id="${esc(s.id)}">
  <div class="time">
    <span class="start">${esc(s.start)}</span>
    ${timeEnd}
    ${dur ? `<span class="dur">${esc(dur)}</span>` : ""}
  </div>
  <div class="body">
    <div class="meta-row">
      <span class="type-pill">${esc(type.label)}</span>
      ${s.tbc ? `<span class="pill-tbc">TBC</span>` : ""}
      ${st === "live" ? `<span class="pill-live">Now</span>` : st === "soon" ? `<span class="pill-tbc" style="color:var(--brand);background:var(--brand-soft)">Soon</span>` : ""}
      ${opts.showDate ? `<span class="muted">${esc(longDate(s.date))}</span>` : ""}
    </div>
    <h3>${esc(s.title)}</h3>
    ${s.subtitle ? `<p class="sub">${esc(s.subtitle)}</p>` : ""}
    <div class="${venueClass}">
      <svg class="ico"><use href="#i-pin"/></svg>
      <div>${esc(s.venue || "Venue to be confirmed")}${s.address ? `<div class="addr">${esc(s.address)}</div>` : ""}</div>
    </div>
    ${s.notes ? `<div class="notes">${esc(s.notes)}</div>` : ""}
    ${conflicts.length ? `<div class="conflict"><svg class="ico"><use href="#i-warn"/></svg>Overlaps with ${esc(conflicts.map((c) => c.title).join(", "))}</div>` : ""}
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

  /* ---------------- rendering: agenda ---------------- */
  function renderDayStrip() {
    const today = nyNow().date;
    $("#day-strip").innerHTML = D.days.map((d) => {
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
      .filter((s) => (q ? true : s.date === state.day))
      .filter((s) => hasParticipant(s, state.who))
      .filter((s) => state.type === "all" || s.type === state.type)
      .filter((s) => {
        if (!q) return true;
        const hay = [s.title, s.subtitle, s.venue, s.address, s.notes, s.contact, D.types[s.type]?.label,
          ...sessionParticipants(s).map((id) => participantsById[id]?.name)].join(" ").toLowerCase();
        return hay.includes(q);
      })
      .sort((a, b) => a.date.localeCompare(b.date) || mins(a.start) - mins(b.start));
  }

  function renderAgenda() {
    renderDayStrip();
    renderChips();
    const list = filteredSessions();
    const q = state.q.trim();
    $("#day-title").textContent = q ? `Results for “${q}”` : longDate(state.day);
    $("#result-count").textContent = `${list.length} event${list.length === 1 ? "" : "s"}`;
    $("#search-clear").hidden = !q;

    if (!list.length) {
      $("#agenda-list").innerHTML = emptyHTML("i-calendar", "Nothing here", q ? "Try a different search term." : "No events match these filters on this day.");
      return;
    }
    // conflict detection for the selected participant (or the viewer's plan)
    $("#agenda-list").innerHTML = list.map((s) => {
      let conflicts = [];
      if (state.who !== "all") {
        conflicts = D.sessions.filter((o) => o.id !== s.id && hasParticipant(o, state.who) && overlaps(s, o));
      }
      return cardHTML(s, { conflicts, showDate: !!q });
    }).join("");
  }

  /* ---------------- rendering: plan ---------------- */
  function renderPlan() {
    const items = D.sessions.filter((s) => state.plan.has(s.id)).sort((a, b) => a.date.localeCompare(b.date) || mins(a.start) - mins(b.start));
    const host = $("#plan-list");
    $("#btn-ics").disabled = !items.length;
    $("#btn-clear-plan").disabled = !items.length;
    if (!items.length) {
      host.innerHTML = emptyHTML("i-star", "Your plan is empty", "Star events in the agenda to build your personal schedule.");
      return;
    }
    host.innerHTML = D.days.map((d) => {
      const dayItems = items.filter((s) => s.date === d.date);
      if (!dayItems.length) return "";
      return `<section class="plan-day"><h3>${esc(longDate(d.date))} <span class="muted">· ${dayItems.length}</span></h3><div class="cards">${
        dayItems.map((s) => cardHTML(s, { conflicts: dayItems.filter((o) => o.id !== s.id && overlaps(s, o)) })).join("")
      }</div></section>`;
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
    document.title = state.view === "agenda" ? `${longDate(state.day)} · CAFI Climate Week Planner` : `${$(`#view-${state.view} h2`).textContent} · CAFI Climate Week Planner`;
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
      const endMin = s.end ? mins(s.end) : mins(s.start) + 60;
      const en = `${String(Math.floor(endMin / 60)).padStart(2, "0")}${String(endMin % 60).padStart(2, "0")}00`;
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
    const items = D.sessions.filter((s) => state.plan.has(s.id));
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
    const s = sessionsById[id];
    if (!s) return;
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
    if (go) { state.who = go.dataset.whoGo; save(LS_WHO, state.who); state.q = ""; $("#search").value = ""; navigate("agenda"); window.scrollTo({ top: 0 }); return; }
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
