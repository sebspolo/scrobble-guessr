import { useMemo, useState } from 'react';
import Link from 'next/link';
import { lfUrl, lfFetchJson } from '../lib/lastfm';

const TF = [
  { key: 'all', label: 'All time' },
  { key: '7d', label: '7 days (rolling)' },
  { key: '30d', label: '1 month (last 30 days)' },
  { key: '365d', label: '12 months (last 365 days)' },
  { key: 'this_month', label: 'This month (calendar)' },
  { key: 'this_year', label: 'This year (calendar)' },
];

// ---------- time helpers (UTC) ----------
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
  if (key === '7d') return { start: end - 7 * 86400, end: end };
  if (key === '30d') return { start: end - 30 * 86400, end: end };
  if (key === '365d') return { start: end - 365 * 86400, end: end };
  if (key === 'this_month') return { start: startOfThisMonthUTC(), end: end };
  if (key === 'this_year') return { start: startOfThisYearUTC(), end: end };
  return null; // all time
}
function ymd(ts) {
  const d = new Date(ts * 1000);
  const yyyy = d.getUTCFullYear();
  const mm = (d.getUTCMonth() + 1).toString().padStart(2, '0');
  const dd = d.getUTCDate().toString().padStart(2, '0');
  return yyyy + '-' + mm + '-' + dd;
}

// ---------- API helpers (no optional chaining) ----------
async function getFriends(username) {
  const out = [];
  let page = 1; const limit = 200;
  while (true) {
    const url = lfUrl('user.getFriends', { user: username, limit: limit, page: page });
    const json = await lfFetchJson(url);
    const friends = json && json.friends ? json.friends : null;
    const arr = friends && friends.user ? friends.user : [];
    for (let i = 0; i < arr.length; i++) {
      const f = arr[i] || {};
      let avatar = '';
      const imgs = f.image || [];
      for (let j = 0; j < imgs.length; j++) {
        if (imgs[j] && imgs[j].size === 'small' && imgs[j]['#text']) {
          avatar = imgs[j]['#text'];
          break;
        }
      }
      if (!avatar && imgs[0] && imgs[0]['#text']) avatar = imgs[0]['#text'];
      out.push({
        name: f.name || '',
        realname: f.realname || '',
        avatar: avatar || ''
      });
    }
    const attr = friends && friends['@attr'] ? friends['@attr'] : {};
    const totalPages = Number(attr.totalPages || 1);
    if (page >= totalPages) break;
    page++;
  }
  return out;
}

// All-time count for user+artist via artist.getInfo
async function getArtistUserPlaycount(username, artist) {
  const url = lfUrl('artist.getInfo', { artist: artist, username: username });
  const json = await lfFetchJson(url);
  const artistObj = json && json.artist ? json.artist : null;
  const stats = artistObj && artistObj.stats ? artistObj.stats : null;
  const upc = stats && stats.userplaycount != null ? Number(stats.userplaycount) : 0;
  return upc;
}

// Windowed count via user.getArtistTracks, using from/to
async function getArtistTracksTotal(username, artist, start, end) {
  const url = lfUrl('user.getArtistTracks', {
    user: username,
    artist: artist,
    from: start,   // UNIX seconds (UTC)
    to: end,       //   "
    limit: 1,
    page: 1
  });
  const json = await lfFetchJson(url);

  let total = NaN;
  const at = json && json.artisttracks ? json.artisttracks : null;
  const attr = at && at['@attr'] ? at['@attr'] : null;
  if (attr && attr.total != null) total = Number(attr.total);

  if (!isFinite(total)) {
    const tracks = at && at.track ? at.track : null;
    if (Array.isArray(tracks)) total = tracks.length;
    else total = 0;
  }
  return total;
}

// Build last.fm link (avoid URL constructor)
function artistLibLink(username, artist, tfKey) {
  const base =
    'https://www.last.fm/user/' +
    encodeURIComponent(username) +
    '/library/music/' +
    encodeURIComponent(artist);
  const win = windowFor(tfKey);
  if (!win) return base; // all time
  const from = ymd(win.start);
  const to = ymd(win.end);
  return base + '?from=' + encodeURIComponent(from) + '&to=' + encodeURIComponent(to);
}

// Concurrency runner
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

