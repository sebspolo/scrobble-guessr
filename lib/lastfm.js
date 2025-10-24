const API = "https://ws.audioscrobbler.com/2.0/";
const API_KEY = process.env.NEXT_PUBLIC_LASTFM_API_KEY;

/** Build Last.fm request URL */
export function lfUrl(method, params) {
  const url = new URL(API);
  url.searchParams.set("method", method);
  url.searchParams.set("api_key", API_KEY);
  url.searchParams.set("format", "json");
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  });
  return url.toString();
}

/** Basic fetch with tiny retry on 429/5xx */
export async function lfFetchJson(url, { retries = 2 } = {}) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(url);
    if (res.ok) return res.json();
    if ((res.status === 429 || res.status >= 500) && attempt < retries) {
      await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
      continue;
    }
    throw new Error(`Last.fm request failed (${res.status})`);
  }
}

/** Get top items (tracks/albums/artists). */
export async function getTop(username, kind, period, limit = 10) {
  let method = "";
  if (kind === "tracks") method = "user.getTopTracks";
  else if (kind === "albums") method = "user.getTopAlbums";
  else if (kind === "artists") method = "user.getTopArtists";
  else throw new Error("Unknown kind: " + kind);

  const url = lfUrl(method, { user: username, period, limit, page: 1 });
  const json = await lfFetchJson(url);
  return json;
}

/** Normalize payload to { type, name, artist, playcount } */
export function normalize(kind, json) {
  const out = [];
  if (!json) return out;
  if (kind === "tracks") {
    const items = json.toptracks?.track || [];
    for (const t of items) {
      out.push({ type: "track", name: t.name, artist: t.artist?.name || "", playcount: Number(t.playcount || 0) });
    }
  } else if (kind === "albums") {
    const items = json.topalbums?.album || [];
    for (const a of items) {
      out.push({ type: "album", name: a.name, artist: (a.artist && (a.artist.name || a.artist)) || "", playcount: Number(a.playcount || 0) });
    }
  } else if (kind === "artists") {
    const items = json.topartists?.artist || [];
    for (const ar of items) {
      out.push({ type: "artist", name: ar.name, artist: "", playcount: Number(ar.playcount || 0) });
    }
  }
  return out;
}
