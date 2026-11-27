export type CarTrip = { aller_minutes: number; retour_minutes: number };

export async function googleCarTrip(origin: string, destination: string, key: string): Promise<CarTrip | null> {
  return googleRoute(origin, destination, key, false);
}

export async function googleCarDestination(origin: string, destination: string, key: string) {
  return googleRoute(origin, destination, key, true);
}

async function googleRoute(origin: string, destination: string, key: string, withPoint: boolean) {
  if (!origin || !destination || !key) return null;
  const route = async (from: string, to: string, point = false) => {
    const response = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(4000),
      headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key, "X-Goog-FieldMask": point ? "routes.duration,routes.legs.endLocation.latLng" : "routes.duration" },
      body: JSON.stringify({ origin: { address: from }, destination: { address: to },
        travelMode: "DRIVE", routingPreference: "TRAFFIC_UNAWARE", languageCode: "fr-CH" }),
    });
    if (!response.ok) return null;
    const { routes } = await response.json();
    const duration = routes?.[0]?.duration;
    if (typeof duration !== "string" || !/^\d+(\.\d+)?s$/.test(duration)) return null;
    const min = Math.ceil(Number(duration.slice(0, -1)) / 60);
    if (!(min > 0 && min <= 1440)) return null;
    const end = routes?.[0]?.legs?.at(-1)?.endLocation?.latLng;
    return { min, lat: Number.isFinite(end?.latitude) ? end.latitude as number : null,
      lng: Number.isFinite(end?.longitude) ? end.longitude as number : null };
  };
  try {
    const [out, back] = await Promise.all([route(origin, destination, withPoint), route(destination, origin)]);
    if (!out || !back) return null;
    const trip = { aller_minutes: out.min, retour_minutes: back.min };
    return withPoint ? { ...trip, lat: out.lat, lng: out.lng } : trip;
  } catch {
    return null;
  }
}
