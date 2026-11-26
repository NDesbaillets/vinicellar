(() => {
  const E = window.Eureka;
  const { $, el } = E;
  const panel = $("#weather");
  const status = $("#weather-status");
  const list = $("#weather-days");
  const forecasts = new Map();
  const swissSource = $("#weather-swiss-source");
  const genericSource = $("#weather-generic-source");
  let selection = "";
  let border;

  function inside(lng, lat, ring) {
    let contains = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [x, y] = ring[i], [otherX, otherY] = ring[j];
      if ((y > lat) !== (otherY > lat) && lng < x + (otherX - x) * (lat - y) / (otherY - y)) {
        contains = !contains;
      }
    }
    return contains;
  }

  async function inSwitzerland(lat, lng) {
    if (lat < 45.8 || lat > 47.9 || lng < 5.9 || lng > 10.6) return false;
    border ??= fetch("/eureka/assets/frontiere-suisse.json", { signal: AbortSignal.timeout(3000) })
      .then((response) => {
        if (!response.ok) throw new Error();
        return response.json();
      }).catch(() => {
        border = undefined;
        return [];
      });
    return (await border).some(([outer, ...holes]) =>
      inside(lng, lat, outer) && !holes.some((hole) => inside(lng, lat, hole)));
  }

  function dayPlus(day, amount) {
    return new Date(Date.parse(day + "T00:00Z") + amount * 86400_000).toISOString().slice(0, 10);
  }

  function forecast(lat, lng, today, model = "") {
    const query = new URLSearchParams({
      latitude: lat, longitude: lng, timezone: "Europe/Zurich", forecast_days: "16", past_days: "3",
      daily: "weather_code,temperature_2m_min,temperature_2m_max,precipitation_probability_max"
    });
    if (model) {
      query.set("models", model);
      query.set("forecast_days", "5");
      query.delete("past_days");
    }
    const key = [lat, lng, today, model].join("/");
    if (!forecasts.has(key)) {
      forecasts.set(key, fetch("https://api.open-meteo.com/v1/forecast?" + query, {
        signal: AbortSignal.timeout(8000), referrerPolicy: "no-referrer"
      }).then(async (response) => {
        if (!response.ok) throw new Error();
        const { daily } = await response.json();
        if (!Array.isArray(daily?.time)) throw new Error();
        return daily;
      }).catch((error) => {
        forecasts.delete(key);
        throw error;
      }));
    }
    return forecasts.get(key);
  }

  function forecastDay(daily, date, source) {
    const i = daily?.time.indexOf(date) ?? -1;
    const code = daily?.weather_code?.[i];
    const low = daily?.temperature_2m_min?.[i], high = daily?.temperature_2m_max?.[i];
    if (i < 0 || ![code, low, high].every(Number.isFinite)) return null;
    return { code, low, high, rain: daily.precipitation_probability_max?.[i], source };
  }

  async function forecastDays(lat, lng, today, dates) {
    const swissEnd = dayPlus(today, 4);
    const swiss = dates.some((date) => date >= today && date <= swissEnd) && await inSwitzerland(lat, lng);
    const local = swiss
      ? await forecast(lat, lng, today, "meteoswiss_icon_seamless").catch(() => null)
      : null;
    const result = dates.map((date) => date >= today && date <= swissEnd
      ? forecastDay(local, date, "MétéoSuisse") : null);
    const last = dayPlus(today, 15);
    if (!dates.some((date, i) => date <= last && !result[i])) return result;
    try {
      const generic = await forecast(lat, lng, today);
      return dates.map((date, i) => result[i] || forecastDay(generic, date, "Open-Meteo"));
    } catch (error) {
      if (result.some(Boolean)) return result;
      throw error;
    }
  }

  function conditions(code) {
    if (code === 0) return "Ensoleillé";
    if (code <= 2) return "Éclaircies";
    if (code === 3) return "Couvert";
    if (code <= 48) return "Brouillard";
    if (code >= 95) return "Orages";
    if ((code >= 71 && code <= 77) || code >= 85) return "Neige";
    return "Pluie";
  }

  window.EurekaWeather = async (idea, day) => {
    const key = idea ? idea.id + "/" + day : "";
    if (selection === key) return;
    selection = key;
    panel.hidden = !idea;
    if (!idea) return;
    status.textContent = "";
    list.replaceChildren();
    swissSource.hidden = true;
    genericSource.hidden = true;
    $("#weather-title").textContent = "Météo · " + (idea.ville || idea.titre);
    if (idea.lat == null || idea.lng == null) {
      status.textContent = "Ajoute les coordonnées du lieu à la fiche pour afficher sa météo.";
      return;
    }
    const today = E.swissDay();
    const limit = dayPlus(today, 15);
    const dates = Array.from({ length: 7 }, (_, index) => dayPlus(day, index - 3));
    if (dates[0] <= limit) status.textContent = "Chargement des prévisions…";
    try {
      const forecasts = dates[0] <= limit ? await forecastDays(Number(idea.lat), Number(idea.lng), today, dates) : [];
      if (selection !== key) return;
      status.textContent = day > limit ? "Prévisions disponibles jusqu’à 16 jours environ." : "";
      const hasSwiss = forecasts.some((item) => item?.source === "MétéoSuisse");
      const hasGeneric = forecasts.some((item) => item?.source === "Open-Meteo");
      swissSource.hidden = !hasSwiss;
      genericSource.hidden = !hasSwiss && !hasGeneric;
      list.replaceChildren(...dates.map((date, i) => {
        const entry = el("li");
        const label = el(date === day ? "strong" : "span", E.date(date));
        if (date === day) label.textContent += " · activité";
        const item = forecasts[i];
        const details = item
          ? (date < today ? "Estimation passée · " : "") + conditions(item.code)
            + ` · ${Math.round(item.low)} à ${Math.round(item.high)} °C`
            + (item.rain == null ? "" : ` · Précipitations ${item.rain} %`)
          : date < today ? "Jour passé" : "Prévision indisponible";
        entry.append(label, el("small", details));
        if (item && hasSwiss && hasGeneric) entry.append(el("small", item.source));
        return entry;
      }));
    } catch {
      if (selection !== key) return;
      selection = "";
      status.textContent = "Prévisions indisponibles pour le moment.";
    }
  };
})();
