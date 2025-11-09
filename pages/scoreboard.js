import { useMemo, useState } from 'react';
import Link from 'next/link';
import { lfUrl, lfFetchJson } from '../lib/lastfm';

/** Timeframes (keys used in logic) */
const TF = [
  { key: 'all',        label: 'All time' },
  { key: '7d',         label: '7 days (rolling)' },
  { key: '30d',        label: '1 month (last 30 days)' },
  { key: '365d',       label: '12 months (last 365 days)' },
  { key: 'this_month', label: 'This month (calendar)' },
  { key: 'this_year',  label: 'This year (calendar)' },
];

/** Scoreboard entity types */
const TYPES = [
  { key: 'artist', label: 'Artist' },
  { key: 'album',  label: 'Album' },
  { key: 'track',  label: 'Track' },
];

/** Default avatar (transparent LFM placeholder) */
const DEFAULT_AVATAR =
  'https://lastfm.freetls.fastly.net/i/u/avatar170s/2a96cbd8b46e442fc41c2b86b821562f.png';

/* ----------------------- time helpers (UTC) ----------------------- */
function startOfThisMonthUTC(d) {
  if (!d) d = new Date();
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 0, 0, 0) / 1000;
}
function startOfThisYearUTC(d) {
  if (!d) d = new Date();
  return Date.UTC(d.getUTCFullYear(), 0, 1, 0, 0, 0) / 1000;
}
function nowUTC() { return Math.floor(Date.now() / 1000); }

function windowFor(key) {
  const end = nowUTC();
  if (key === '7d')         return { start: end - 7  * 86400, end: end };
  if (key === '30d')        return { start: end - 30 * 86400, end: end };
  if (key === '365d')       return { start: end - 365* 86400, end: end };
  if (key === 'this_month') return { start: startOfThisMonthUTC(), end: end };
  if (key === 'this_year')  return { start: startOfThisYearUTC(),  end: end };
  return null; // all time
}
function ymd(ts) {
  const d = new Date(ts * 1000);
  const yyyy = d.getUTCFullYear();
  const mm = (d.getUTCMonth() + 1).toString().padStart(2, '0');
  const dd = d.getUTCDate().toString().padStart(2, '0');
  return yyyy + '-' + mm + '-' + dd;
}

/* ----------------------- API helpers (no ?. ) ----------------------- */
async function getFriends(username) {
  const out = [];
  let page = 1; const limit = 200;
  while (true) {
    const url  = lfUrl('user.getFriends', { user: username, limit: limit, page: page });
    const json = await lfFetchJson(url);
    const friends = json && json.friends ? json.friends : null;
    const arr = friends && friends.user ? friends.user : [];
    for (let i = 0; i < arr.length; i++) {
      const f = arr[i] || {};
      let avatar = '';
      const imgs = f.image || [];
      for (let j = 0; j < imgs.length; j++) {
        if (imgs[j] && imgs[j].size === 'small' && imgs[j]['#text']) {
          avatar = imgs[j]['#text']; break;
        }
      }
      if (!avatar && imgs[0] && imgs[0]['#text']) avatar = imgs[0]['#text'];
      out.push({ name: f.name || '', realname: f.realname || '', avatar: avatar || '' });
    }
    const attr = friends && friends['@attr'] ? friends['@attr'] : {};
    const totalPages = Number(attr.totalPages || 1);
    if (page >= totalPages) break;
    page++;
  }
  return out;
}

/* -------- Artist counts -------- */
async function getArtistUserPlaycount(username, artist) {
  const url  = lfUrl('artist.getInfo', { artist: artist, username: username });
  const json = await lfFetchJson(url);
  const artistObj = json && json.artist ? json.artist : null;
  const stats = artistObj && artistObj.stats ? artistObj.stats : null;
  const upc = stats && stats.userplaycount != null ? Number(stats.userplaycount) : 0;
  return upc;
}
async function getTopArtistPlaycount(username, artist, period) {
  const url  = lfUrl('user.getTopArtists', { user: username, period: period, limit: 1000, page: 1 });
  const json = await lfFetchJson(url);
  const top = json && json.topartists ? json.topartists : null;
  const arr = top && top.artist ? top.artist : [];
  const target = (artist || '').trim().toLowerCase();
  for (let i = 0; i < arr.length; i++) {
    const a = arr[i] || {};
    const name = (a.name || '').trim().toLowerCase();
    if (name === target) return Number(a.playcount || 0);
  }
  return 0;
}

