import { https, text } from "./extraction.ts";

export async function searchTavily(key: string, query: string) {
  const response = await fetch("https://api.tavily.com/search", {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(5500),
    headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
    body: JSON.stringify({ query: query.slice(0, 400), search_depth: "basic", max_results: 10,
      include_answer: false, include_raw_content: false }),
  });
  if (!response.ok) throw new Error("Recherche Tavily indisponible");
  const { results } = await response.json();
  if (!Array.isArray(results)) return [];
  const seen = new Set<string>();
  return results.slice(0, 10).flatMap((item) => {
    const url = https(item?.url);
    const titre = text(item?.title, 180), extrait = text(item?.content, 700);
    if (!url || !titre || !extrait || seen.has(url)) return [];
    seen.add(url);
    return [{ url, titre, extrait }];
  });
}
