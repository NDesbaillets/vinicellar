export type CarTrip = { aller_minutes: number; retour_minutes: number };

export async function googleCarTrip(origin: string, destination: string, key: string): Promise<CarTrip | null> {
  if (!origin || !destination || !key) return null;
  const minutes = async (from: string, to: string) => {
    const response = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(4000),
      headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key, "X-Goog-FieldMask": "routes.duration" },
      body: JSON.stringify({ origin: { address: from }, destination: { address: to },
        travelMode: "DRIVE", routingPreference: "TRAFFIC_UNAWARE", languageCode: "fr-CH" }),
    });
    if (!response.ok) return null;
    const { routes } = await response.json();
    const duration = routes?.[0]?.duration;
    if (typeof duration !== "string" || !/^\d+(\.\d+)?s$/.test(duration)) return null;
    const min = Math.ceil(Number(duration.slice(0, -1)) / 60);
    return min > 0 && min <= 1440 ? min : null;
  };
  try {
    const [aller_minutes, retour_minutes] = await Promise.all([minutes(origin, destination), minutes(destination, origin)]);
    return aller_minutes == null || retour_minutes == null ? null : { aller_minutes, retour_minutes };
  } catch {
    return null;
  }
}
