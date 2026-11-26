(() => {
  const E = window.Eureka;
  const { $, el } = E;
  const panel = $("#weather");
  const status = $("#weather-status");
  const list = $("#weather-days");
  const forecasts = new Map();
  let selection = "";

  function dayPlus(day, amount) {
    return new Date(Date.parse(day + "T00:00Z") + amount * 86400_000).toISOString().slice(0, 10);
  }

  async function forecast(lat, lng, today) {
    const query = new URLSearchParams({
      latitude: lat, longitude: lng, timezone: "Europe/Zurich", forecast_days: "16", past_days: "3",
      daily: "weather_code,temperature_2m_min,temperature_2m_max,precipitation_probability_max"
    });
    const key = lat + "/" + lng + "/" + today;
    if (!forecasts.has(key)) {
      forecasts.set(key, fetch("https://api.open-meteo.com/v1/forecast?" + query, {
        signal: AbortSignal.timeout(8000), referrerPolicy: "no-referrer"
      }).then(async (response) => {
        if (!response.ok) throw new Error();
        const { daily } = await response.json();
        return daily;
      }).catch((error) => {
        forecasts.delete(key);
        throw error;
      }));
    }
    return forecasts.get(key);
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
      const daily = dates[0] <= limit ? await forecast(idea.lat, idea.lng, today) : null;
      if (selection !== key) return;
      status.textContent = day > limit ? "Prévisions disponibles jusqu’à 16 jours environ." : "";
      list.replaceChildren(...dates.map((date) => {
        const i = daily?.time.indexOf(date) ?? -1;
        const entry = el("li");
        const label = el(date === day ? "strong" : "span", E.date(date));
        if (date === day) label.textContent += " · activité";
        const low = daily?.temperature_2m_min[i], high = daily?.temperature_2m_max[i];
        const rain = daily?.precipitation_probability_max[i], code = daily?.weather_code[i];
        const details = i < 0 || code == null ? (date < today ? "Jour passé" : "Prévision indisponible")
          : (date < today ? "Estimation passée · " : "") + conditions(code) + (low == null || high == null ? "" : ` · ${Math.round(low)} à ${Math.round(high)} °C`)
            + (rain == null ? "" : ` · Précipitations ${rain} %`);
        entry.append(label, el("small", details));
        return entry;
      }));
    } catch {
      if (selection !== key) return;
      selection = "";
      status.textContent = "Prévisions indisponibles pour le moment.";
    }
  };
})();