/* -------- Album counts -------- */
async function getAlbumUserPlaycount(username, artist, album) {
  const url  = lfUrl('album.getInfo', { artist: artist, album: album, username: username });
  const json = await lfFetchJson(url);
  const alb = json && json.album ? json.album : null;
  const upc = alb && alb.userplaycount != null ? Number(alb.userplaycount) : 0;
  return upc;
}
async function getTopAlbumPlaycount(username, artist, album, period) {
  const url  = lfUrl('user.getTopAlbums', { user: username, period: period, limit: 1000, page: 1 });
  const json = await lfFetchJson(url);
  const top = json && json.topalbums ? json.topalbums : null;
  const arr = top && top.album ? top.album : [];
  const aName = (artist || '').trim().toLowerCase();
  const alName = (album  || '').trim().toLowerCase();
  for (let i = 0; i < arr.length; i++) {
    const a = arr[i] || {};
    const an = (a.artist && a.artist.name ? a.artist.name : '').trim().toLowerCase();
    const nm = (a.name || '').trim().toLowerCase();
    if (an === aName && nm === alName) return Number(a.playcount || 0);
  }
  return 0;
}

/* -------- Track counts -------- */
async function getTrackUserPlaycount(username, artist, track) {
  const url  = lfUrl('track.getInfo', { artist: artist, track: track, username: username });
  const json = await lfFetchJson(url);
  const trk = json && json.track ? json.track : null;
  const upc = trk && trk.userplaycount != null ? Number(trk.userplaycount) : 0;
  return upc;
}
async function getTopTrackPlaycount(username, artist, track, period) {
  const url  = lfUrl('user.getTopTracks', { user: username, period: period, limit: 1000, page: 1 });
  const json = await lfFetchJson(url);
  const top = json && json.toptracks ? json.toptracks : null;
  const arr = top && top.track ? top.track : [];
  const aName = (artist || '').trim().toLowerCase();
  const tName = (track  || '').trim().toLowerCase();
  for (let i = 0; i < arr.length; i++) {
    const t = arr[i] || {};
    const an = (t.artist && t.artist.name ? t.artist.name : '').trim().toLowerCase();
    const nm = (t.name || '').trim().toLowerCase();
    if (an === aName && nm === tName) return Number(t.playcount || 0);
  }
  return 0;
}

/* -------- Artist calendar (this month/year) via artistTracks (with fallback param styles) -------- */
async function getArtistTracksTotal(username, artist, start, end) {
  function extractTotal(json) {
    const at = json && json.artisttracks ? json.artisttracks : null;
    const attr = at && at['@attr'] ? at['@attr'] : null;
    if (attr && attr.total != null) {
      const t = Number(attr.total);
      if (isFinite(t)) return t;
    }
    const tracks = at && at.track ? at.track : null;
    if (Array.isArray(tracks)) return tracks.length;
    return 0;
  }
  // attempt 1: from/to
  const url1  = lfUrl('user.getArtistTracks', {
    user: username, artist: artist, from: start, to: end, limit: 1, page: 1
  });
  const json1 = await lfFetchJson(url1);
  const t1 = extractTotal(json1);
  if (t1 > 0) return t1;
  // attempt 2: startTimestamp/endTimestamp
  const url2  = lfUrl('user.getArtistTracks', {
    user: username, artist: artist, startTimestamp: start, endTimestamp: end, limit: 1, page: 1
  });
  const json2 = await lfFetchJson(url2);
  return extractTotal(json2);
}

