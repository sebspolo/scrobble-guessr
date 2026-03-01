import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { lfUrl, lfFetchJson } from "../lib/lastfm";

/** Default avatar (transparent LFM placeholder) */
const DEFAULT_AVATAR =
  "https://lastfm.freetls.fastly.net/i/u/avatar170s/2a96cbd8b46e442fc41c2b86b821562f.png";

const SORTABLE_KEYS = ["scrobbles", "artists", "albums", "tracks"]; // friend is NOT clickable

function safeNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

function getImageFromUserInfo(json) {
  const imgs = json?.user?.image || [];
  // prefer small (matches your scoreboard style), fallback to anything
  const small = imgs.find((i) => i?.size === "small" && i["#text"]);
  return (small?.["#text"] || imgs?.[0]?.["#text"] || "").trim();
}

async function fetchUserScrobblesAndAvatar(username) {
  // user.getInfo: reliably gives playcount (scrobbles)
  const url = lfUrl("user.getInfo", { user: username });
  const json = await lfFetchJson(url);
  return {
    scrobbles: safeNum(json?.user?.playcount),
    avatar: getImageFromUserInfo(json),
  };
}

function extractLibraryTotal(json) {
  // library.* responses usually look like { artists: { ... '@attr': { total } } }
  const container = json?.artists || json?.albums || json?.tracks || null;
  const total = container?.["@attr"]?.total;
  return safeNum(total);
}

async function fetchLibraryTotal(username, method) {
  // limit=1 so we only grab totals fast
  const url = lfUrl(method, { user: username, limit: 1, page: 1 });
  const json = await lfFetchJson(url);
  return extractLibraryTotal(json);
}

/** Tiny concurrency runner (keeps you fast without blasting Last.fm) */
async function runWithConcurrency(tasks, n = 4) {
  let i = 0;
  const results = new Array(tasks.length);

  async function worker() {
    while (i < tasks.length) {
      const cur = i++;
      try {
        results[cur] = await tasks[cur]();
      } catch (e) {
        results[cur] = null;
      }
    }
  }

  const workers = [];
  const m = Math.min(n, tasks.length);
  for (let k = 0; k < m; k++) workers.push(worker());
  await Promise.all(workers);
  return results;
}

function fmt(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return "—";
  return x.toLocaleString();
}

