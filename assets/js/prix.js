// Surveillance des prix (Envies, Vins passés, Compte, Cave).
// Un vin surveillé : l'IA cherche une fois sa page chez les sites choisis, puis les prix sont relus chaque nuit
// sans IA (fonction « watch »). Alertes : prix cible atteint, baisse, prix barré, retour en stock.
(function () {
  const VC = window.VC;
  const { sb, esc, I, toast, fail, money } = VC;

  // Liste proposée : cavistes suisses actifs d'emblée, quelques marchands européens à activer au besoin.
  // Le site du producteur (fiche du vin) est toujours consulté en plus.
  const SITES = [
    ["Mövenpick Wein", "moevenpick-wein.com", "CH", true], ["Gerstl", "gerstl.ch", "CH", true], ["Martel", "martel.ch", "CH", true],
    ["Flaschenpost", "flaschenpost.ch", "CH", true], ["Coop (Mondovino)", "coop.ch", "CH", true], ["Denner", "denner.ch", "CH", true],
    ["Globus", "globus.ch", "CH", true], ["Manor", "manor.ch", "CH", true], ["Divo", "divo.ch", "CH", true],
    ["Bindella", "bindella.ch", "CH", true], ["Smith & Smith", "smithandsmith.ch", "CH", true], ["Ullrich", "ullrich.ch", "CH", true],
    ["Schuler", "schuler.ch", "CH", true],
    ["Vinatis", "vinatis.com", "FR", false], ["Millésima", "millesima.fr", "FR", false], ["Lavinia", "lavinia.fr", "FR", false],
    ["Hawesko", "hawesko.de", "DE", false],
  ];
  const KIND = { target: "Prix cible atteint", drop: "Baisse de prix", promo: "En promotion", back: "De nouveau disponible" };
  // Prix par bouteille : tel quel de 50 à 100 cl, ramené à 75 cl pour un magnum ou une demi-bouteille (comme côté serveur).
  const per75 = (o) => o.price == null ? null : !o.volume_cl || (o.volume_cl >= 50 && o.volume_cl <= 100) ? o.price : o.price * 75 / o.volume_cl;

  async function uid() { const { data: { user } } = await sb.auth.getUser(); return user && user.id; }

  async function ensureSites() {
    const { count } = await sb.from("watch_sites").select("id", { count: "exact", head: true });
    if (count) return;
    await sb.from("watch_sites").insert(SITES.map(([name, domain, country, enabled]) => ({ name, domain, country, enabled, builtin: true })));
  }

  // Vins surveillés de l'utilisateur, avec leurs pages : Map item_id → { w, offers }.
  async function load(itemIds) {
    const map = new Map();
    if (!itemIds || !itemIds.length) return map;
    const { data, error } = await sb.from("watches").select("*, watch_offers(*)").in("item_id", itemIds);
    if (error) { console.warn(error); return map; }
    for (const w of data || []) map.set(w.item_id, { w, offers: (w.watch_offers || []).filter((o) => o.status !== "gone") });
    return map;
  }
  const best = (offers) => offers.filter((o) => o.price != null && o.status !== "gone").sort((a, b) => per75(a) - per75(b))[0];

  // Ligne affichée sous un vin des Envies ou des Vins passés.
  function block(item, entry, { canWatch = true } = {}) {
    if (!entry) return canWatch ? `<button class="px-btn" data-px="on" data-item="${item.id}">${I.bell || "🔔"}Surveiller le prix</button>` : "";
    const { w, offers } = entry, b = best(offers);
    const state = !w.discovered_at ? `<span class="px-wait"><span class="spin"></span>Recherche des pages…</span>`
      : b ? `<span>Meilleur prix <b>${money(b.price, b.currency)}</b>${b.regular_price ? ` <s>${money(b.regular_price, b.currency)}</s>` : ""} · ${esc(b.site_domain)}</span>`
      : `<span class="faint">${esc(w.discover_note || "Aucune page trouvée.")}</span>`;
    return `<button class="px-line" data-px="open" data-item="${item.id}" aria-label="Surveillance du prix : réglages">${I.bell || ""}${state}${w.target_price ? `<span class="tag ready">cible ${money(w.target_price, w.currency)}</span>` : ""}</button>`;
  }

  async function watchItem(item, { origin = "wish", target = null, currency = "CHF" } = {}) {
    await ensureSites();
    const { data: w, error } = await sb.from("watches").insert({ item_id: item.id, origin, target_price: target, currency }).select("*").single();
    if (error) { fail(error); return null; }
    toast("Surveillance activée. Recherche des pages chez les cavistes (environ 30 s)…");
    discover(w.id);
    return w;
  }

  async function invoke(body) {
    const { data, error } = await sb.functions.invoke("watch", { body });
    if (error) {
      let msg = "Service indisponible. Réessayez dans un instant.";
      try { const j = await error.context.json(); if (j && j.message) msg = j.message; } catch { /* réponse vide */ }
      throw new Error(msg);
    }
    return data;
  }
  async function discover(watchId, after) {
    try {
      const r = await invoke({ action: "discover", watch_id: watchId });
      toast(r.offers ? `${r.offers} page${r.offers > 1 ? "s" : ""} trouvée${r.offers > 1 ? "s" : ""} : les prix seront relus chaque nuit.` : r.note || "Aucune page trouvée.");
    } catch (e) { toast(e.message); }
    document.dispatchEvent(new CustomEvent("vc:prix"));
    after && after();
  }

  // Feuille « Surveillance du prix » : prix cible, pages trouvées, relire, chercher à nouveau, arrêter.
  async function openSheet(item, entry, onChange) {
    const { w } = entry;
    const { data: offers } = await sb.from("watch_offers").select("*").eq("watch_id", w.id).order("price", { ascending: true, nullsFirst: false });
    const { data: use } = await sb.from("watch_usage").select("cost_chf").eq("month", new Date().toISOString().slice(0, 7) + "-01").maybeSingle();
    const row = (o) => `<li class="px-offer${o.status === "gone" ? " gone" : ""}"><div><b>${esc(o.site_domain)}</b><small>${esc([o.vintage, o.volume_cl && o.volume_cl !== 75 ? `${o.volume_cl} cl` : null, o.in_stock === false ? "épuisé" : null, o.status === "error" ? "prix illisible" : null, o.status === "gone" ? "page disparue" : null, o.checked_at ? `relu le ${VC.date(o.checked_at.slice(0, 10))}` : null].filter(Boolean).join(" · "))}</small></div>
      <span class="px-price">${o.price != null ? money(o.price, o.currency) : "–"}${o.regular_price ? ` <s>${money(o.regular_price, o.currency)}</s>` : ""}</span>
      <a class="icon-btn" href="${esc(o.url)}" target="_blank" rel="noopener noreferrer" aria-label="Ouvrir la page chez ${esc(o.site_domain)}">${I.external || "↗"}</a>
      <button class="icon-btn" data-del="${o.id}" aria-label="Retirer cette page (mauvais vin)">${I.x}</button></li>`;
    const d = VC.sheet(`<div class="px-sheet"><h2>Surveillance du prix</h2><p class="muted" style="margin:-8px 0 0">${esc(item.name)}${item.vintage ? ` ${item.vintage}` : ""}</p>
      <label>Prix cible par bouteille (facultatif)<input type="number" id="px-target" min="0" step="0.5" inputmode="decimal" value="${w.target_price ?? ""}" placeholder="${esc(w.currency)}"></label>
      <div><div class="field-label">Pages suivies</div>${(offers || []).length ? `<ul class="px-offers">${offers.map(row).join("")}</ul>` : `<p class="muted">${esc(w.discover_note || (w.discovered_at ? "Aucune page trouvée." : "Recherche en cours…"))}</p>`}</div>
      <p class="hint">Les prix sont relus chaque nuit. Nouvelle recherche des pages : une fois par mois, ou à la demande. Recherches ce mois : ${money(Number(use?.cost_chf || 0), "CHF")} sur 2.00.</p>
      <div class="px-actions"><button class="btn" id="px-save">${I.check}Enregistrer</button><button class="btn ghost" id="px-check">Relire les prix</button><button class="btn ghost" id="px-find">Chercher à nouveau</button><button class="btn danger" id="px-stop">Arrêter la surveillance</button></div></div>`);
    const q = (s) => d.querySelector(s);
    d.addEventListener("click", async (e) => {
      const del = e.target.closest("[data-del]");
      if (del) { const { error } = await sb.from("watch_offers").delete().eq("id", del.dataset.del); if (error) return fail(error); del.closest("li").remove(); onChange(); }
    });
    q("#px-save").addEventListener("click", async () => {
      const v = q("#px-target").value.trim();
      const { error } = await sb.from("watches").update({ target_price: v ? Number(v) : null }).eq("id", w.id);
      if (error) return fail(error);
      d.close(); toast("Prix cible enregistré."); onChange();
    });
    q("#px-check").addEventListener("click", async (e) => {
      e.target.disabled = true; e.target.textContent = "Lecture…";
      try { const r = await invoke({ action: "check", watch_id: w.id }); toast(`${r.ok} prix lu${r.ok > 1 ? "s" : ""} sur ${r.checked}.`); } catch (err) { toast(err.message); }
      d.close(); onChange();
    });
    q("#px-find").addEventListener("click", () => { d.close(); toast("Recherche des pages (environ 30 s)…"); discover(w.id, onChange); });
    q("#px-stop").addEventListener("click", async () => {
      const { error } = await sb.from("watches").delete().eq("id", w.id);
      if (error) return fail(error);
      d.close(); toast("Surveillance arrêtée."); onChange();
    });
  }

  // Branche les boutons d'une page : items = Map id → fiche, entries = résultat de load(), defaults(item) = { origin, target }.
  function bind(root, { items, getEntries, defaults, onChange }) {
    root.addEventListener("click", async (e) => {
      const b = e.target.closest("[data-px]");
      if (!b) return;
      e.preventDefault(); e.stopPropagation();
      const it = items.get(b.dataset.item);
      if (!it) return;
      if (b.dataset.px === "on") {
        b.disabled = true;
        const w = await watchItem(it, defaults(it));
        if (w) onChange();
        else b.disabled = false;
      } else if (b.dataset.px === "open") {
        const en = getEntries().get(it.id);
        if (en) openSheet(it, en, onChange);
      }
    });
  }

  // Alertes récentes (30 jours), non vues d'abord ; vues dès qu'elles sont affichées.
  async function alerts() {
    const since = new Date(Date.now() - 30 * 864e5).toISOString();
    const { data } = await sb.from("watch_alerts").select("*, watches(item_id, items(name, vintage))").gte("created_at", since).order("created_at", { ascending: false }).limit(30);
    return data || [];
  }
  function alertsHtml(list) {
    if (!list.length) return "";
    return `<section class="card px-alerts" id="alertes"><h2 class="eyebrow">Alertes de prix</h2><ul>${list.map((a) => {
      const it = (a.watches && a.watches.items) || {};
      return `<li class="${a.seen_at ? "" : "new"}"><div><b>${esc(KIND[a.kind])}</b> · ${esc(it.name || "")}${it.vintage ? ` ${it.vintage}` : ""}<small>${esc(a.site_domain || "")} · ${VC.date(a.created_at.slice(0, 10))}</small></div>
        <span class="px-price">${money(a.price, a.currency)}${a.regular_price ? ` <s>${money(a.regular_price, a.currency)}</s>` : ""}</span>
        ${a.url ? `<a class="btn ghost" href="${esc(a.url)}" target="_blank" rel="noopener noreferrer">Voir</a>` : ""}</li>`;
    }).join("")}</ul></section>`;
  }
  async function markSeen(list) {
    const ids = list.filter((a) => !a.seen_at).map((a) => a.id);
    if (ids.length) await sb.from("watch_alerts").update({ seen_at: new Date().toISOString() }).in("id", ids);
  }
  async function unseen() {
    const { count } = await sb.from("watch_alerts").select("id", { count: "exact", head: true }).is("seen_at", null);
    return count || 0;
  }

  // Notifications sur cet appareil (Web Push). Sur iPhone : seulement depuis l'app installée sur l'écran d'accueil.
  const pushSupported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  const b64ToBytes = (s) => { const p = "=".repeat((4 - s.length % 4) % 4), b = atob((s + p).replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from(b, (c) => c.charCodeAt(0)); };
  async function pushState() {
    if (!pushSupported()) return "unsupported";
    if (Notification.permission === "denied") return "denied";
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = reg && await reg.pushManager.getSubscription();
    return sub ? "on" : "off";
  }
  async function enablePush() {
    if (!pushSupported()) throw new Error(!VC.standalone && /iPhone|iPad/.test(navigator.userAgent)
      ? "Sur iPhone, ouvrez Vinicellar depuis l'icône de l'écran d'accueil, puis activez les notifications ici."
      : "Ce navigateur ne reçoit pas les notifications.");
    const perm = await Notification.requestPermission();
    if (perm !== "granted") throw new Error("Notifications refusées. Autorisez-les dans les réglages de l'appareil.");
    const reg = await navigator.serviceWorker.register("/sw.js");
    await navigator.serviceWorker.ready;
    const { publicKey } = await invoke({ action: "vapid" });
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(publicKey) });
    const j = sub.toJSON();
    const { error } = await sb.from("push_subscriptions").upsert({ endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, ua: navigator.userAgent.slice(0, 200), user_id: await uid() }, { onConflict: "endpoint" });
    if (error) throw error;
    await sb.from("watch_prefs").upsert({ user_id: await uid(), notify_push: true });
  }
  async function disablePush() {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = reg && await reg.pushManager.getSubscription();
    if (sub) { await sb.from("push_subscriptions").delete().eq("endpoint", sub.endpoint); await sub.unsubscribe(); }
  }

  VC.Prix = { SITES, ensureSites, load, block, bind, watchItem, discover, openSheet, alerts, alertsHtml, markSeen, unseen, pushState, enablePush, disablePush, invoke, best };
})();