/* -------- Link builders -------- */
function artistLibLink(username, artist, tfKey) {
  const base =
    'https://www.last.fm/user/' +
    encodeURIComponent(username) +
    '/library/music/' +
    encodeURIComponent(artist);
  const win = windowFor(tfKey);
  if (!win) return base; // all-time link (no query)
  const from = ymd(win.start);
  const to   = ymd(win.end);
  return base + '?from=' + encodeURIComponent(from) + '&to=' + encodeURIComponent(to);
}
function albumLibLink(username, artist, album) {
  return (
    'https://www.last.fm/user/' +
    encodeURIComponent(username) + '/library/music/' +
    encodeURIComponent(artist) + '/' + encodeURIComponent(album)
  );
}
function trackLibLink(username, artist, track) {
  return (
    'https://www.last.fm/user/' +
    encodeURIComponent(username) + '/library/music/' +
    encodeURIComponent(artist) + '/' + encodeURIComponent(track)
  );
}

/* -------- tiny concurrency runner -------- */
async function runWithConcurrency(tasks, n) {
  if (!n) n = 4;
  let i = 0;
  const results = new Array(tasks.length);
  async function worker() {
    while (i < tasks.length) {
      const cur = i++;
      try { results[cur] = await tasks[cur](); }
      catch (e) { results[cur] = null; }
    }
  }
  const workers = [];
  const m = Math.min(n, tasks.length);
  for (let k = 0; k < m; k++) workers.push(worker());
  await Promise.all(workers);
  return results;
}