// ---------- page ----------
export default function ScoreboardPage() {
  const [owner, setOwner] = useState('');
  const [friends, setFriends] = useState([]);
  const [artist, setArtist] = useState('');
  const [tf, setTf] = useState('all');
  const [loadingFriends, setLoadingFriends] = useState(false);
  const [loadingBoard, setLoadingBoard] = useState(false);
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
    if (!artist || !artist.trim()) { setError('Enter an artist name.'); return; }
    if (!owner || !owner.trim()) { setError('Enter your Last.fm username and load friends first.'); return; }
    if (crowd.length === 0) { setError('No users to compare.'); return; }

    setLoadingBoard(true);
    try {
      const win = windowFor(tf);
      const tasks = crowd.map(function (u) {
        return async function () {
          let count = 0;
          try {
            if (win) count = await getArtistTracksTotal(u.name, artist.trim(), win.start, win.end);
            else count = await getArtistUserPlaycount(u.name, artist.trim());
          } catch (e) {
            count = 0;
          }
          return { name: u.name, avatar: u.avatar, count: count, link: artistLibLink(u.name, artist.trim(), tf) };
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

      // anyone missing => treat as zero
      const everyone = {};
      for (let i = 0; i < crowd.length; i++) everyone[crowd[i].name] = true;
      const seen = {};
      for (let i = 0; i < results.length; i++) seen[results[i].name] = true;
      for (const name in everyone) if (!seen[name]) zero.push(name);

      // unique + sorted
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

      <div className="card" style={{marginBottom:12}}>
        <label>Your Last.fm username</label>
        <input type="text" placeholder="yourusername" value={owner}
               onChange={function (e) { setOwner(e.target.value); }} />
        <div style={{marginTop:8}}>
          <button onClick={handleLoadFriends} disabled={loadingFriends}>
            {loadingFriends ? 'Loading friends…' : 'Load Friends'}
          </button>
        </div>
        {friends.length > 0 ? (
          <p className="small" style={{marginTop:8}}>
            Loaded {friends.length} friend{friends.length===1?'':'s'} (plus you).
          </p>
        ) : null}
      </div>

      <div className="card">
        <div style={{display:'grid', gridTemplateColumns:'2fr 1fr 1fr', gap:8}}>
          <div>
            <label>Artist</label>
            <input type="text" placeholder="Taylor Swift" value={artist}
                   onChange={function (e) { setArtist(e.target.value); }} />
          </div>
          <div>
            <label>Timeframe</label>
            <select value={tf} onChange={function (e) { setTf(e.target.value); }}>
              {TF.map(function (t) { return <option key={t.key} value={t.key}>{t.label}</option>; })}
            </select>
          </div>
          <div style={{display:'flex', alignItems:'end'}}>
            <button onClick={handleBuild} disabled={loadingBoard || !owner || !artist}>
              {loadingBoard ? 'Building…' : 'Build Leaderboard'}
            </button>
          </div>
        </div>

        {error ? <p style={{color:'#d71e28', marginTop:12}}>{error}</p> : null}

        {rows.length > 0 ? (
          <div style={{marginTop:16}}>
            <h3>Leaderboard</h3>
            <ol style={{paddingLeft:18}}>
              {rows.map(function (r, idx) {
                const widthPct = Math.max(4, Math.min(100, (r.count / (rows[0] ? rows[0].count : 1)) * 100));
                return (
                  <li key={r.name} style={{marginBottom:8}}>
                    <div style={{display:'flex', alignItems:'center', gap:8}}>
                      <span style={{width:18, display:'inline-block'}}>{idx+1}</span>
                      <img src={r.avatar || 'https://lastfm.freetls.fastly.net/i/u/avatar170s/'} alt="" width="24" height="24" style={{borderRadius:999}} />
                      <strong style={{minWidth:140}}>{r.name}</strong>
                      <a href={r.link} target="_blank" rel="noreferrer"
                        style={{flex:1, height:14, background:'#f5d6d6', borderRadius:6, position:'relative', display:'inline-block', textDecoration:'none'}}>
                        <span style={{position:'absolute', left:0, top:0, bottom:0, width: widthPct + '%', background:'#d71e28', borderRadius:6}} />
                      </a>
                      <span style={{width:56, textAlign:'right'}}>{r.count}</span>
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>
        ) : null}

        {rows.length === 0 && !loadingBoard && friends.length > 0 && artist ? (
          <p className="small" style={{marginTop:12}}>No scrobbles found for this artist and timeframe.</p>
        ) : null}

        {missing.length > 0 ? (
          <div style={{marginTop:16}}>
            <h4 className="small" style={{margin:'8px 0'}}>Friends with zero plays</h4>
            <p className="small">{missing.join(', ')}</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
