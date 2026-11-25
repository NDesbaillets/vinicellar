import { DOMParser } from "npm:@xmldom/xmldom@0.9.12";
import ICAL from "npm:ical.js@2.2.1";

const DAV = "DAV:";
const CAL = "urn:ietf:params:xml:ns:caldav";
const ZONE = "Europe/Zurich";
const root = "https://caldav.icloud.com/";
const MAX = 5_000_000;
export type Action = "decouverte" | "lecture" | "ecriture" | "retrait";
export type Bloc = { debut: string; fin: string; uid_externe: string; titre?: string };
type Send = (url: URL, request: RequestInit, action: Action) => Promise<Response>;
type ElementNode = ReturnType<InstanceType<typeof DOMParser>["parseFromString"]>["documentElement"];

export function icloudUrl(value: string, base = root, collection = false) {
  const url = new URL(value, base);
  if (url.protocol !== "https:" || !/^(caldav|p\d+-caldav)\.icloud\.com$/.test(url.hostname)
    || url.port || url.username || url.password || url.search || url.hash
    || /%(2f|5c)/i.test(url.pathname)) throw new Error("Adresse CalDAV iCloud invalide");
  if (collection && !url.pathname.endsWith("/")) url.pathname += "/";
  return url;
}

async function responseText(res: Response) {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.length;
    if (bytes > MAX) { await reader.cancel(); throw new Error("Réponse iCloud trop volumineuse"); }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

// Inventorie les résultats 207, en ignorant les propriétés refusées lors de
// la découverte. Une erreur de ressource pendant une lecture invalide le lot.
function nodes(xml: string) {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error("XML CalDAV inattendu");
  const doc = new DOMParser({ onError: () => { throw new Error("XML CalDAV invalide"); } })
    .parseFromString(xml, "application/xml");
  if (doc.documentElement?.namespaceURI !== DAV || doc.documentElement.localName !== "multistatus") {
    throw new Error("Réponse CalDAV non reconnue");
  }
  return Array.from(doc.getElementsByTagNameNS(DAV, "response")).map((node) => {
    const child = (n: ElementNode, ns: string, tag: string) => n?.getElementsByTagNameNS(ns, tag).item(0);
    const ok = (status: string | null | undefined) => /\s2\d\d(?:\s|$)/.test(status || "");
    const props = Array.from(node.getElementsByTagNameNS(DAV, "propstat"))
      .filter((item) => ok(child(item, DAV, "status")?.textContent));
    const status = Array.from(node.childNodes).find((item) => item.nodeType === 1 && item.localName === "status");
    return {
      href: child(node, DAV, "href")?.textContent?.trim() || "",
      failed: Boolean(status && !ok(status.textContent)),
      get: (ns: string, tag: string) => props.map((item) => child(item, ns, tag)).find(Boolean) || null,
    };
  });
}

function davDate(value: string) {
  return new Date(value).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

const formats = new Map<string, Intl.DateTimeFormat>();
function localParts(instant: number, zone: string) {
  let formatter = formats.get(zone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", { timeZone: zone, calendar: "gregory", numberingSystem: "latn",
      hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    formats.set(zone, formatter);
  }
  const values = Object.fromEntries(formatter.formatToParts(instant).map(({ type, value }) => [type, value]));
  return values.year + "-" + values.month + "-" + values.day + "T" + values.hour + ":" + values.minute + ":" + values.second;
}

export function swissDay(instant: number) {
  return localParts(instant, ZONE).slice(0, 10);
}

export function dayPlus(day: string, count: number) {
  return new Date(Date.parse(day + "T00:00:00Z") + count * 86_400_000).toISOString().slice(0, 10);
}

function possibleInstants(local: string, zone: string) {
  const naive = Date.parse(local + "Z");
  const shifts = new Set([-36, 0, 36].map((h) => {
    const instant = naive + h * 3_600_000;
    return Date.parse(localParts(instant, zone) + "Z") - instant;
  }));
  return [...shifts].map((shift) => naive - shift).filter((time) => localParts(time, zone) === local).sort((a, b) => a - b);
}

export function preferredSlot(day: string, heure: string, minutes: number) {
  const local = day + "T" + heure.slice(0, 5) + ":00";
  const starts = possibleInstants(local, ZONE);
  if (starts.length !== 1) return null;
  return { debut: new Date(starts[0]).toISOString(), fin: new Date(starts[0] + minutes * 60_000).toISOString() };
}

function calendarTime(t: ICAL.Time, zoneId: string | undefined, end: boolean) {
  if (t.zone === ICAL.Timezone.utcTimezone) return t.toUnixTime() * 1000;
  if (!t.isDate && t.zone.component) return t.toUnixTime() * 1000;
  const part = t.toString().slice(0, 19);
  const local = t.isDate ? part + "T00:00:00" : part;
  const choices = possibleInstants(local, t.isDate ? ZONE : zoneId || ZONE);
  if (!choices.length) throw new Error("Heure d’agenda invalide");
  return end ? choices[choices.length - 1] : choices[0];
}

export async function parseCalendar(text: string, titles: boolean, from: string, to: string): Promise<Bloc[]> {
  const calendar = new ICAL.Component(ICAL.parse(text));
  if (calendar.name !== "vcalendar") throw new Error("Agenda invalide");
  // Réutilise les composantes de fuseau uniquement pour ce document.
  const zones = new Map(calendar.getAllSubcomponents("vtimezone").map((component) => {
    const zone = new ICAL.Timezone({ component });
    return [zone.tzid, zone];
  }));
  const lower = Date.parse(from), upper = Date.parse(to);
  const rows: Bloc[] = [];
  for (const component of calendar.getAllSubcomponents("vevent")) {
    if (String(component.getFirstPropertyValue("status")).toUpperCase() === "CANCELLED"
      || String(component.getFirstPropertyValue("transp")).toUpperCase() === "TRANSPARENT") continue;
    if (component.hasProperty("rrule") || component.hasProperty("rdate")) {
      throw new Error("Le serveur n’a pas développé les récurrences");
    }
    const event = new ICAL.Event(component);
    if (!event.uid || !event.startDate) throw new Error("Événement incomplet");
    function instant(time: ICAL.Time, name: string, end: boolean) {
      const params = component.getFirstProperty(name) || component.getFirstProperty("dtstart");
      const zoneId = params?.getParameter("tzid") as string | undefined;
      const known = zoneId ? zones.get(zoneId) : null;
      if (known && !time.isDate) {
        const copy = time.clone();
        copy.zone = known;
        return copy.toUnixTime() * 1000;
      }
      return calendarTime(time, zoneId, end);
    }
    const start = instant(event.startDate, "dtstart", false);
    const end = instant(event.endDate, "dtend", true);
    if (end < start) throw new Error("Durée d’événement invalide");
    if (start >= upper || end <= lower || end === start) continue;
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(event.uid));
    const uid = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    const row: Bloc = { debut: new Date(start).toISOString(), fin: new Date(end).toISOString(), uid_externe: uid };
    if (titles && event.summary) row.titre = String(event.summary).slice(0, 200);
    rows.push(row);
  }
  return rows;
}

export class ICloud {
  constructor(private send: Send) {}

  private async xml(uri: string, method: "PROPFIND" | "REPORT", depth: string, body: string, action: Action) {
    const url = icloudUrl(uri);
    const res = await this.send(url, { method, headers: { Depth: depth, "Content-Type": "application/xml; charset=utf-8" }, body }, action);
    if (res.status !== 207) {
      await res.body?.cancel();
      throw new Error("Réponse CalDAV inattendue");
    }
    return { url: res.url || url.href, responses: nodes(await responseText(res)) };
  }

  async discover() {
    const principal = await this.xml(root, "PROPFIND", "0",
      '<D:propfind xmlns:D="DAV:"><D:prop><D:current-user-principal/></D:prop></D:propfind>', "decouverte");
    const href = principal.responses[0]?.get(DAV, "current-user-principal")?.getElementsByTagNameNS(DAV, "href").item(0)?.textContent;
    if (!href) throw new Error("Compte iCloud introuvable");
    const home = await this.xml(icloudUrl(href, principal.url).href, "PROPFIND", "0",
      '<D:propfind xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><D:prop><C:calendar-home-set/></D:prop></D:propfind>', "decouverte");
    const collection = home.responses[0]?.get(CAL, "calendar-home-set")?.getElementsByTagNameNS(DAV, "href").item(0)?.textContent;
    if (!collection) throw new Error("Collection iCloud introuvable");
    const list = await this.properties(icloudUrl(collection, home.url, true).href, "1");
    const calendars = new Map<string, { href: string; nom: string; modifiable: boolean }>();
    for (const response of list.responses) {
      if (!response.href || !response.get(DAV, "resourcetype")?.getElementsByTagNameNS(CAL, "calendar").length) continue;
      const href = icloudUrl(response.href, list.url, true).href;
      calendars.set(href, { href, ...calendarProperties(response) });
    }
    return [...calendars.values()];
  }

  private properties(href: string, depth: string) {
    return this.xml(href, "PROPFIND", depth,
      '<D:propfind xmlns:D="DAV:"><D:prop><D:resourcetype/><D:displayname/><D:current-user-privilege-set/></D:prop></D:propfind>', "decouverte");
  }

  async canWrite(href: string) {
    const listing = await this.properties(href, "0");
    const target = icloudUrl(listing.url, root, true);
    const response = listing.responses.find((item) => item.href && icloudUrl(item.href, listing.url, true).href === target.href);
    if (!response || !response.get(DAV, "resourcetype")?.getElementsByTagNameNS(CAL, "calendar").length) return false;
    const { nom, modifiable } = calendarProperties(response);
    return nom === "Eurêka" && modifiable;
  }

  async busy(href: string, from: string, to: string, titles: boolean) {
    const start = davDate(from), end = davDate(to);
    const fields = ["UID", "DTSTART", "DTEND", "DURATION", "RECURRENCE-ID", "STATUS", "TRANSP", "RRULE", "RDATE"];
    if (titles) fields.push("SUMMARY");
    const report = `<C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
      <D:prop><C:calendar-data><C:comp name="VCALENDAR"><C:comp name="VTIMEZONE"><C:allprop/><C:allcomp/></C:comp>
      <C:comp name="VEVENT">${fields.map((field) => '<C:prop name="' + field + '"/>').join("")}</C:comp>
      </C:comp><C:expand start="${start}" end="${end}"/></C:calendar-data></D:prop>
      <C:filter><C:comp-filter name="VCALENDAR"><C:comp-filter name="VEVENT">
      <C:time-range start="${start}" end="${end}"/></C:comp-filter></C:comp-filter></C:filter></C:calendar-query>`;
    const listing = await this.xml(icloudUrl(href, root, true).href, "REPORT", "1", report, "lecture");
    const rows: Bloc[] = [];
    for (const item of listing.responses) {
      const ics = item.get(CAL, "calendar-data")?.textContent;
      if (!ics || item.failed) throw new Error("Vue d’occupation iCloud incomplète");
      rows.push(...await parseCalendar(ics, titles, from, to));
    }
    return rows;
  }

  private eventUrl(href: string, id: string) {
    if (!/^[\da-f-]{36}$/.test(id)) throw new Error("Créneau invalide");
    return icloudUrl("eureka-" + id + ".ics", icloudUrl(href, root, true).href);
  }

  async inspect(href: string, slot: Slot) {
    const res = await this.send(this.eventUrl(href, slot.id), { method: "GET" }, "lecture");
    if (res.status === 404) { await res.body?.cancel(); return null; }
    if (!res.ok) { await res.body?.cancel(); throw new Error("Créneau illisible"); }
    const etag = strongEtag(res.headers.get("etag"));
    const ics = new ICAL.Component(ICAL.parse(await responseText(res)));
    const event = ics.getFirstSubcomponent("vevent");
    if (!event) return { etag, unchanged: false };
    const item = new ICAL.Event(event);
    const unchanged = ics.getAllSubcomponents("vevent").length === 1 && item.uid === eventUid(slot.id)
      && item.summary === SUMMARY && String(event.getFirstPropertyValue("status")).toUpperCase() === "TENTATIVE"
      && item.startDate.toUnixTime() === Date.parse(slot.debut) / 1000
      && item.endDate.toUnixTime() === Date.parse(slot.fin) / 1000;
    return { etag, unchanged: Boolean(unchanged) };
  }

  async create(href: string, slot: Slot) {
    const body = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Vinicellar//Eureka//FR", "BEGIN:VEVENT",
      "UID:" + eventUid(slot.id), "DTSTAMP:" + davDate(new Date().toISOString()), "DTSTART:" + davDate(slot.debut),
      "DTEND:" + davDate(slot.fin), "SUMMARY:" + SUMMARY, "STATUS:TENTATIVE", "TRANSP:OPAQUE",
      "END:VEVENT", "END:VCALENDAR", ""].join("\r\n");
    const res = await this.send(this.eventUrl(href, slot.id), {
      method: "PUT", headers: { "Content-Type": "text/calendar; charset=utf-8", "If-None-Match": "*" }, body
    }, "ecriture");
    const etag = strongEtag(res.headers.get("etag"));
    await res.body?.cancel();
    if (res.status === 412 || res.ok && !etag) return { etag: null, verify: true };
    if (!res.ok) throw new Error("Écriture iCloud impossible");
    return { etag, verify: false };
  }

  async remove(href: string, slot: Slot, etag: string) {
    const version = strongEtag(etag);
    if (!version) return "conflit";
    const res = await this.send(this.eventUrl(href, slot.id), { method: "DELETE", headers: { "If-Match": version } }, "retrait");
    await res.body?.cancel();
    if (res.status === 412) return "conflit";
    if (res.status === 404 || res.ok) return "retire";
    throw new Error("Retrait iCloud impossible");
  }
}

function calendarProperties(response: ReturnType<typeof nodes>[number]) {
  const privileges = response.get(DAV, "current-user-privilege-set");
  const can = (name: string) => Boolean(privileges?.getElementsByTagNameNS(DAV, name).length);
  return {
    nom: response.get(DAV, "displayname")?.textContent?.trim().normalize("NFC").slice(0, 160) || "Calendrier iCloud",
    modifiable: can("all") || can("write") || (can("bind") && can("unbind") && can("write-content")),
  };
}

export type Slot = { id: string; debut: string; fin: string };
const SUMMARY = "Créneau provisoire Eurêka";
const eventUid = (id: string) => "eureka-" + id + "@vinicellar.ch";
const strongEtag = (value: string | null) => value && /^"[^"\r\n]{1,200}"$/.test(value) ? value : null;