export default function FriendsLeaderboardPage() {
  const [owner, setOwner] = useState("");
  const [friends, setFriends] = useState([]);
  const [rows, setRows] = useState([]);
  const [status, setStatus] = useState("idle"); // idle | loading | ready | error
  const [error, setError] = useState("");

  const [sortKey, setSortKey] = useState("scrobbles"); // default sort
  const [sortDir, setSortDir] = useState("desc"); // desc by default

  // Load data passed from Scoreboard via sessionStorage
  useEffect(() => {
    try {
      const raw = typeof window !== "undefined" ? sessionStorage.getItem("sg_friends_payload") : null;
      if (!raw) return;
      const payload = JSON.parse(raw);
      if (payload?.owner) setOwner(payload.owner);
      if (Array.isArray(payload?.friends)) setFriends(payload.friends);
    } catch (e) {
      // ignore
    }
  }, []);

  const users = useMemo(() => {
    // always include YOU + friends from getFriends
    const seen = new Set();
    const out = [];

    if (owner && owner.trim()) {
      const o = owner.trim();
      seen.add(o.toLowerCase());
      out.push({ name: o, avatar: "" });
    }

    for (const f of friends || []) {
      const nm = (f?.name || "").trim();
      if (!nm) continue;
      const key = nm.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ name: nm, avatar: f?.avatar || "" });
    }

    // hard cap 31-ish (you said max 30 friends)
    return out.slice(0, 31);
  }, [owner, friends]);

  async function build() {
    setError("");
    if (!owner || !owner.trim() || users.length === 0) {
      setError("Go back and load your friends first.");
      setStatus("error");
      return;
    }

    setStatus("loading");

    // Cache key so refreshing the page is instant
    const cacheKey = `sg_friends_leaderboard_cache::${owner.trim().toLowerCase()}`;

    // Try cache first
    try {
      const cachedRaw = sessionStorage.getItem(cacheKey);
      if (cachedRaw) {
        const cached = JSON.parse(cachedRaw);
        if (Array.isArray(cached?.rows) && cached.rows.length > 0) {
          setRows(cached.rows);
          setStatus("ready");
          return;
        }
      }
    } catch (e) {
      // ignore cache errors
    }

    // Build tasks: 1) user.getInfo for scrobbles+avatar, 2) library totals
    const tasks = users.map((u) => {
      return async () => {
        const username = u.name;

        // 1) scrobbles + avatar
        const info = await fetchUserScrobblesAndAvatar(username);
        const avatar = (u.avatar || info.avatar || DEFAULT_AVATAR).trim() || DEFAULT_AVATAR;

        // 2) library totals (unique)
        // These method names are the standard Last.fm library endpoints.
        // If albums/tracks totals ever come back 0 due to API behavior, we’ll still render safely.
       let artists = 0, albums = 0, tracks = 0;
        try { artists = await fetchLibraryTotal(username, "library.getArtists"); } catch (e) { artists = 0; }
        try { albums  = await fetchLibraryTotal(username, "library.getAlbums");  } catch (e) { albums  = 0; }
        try { tracks  = await fetchLibraryTotal(username, "library.getTracks");  } catch (e) { tracks  = 0; }
        return {
          name: username,
          avatar,
          scrobbles: info.scrobbles,
          artists,
          albums,
          tracks,
        };
      };
    });

    // Keep it fast but not rate-limit-y
    const results = (await runWithConcurrency(tasks, 4)).filter(Boolean);

    // If Last.fm rate limits or a user hides data, those fields may be 0—still okay.
    setRows(results);
    setStatus("ready");

    // Save cache for fast refresh/sorts
    try {
      sessionStorage.setItem(cacheKey, JSON.stringify({ rows: results, ts: Date.now() }));
    } catch (e) {
      // ignore
    }
  }

  useEffect(() => {
    // Auto-build once users are present
    if (users.length > 0 && owner) build();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner, users.length]);

  function onHeaderClick(key) {
    if (!SORTABLE_KEYS.includes(key)) return;

    if (sortKey === key) {
      setSortDir(sortDir === "desc" ? "asc" : "desc");
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  const sortedRows = useMemo(() => {
    const arr = [...rows];

    const dir = sortDir === "asc" ? 1 : -1;
    arr.sort((a, b) => {
      const av = safeNum(a?.[sortKey]);
      const bv = safeNum(b?.[sortKey]);
      if (av === bv) return (a.name || "").localeCompare(b.name || "");
      return (av - bv) * dir;
    });

    return arr;
  }, [rows, sortKey, sortDir]);

  return (
    <main style={{ maxWidth: 980, margin: "0 auto", padding: 24 }}>
      <h1 style={{ fontSize: 44, margin: "8px 0 8px" }}>Friends Leaderboard</h1>

      <div style={{ marginBottom: 14 }}>
        <Link href="/scoreboard">← Back to Artist Scoreboard</Link>
      </div>

      {status !== "ready" ? (
        <div
          style={{
            border: "1px solid #eee",
            borderRadius: 18,
            padding: 18,
            background: "#fff",
          }}
        >
          <div style={{ fontSize: 18, marginBottom: 6 }}>
            {status === "loading" ? "Building leaderboard…" : "Waiting for friends data…"}
          </div>
          {error ? <div style={{ color: "#b00020" }}>{error}</div> : null}
          {!owner || users.length === 0 ? (
            <div style={{ opacity: 0.8, marginTop: 8 }}>
              You need to load friends from the Artist Scoreboard page first.
            </div>
          ) : null}
        </div>
      ) : null}

      {status === "ready" ? (
        <div
          style={{
            border: "1px solid #eee",
            borderRadius: 18,
            padding: 18,
            background: "#fff",
          }}
        >
          <div style={{ marginBottom: 10, opacity: 0.85 }}>
            Sorting by <b>{sortKey}</b> ({sortDir})
          </div>

          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ textAlign: "left", borderBottom: "1px solid #eee" }}>
                  <th style={{ padding: "10px 8px", width: 70 }}>Rank</th>
                  <th style={{ padding: "10px 8px", minWidth: 260 }}>Friend</th>

                  <th
                    style={{ padding: "10px 8px", cursor: "pointer", userSelect: "none" }}
                    onClick={() => onHeaderClick("scrobbles")}
                    title="Click to sort"
                  >
                    Scrobbles
                  </th>

                  <th
                    style={{ padding: "10px 8px", cursor: "pointer", userSelect: "none" }}
                    onClick={() => onHeaderClick("artists")}
                    title="Click to sort"
                  >
                    Artists
                  </th>

                  <th
                    style={{ padding: "10px 8px", cursor: "pointer", userSelect: "none" }}
                    onClick={() => onHeaderClick("albums")}
                    title="Click to sort"
                  >
                    Albums
                  </th>

                  <th
                    style={{ padding: "10px 8px", cursor: "pointer", userSelect: "none" }}
                    onClick={() => onHeaderClick("tracks")}
                    title="Click to sort"
                  >
                    Tracks
                  </th>
                </tr>
              </thead>

              <tbody>
                {sortedRows.map((r, idx) => {
                  return (
                    <tr key={r.name} style={{ borderBottom: "1px solid #f1f1f1" }}>
                      <td style={{ padding: "10px 8px", fontWeight: 700 }}>{idx + 1}</td>

                      <td style={{ padding: "10px 8px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <img
                            src={(r.avatar || DEFAULT_AVATAR) || DEFAULT_AVATAR}
                            alt=""
                            width={28}
                            height={28}
                            style={{ borderRadius: 999, objectFit: "cover" }}
                            onError={(e) => {
                              e.currentTarget.src = DEFAULT_AVATAR;
                            }}
                          />
                          <a
                            href={`https://www.last.fm/user/${encodeURIComponent(r.name)}`}
                            target="_blank"
                            rel="noreferrer"
                            style={{ textDecoration: "none" }}
                          >
                            <b>{r.name}</b>
                          </a>
                        </div>
                      </td>

                      <td style={{ padding: "10px 8px" }}>{fmt(r.scrobbles)}</td>
                      <td style={{ padding: "10px 8px" }}>{r.artists ? fmt(r.artists) : "—"}</td>
                      <td style={{ padding: "10px 8px" }}>{r.albums ? fmt(r.albums) : "—"}</td>
                      <td style={{ padding: "10px 8px" }}>{r.tracks ? fmt(r.tracks) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div style={{ marginTop: 12, opacity: 0.7, fontSize: 13 }}>
            Note: Artists/Albums/Tracks are pulled from library totals. If a user’s library totals aren’t available,
            that cell shows “—”.
          </div>
        </div>
      ) : null}
    </main>
  );
}
