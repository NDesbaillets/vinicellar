// Lecture du prix d'une page produit, sans IA.
// Les boutiques ne publient pas toutes leur prix de la même façon : on rassemble les candidats
// (balisage schema.org, méta « product:price », données JSON de la page, texte « CHF 33.50 »),
// puis on garde celui qui correspond au prix de référence relevé lors de la recherche (prix par bouteille).
// Un carton de 6 ou de 12 est ramené à la bouteille.

export type Reading = { unit: number; regular: number | null; currency: string | null; inStock: boolean | null; method: string; vintage: number | null };
type Cand = { v: number; kind: "ld" | "meta" | "json" | "text"; regular: boolean; qty: number };

const REGULAR_KEYS = /^(old|regular|list|base|was|strike|original|normal|uvp|compare)/i;
const PRICE_KEYS = /^(price|finalprice|final_price|special_price|specialprice|saleprice|sale_price|regular_price|regularprice|oldprice|old_price|listprice|list_price|baseprice|base_price|offerprice|wasprice|was_price|strikeprice|originalprice|normalprice)$/i;
const num = (s: unknown) => {
  if (typeof s === "number") return Number.isFinite(s) ? s : NaN;
  if (typeof s !== "string") return NaN;
  const t = s.replace(/[’'\s]/g, "").replace(/,(\d{2})$/, ".$1").replace(/,/g, "");
  return Number(t);
};

function walkLd(node: unknown, out: Cand[], meta: { currency?: string; stock?: boolean; vintage?: number }) {
  if (Array.isArray(node)) { node.forEach((n) => walkLd(n, out, meta)); return; }
  if (!node || typeof node !== "object") return;
  const o = node as Record<string, unknown>;
  const type = String(o["@type"] ?? "");
  // Millésime affiché par la fiche produit (nom, identifiant ou « _vintage=2024 » dans l'adresse).
  if (/Product/.test(type) && meta.vintage === undefined) {
    const m = `${o.name ?? ""} ${o["@id"] ?? ""} ${o.url ?? ""}`.match(/(?:vintage=|\b)((?:19[5-9]|20[0-4])\d)\b/);
    if (m) meta.vintage = Number(m[1]);
  }
  if (/Offer/.test(type)) {
    const qty = num((o.eligibleQuantity as Record<string, unknown> | undefined)?.value) || 1;
    for (const k of ["price", "lowPrice"]) { const v = num(o[k]); if (v > 0) out.push({ v, kind: "ld", regular: false, qty }); }
    if (typeof o.priceCurrency === "string") meta.currency ??= o.priceCurrency;
    if (typeof o.availability === "string") meta.stock ??= /InStock|LimitedAvailability|PreOrder/i.test(o.availability) ? true : /OutOfStock|SoldOut|Discontinued/i.test(o.availability) ? false : undefined;
    const specs = ([] as unknown[]).concat(o.priceSpecification ?? []);
    for (const sp of specs) {
      const s = sp as Record<string, unknown>;
      const v = num(s?.price);
      if (v > 0) out.push({ v, kind: "ld", regular: /Strikethrough|ListPrice|MSRP/i.test(String(s.priceType ?? "")), qty });
    }
  }
  for (const [k, v] of Object.entries(o)) if (k !== "@context" && v && typeof v === "object") walkLd(v, out, meta);
}

export function extract(html: string, ref: number | null): Reading | null {
  const cands: Cand[] = [];
  const meta: { currency?: string; stock?: boolean; vintage?: number } = {};
  for (const m of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { walkLd(JSON.parse(m[1].trim()), cands, meta); } catch { /* bloc illisible */ }
  }
  for (const m of html.matchAll(/<meta[^>]+(?:property|name)=["'](?:product|og):price:(amount|currency)["'][^>]*content=["']([^"']+)["']/gi)) {
    if (m[1].toLowerCase() === "currency") meta.currency ??= m[2];
    else { const v = num(m[2]); if (v > 0) cands.push({ v, kind: "meta", regular: false, qty: 1 }); }
  }
  for (const m of html.matchAll(/itemprop=["']price["'][^>]*content=["']([\d.,]+)["']/gi)) { const v = num(m[1]); if (v > 0) cands.push({ v, kind: "meta", regular: false, qty: 1 }); }
  let jsonCount = 0;
  for (const m of html.matchAll(/["']([A-Za-z_]{4,16})["']\s*:\s*["']?(\d{1,5}(?:[.,]\d{1,2})?)["']?/g)) {
    if (!PRICE_KEYS.test(m[1]) || ++jsonCount > 400) continue;
    const v = num(m[2]); if (v > 0) cands.push({ v, kind: "json", regular: REGULAR_KEYS.test(m[1]), qty: 1 });
  }
  const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;|\s+/g, " ");
  let textCount = 0;
  for (const m of text.matchAll(/(?:CHF|Fr\.|EUR|€)\s?(\d{1,4}(?:['’]\d{3})?[.,]\d{2}|\d{1,4}\.–|\d{1,4}\.-)|(\d{1,4}(?:['’]\d{3})?[.,]\d{2})\s?(?:CHF|Fr\.|EUR|€)/g)) {
    if (++textCount > 60) break;
    const v = num((m[1] || m[2]).replace(/\.[–-]$/, ".00")); if (v > 0) cands.push({ v, kind: "text", regular: false, qty: 1 });
  }
  if (!meta.currency) meta.currency = /\bCHF\b/.test(text) ? "CHF" : /€|\bEUR\b/.test(text) ? "EUR" : undefined;
  if (!cands.length) return null;

  // Prix unitaire : chaque candidat, et ses versions par carton de 6 ou 12 quand la quantité n'est pas donnée.
  const rank = { ld: 0, json: 1, meta: 2, text: 3 } as const;
  const units = cands.flatMap((c) => {
    const base = { ...c, u: c.v / c.qty, pen: rank[c.kind] };
    return c.qty > 1 ? [base] : [base, { ...c, u: c.v / 6, pen: rank[c.kind] + 3 }, { ...c, u: c.v / 12, pen: rank[c.kind] + 4 }];
  });
  // Avec un prix connu : le candidat proche (de −55 % à +60 %) issu de la source la plus fiable, puis le plus proche.
  // Sans prix connu : la source la plus fiable (schema.org, puis données de la page).
  const pick = ref && ref > 0
    ? units.filter((c) => !c.regular && c.u >= ref * 0.45 && c.u <= ref * 1.6)
      .sort((a, b) => a.pen + Math.abs(Math.log(a.u / ref)) * 4 - (b.pen + Math.abs(Math.log(b.u / ref)) * 4))[0]
    : units.filter((c) => !c.regular && c.pen < 3).sort((a, b) => a.pen - b.pen)[0];
  if (!pick) return null;
  const unit = Math.round(pick.u * 100) / 100;
  // Prix normal : un prix « ancien / barré » ou un prix affiché plus haut, au plus 80 % au-dessus.
  const regs = units.filter((c) => c.pen < 3 && c.u > unit * 1.03 && c.u <= unit * 1.8 && (c.regular || c.kind === "meta" || c.kind === "ld"));
  const regular = regs.length ? Math.round(Math.max(...regs.map((c) => c.u)) * 100) / 100 : null;
  if (meta.vintage === undefined) {
    const t = (html.match(/<title>([^<]{0,200})<\/title>/i) || [])[1] || "";
    const m = t.match(/\b((?:19[5-9]|20[0-4])\d)\b/);
    if (m) meta.vintage = Number(m[1]);
  }
  return { unit, regular, currency: meta.currency ?? null, inStock: meta.stock ?? null, method: pick.kind, vintage: meta.vintage ?? null };
}