/* ============================== PAGE ============================== */
export default function ScoreboardPage() {
  const [owner, setOwner]   = useState('');
  const [friends, setFriends] = useState([]);
  const [kind, setKind]     = useState('artist'); // artist | album | track

  const [artist, setArtist] = useState('');
  const [album,  setAlbum]  = useState('');
  const [track,  setTrack]  = useState('');

  const [tf, setTf] = useState('all');

  const [loadingFriends, setLoadingFriends] = useState(false);
  const [loadingBoard,  setLoadingBoard]  = useState(false);
  const [rows, setRows] = useState([]);
  const [missing, setMissing] = useState([]);
  const [error, setError] = useState('');

  const crowd = useMemo(function () {
    const names = {};
    const out = [];
    if (owner && owner.trim()) {
      const o = owner.trim();
      names[o] = true; out.push({ name: o, realname: '', avatar: '' });
    }
    for (let i = 0; i < friends.length; i++) {
      const f = friends[i];
      if (f && f.name && !names[f.name]) {
        names[f.name] = true;
        out.push({ name: f.name, realname: f.realname || '', avatar: f.avatar || '' });
      }
    }
    return out;
  }, [owner, friends]);

  async function handleLoadFriends() {
    setError('');
    if (!owner || !owner.trim()) { setError('Enter your Last.fm username.'); return; }
    setLoadingFriends(true);
    try {
      const list = await getFriends(owner.trim());
      setFriends(list);
    } catch (e) {
      setError('Failed to load friends. Check the username and try again.');
    } finally {
      setLoadingFriends(false);
    }
  }

  async function handleBuild() {
    setError('');
    // validate inputs
    if (!owner || !owner.trim()) { setError('Enter your Last.fm username and load friends first.'); return; }
    if (crowd.length === 0) { setError('No users to compare.'); return; }

    if (kind === 'artist' && (!artist || !artist.trim())) {
      setError('Enter an artist name.'); return;
    }
    if (kind === 'album'  && (!artist || !artist.trim() || !album || !album.trim())) {
      setError('Enter both artist and album.'); return;
    }
    if (kind === 'track'  && (!artist || !artist.trim() || !track || !track.trim())) {
      setError('Enter both artist and track.'); return;
    }

    // Album/Track calendar windows disabled (no reliable API)
    if ((tf === 'this_month' || tf === 'this_year') && kind !== 'artist') {
      setError('“This month/year” is only supported for Artists right now. Use All time or 7d/30d/365d for Album/Track.');
      return;
    }

    setLoadingBoard(true);
    try {
      const win = windowFor(tf);
      const A = (artist || '').trim();
      const AL = (album  || '').trim();
      const T  = (track  || '').trim();

      const tasks = crowd.map(function (u) {
        return async function () {
          let count = 0;
          let link  = '';
          try {
            if (kind === 'artist') {
              // Artist logic: all/rolling/calendar
              if (!win) {
                count = await getArtistUserPlaycount(u.name, A);
              } else if (tf === '7d') {
                count = await getTopArtistPlaycount(u.name, A, '7day');
              } else if (tf === '30d') {
                count = await getTopArtistPlaycount(u.name, A, '1month');
              } else if (tf === '365d') {
                count = await getTopArtistPlaycount(u.name, A, '12month');
              } else {
                count = await getArtistTracksTotal(u.name, A, win.start, win.end);
              }
              link = artistLibLink(u.name, A, tf);
            } else if (kind === 'album') {
              if (!win) {
                count = await getAlbumUserPlaycount(u.name, A, AL);
              } else if (tf === '7d') {
                count = await getTopAlbumPlaycount(u.name, A, AL, '7day');
              } else if (tf === '30d') {
                count = await getTopAlbumPlaycount(u.name, A, AL, '1month');
              } else if (tf === '365d') {
                count = await getTopAlbumPlaycount(u.name, A, AL, '12month');
              } else {
                count = 0; // blocked above, but keep safe
              }
              link = albumLibLink(u.name, A, AL);
            } else {
              // track
              if (!win) {
                count = await getTrackUserPlaycount(u.name, A, T);
              } else if (tf === '7d') {
                count = await getTopTrackPlaycount(u.name, A, T, '7day');
              } else if (tf === '30d') {
                count = await getTopTrackPlaycount(u.name, A, T, '1month');
              } else if (tf === '365d') {
                count = await getTopTrackPlaycount(u.name, A, T, '12month');
              } else {
                count = 0; // blocked above, but keep safe
              }
              link = trackLibLink(u.name, A, T);
            }
          } catch (e) {
            count = 0;
          }
          return { name: u.name, avatar: u.avatar, count: count, link: link };
        };
      });

      const results = (await runWithConcurrency(tasks, 4)).filter(Boolean);

      const zero = [];
      const nonZero = [];
      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        if ((r.count || 0) > 0) nonZero.push(r);
        else zero.push(r.name);
      }
      nonZero.sort(function (a, b) { return b.count - a.count; });
      setRows(nonZero);

      const everyone = {};
      for (let i = 0; i < crowd.length; i++) everyone[crowd[i].name] = true;
      const seen = {};
      for (let i = 0; i < results.length; i++) seen[results[i].name] = true;
      for (const name in everyone) if (!seen[name]) zero.push(name);

      const uniq = {};
      for (let i = 0; i < zero.length; i++) uniq[zero[i]] = true;
      const zlist = Object.keys(uniq).sort(function (a, b) { return a.localeCompare(b); });
      setMissing(zlist);
    } catch (e) {
      setError('Something went wrong while building the leaderboard.');
    } finally {
      setLoadingBoard(false);
    }
  }

  return (
    <div className="container">
      <h1>Artist Scoreboard</h1>
      <p className="small"><Link href="/">← Back to Game</Link></p>

      {/* Owner + Load friends */}
      <div className="card" style={{ marginBottom: 12 }}>
        <label>Your Last.fm username</label>
        <input
          type="text"
          placeholder="yourusername"
          value={owner}
          onChange={function (e) { setOwner(e.target.value); }}
        />
        <div style={{ marginTop: 8 }}>
          <button onClick={handleLoadFriends} disabled={loadingFriends}>
            {loadingFriends ? 'Loading friends…' : 'Load Friends'}
          </button>
        </div>
        {friends.length > 0 ? (
          <p className="small" style={{ marginTop: 8 }}>
            Loaded {friends.length} friend{friends.length === 1 ? '' : 's'} (plus you).
          </p>
        ) : null}
      </div>

      {/* Query controls */}
      <div className="card">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr 1fr 1fr', gap: 8 }}>
          <div>
            <label>Type</label>
            <select value={kind} onChange={function (e) { setKind(e.target.value); }}>
              {TYPES.map(function (t) {
                return <option key={t.key} value={t.key}>{t.label}</option>;
              })}
            </select>
          </div>

          <div>
            {kind === 'artist' ? (
              <div>
                <label>Artist</label>
                <input
                  type="text"
                  placeholder="Taylor Swift"
                  value={artist}
                  onChange={function (e) { setArtist(e.target.value); }}
                />
              </div>
            ) : null}

            {kind === 'album' ? (
              <div>
                <label>Album (and Artist)</label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <input
                    type="text"
                    placeholder="Artist e.g., Taylor Swift"
                    value={artist}
                    onChange={function (e) { setArtist(e.target.value); }}
                  />
                  <input
                    type="text"
                    placeholder="Album e.g., 1989 (Taylor’s Version)"
                    value={album}
                    onChange={function (e) { setAlbum(e.target.value); }}
                  />
                </div>
              </div>
            ) : null}

            {kind === 'track' ? (
              <div>
                <label>Track (and Artist)</label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <input
                    type="text"
                    placeholder="Artist e.g., Taylor Swift"
                    value={artist}
                    onChange={function (e) { setArtist(e.target.value); }}
                  />
                  <input
                    type="text"
                    placeholder="Track e.g., Cruel Summer"
                    value={track}
                    onChange={function (e) { setTrack(e.target.value); }}
                  />
                </div>
              </div>
            ) : null}
          </div>

          <div>
            <label>Timeframe</label>
            <select value={tf} onChange={function (e) { setTf(e.target.value); }}>
              {TF.map(function (t) {
                return <option key={t.key} value={t.key}>{t.label}</option>;
              })}
            </select>
          </div>

          <div style={{ display: 'flex', alignItems: 'end' }}>
            <button
              onClick={handleBuild}
              disabled={
                loadingBoard ||
                !owner ||
                (kind === 'artist' && !artist) ||
                (kind === 'album'  && (!artist || !album)) ||
                (kind === 'track'  && (!artist || !track))
              }>
              {loadingBoard ? 'Building…' : 'Build Leaderboard'}
            </button>
          </div>
        </div>

        {/* Error line */}
        {error ? <p style={{ color: '#d71e28', marginTop: 12 }}>{error}</p> : null}

        {/* Leaderboard */}
        {rows.length > 0 ? (
          <div style={{ marginTop: 16 }}>
            <h3>Leaderboard</h3>
            <ol className="leader">
              {rows.map(function (r, idx) {
                const top = rows[0] ? Math.max(1, rows[0].count) : 1;
                const widthPct = Math.max(4, Math.min(100, (r.count / top) * 100));
                const barStyle = { width: widthPct + '%' };

                return (
                  <li key={r.name}>
                    <div className="row">
                      <span className="rank">{idx + 1}</span>

                      <img
                        className="avatar"
                        src={r.avatar || DEFAULT_AVATAR}
                        alt=""
                        onError={function (e) { e.currentTarget.src = DEFAULT_AVATAR; }}
                      />

                      <span className="name">{r.name}</span>

                      <a className="barWrap" href={r.link} target="_blank" rel="noreferrer">
                        <span className="barFill" style={barStyle}>
                          {r.count}
                        </span>
                      </a>
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>
        ) : null}

        {/* Empty state */}
        {rows.length === 0 && !loadingBoard && friends.length > 0 && (artist || album || track) ? (
          <p className="small" style={{ marginTop: 12 }}>
            No scrobbles found for this selection and timeframe.
          </p>
        ) : null}

        {/* Missing list */}
        {missing.length > 0 ? (
          <div style={{ marginTop: 16 }}>
            <h4 className="small" style={{ margin: '8px 0' }}>Friends with zero plays</h4>
            <p className="small">{missing.join(', ')}</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

