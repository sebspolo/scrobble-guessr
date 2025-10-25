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

// ----- time helpers (UTC) -----
function startOfThisMonthUTC(d = new Date()) {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 0, 0, 0) / 1000;
}
function startOfThisYearUTC(d = new Date()) {
  return Date.UTC(d.getUTCFullYear(), 0, 1, 0, 0, 0) / 1000;
}
function nowUTC() {
  return Math.floor(Date.now() / 1000);
}
function windowFor(key) {
  const end = nowUTC();
  if (key === '7d') return { start: end - 7 * 86400, end };
  if (key === '30d') return { start: end - 30 * 86400, end };
  if (key === '365d') return { start: end - 365 * 86400, end };
  if (key === 'this_month') return { start: startOfThisMonthUTC(), end };
  if (key === 'this_year') return { start: startOfThisYearUTC(), end };
  return null; // all time
}
function ymd(ts) {
  const d = new Date(ts * 1000);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// ----- API helpers we need here -----
async function getFriends(username) {
  const friends = [];
  let page = 1;
  const limit = 200;
  while (true) {
    const url = lfUrl('user.getFriends', { user: username, limit, page });
    const json = await lfFetchJson(url);
    const arr = json?.friends?.user || [];
    for (const f of arr) {
      friends.push({
        name: f?.name,
        realname: f?.realname || '',
        avatar: (f?.image?.find(i => i.size === 'small') || f?.image?.[0] || {})['#text'] || '',
      });
    }
    const totalPages = Number(json?.friends?.['@attr']?.totalPages || 1);
    if (page >= totalPages) break;
    page++;
  }
  return friends;
}

async function getArtistUserPlaycount(username, artist) {
  // All time via artist.getInfo
  const url = lfUrl('artist.getInfo', { artist, username });
  const json = await lfFetchJson(url);
  const upc = Number(json?.artist?.stats?.userplaycount || 0);
  return upc;
}

async function getArtistTracksTotal(username, artist, start, end) {
  // Windowed via user.getArtistTracks; total is in @attr.total
  const url = lfUrl('user.getArtistTracks', {
    user: username,
    artist,
    startTimestamp: start,
    endTimestamp: end,
    limit: 1, // we only need the total count
    page: 1,
  });
  const json = await lfFetchJson(url);
  const total = Number(json?.artisttracks?.['@attr']?.total || 0);
  return total;
}

function vercelKeyMissing() {
  return !process.env.NEXT_PUBLIC_LASTFM_API_KEY;
}

// Build last.fm link for a user's artist library with optional from/to
function artistLibLink(username, artist, tfKey) {
  const base = `https://www.last.fm/user/${encodeURIComponent(username)}/library/music/${encodeURIComponent(artist)}`;
  const win = windowFor(tfKey);
  if (!win) return base; // all time
  const from = ymd(win.start);
  const to = ymd(win.end);
  const url = new URL(base);
  url.searchParams.set('from', from);
  url.searchParams.set('to', to);
  return url.toString();
}

// Small concurrency runner
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
  await Promise.all(new Array(Math.min(n, tasks.length)).fill(0).map(worker));
  return results;
}

export default function ScoreboardPage() {
  const [owner, setOwner] = useState('');
  const [friends, setFriends] = useState([]); // [{name, realname, avatar}]
  const [artist, setArtist] = useState('');
  const [tf, setTf] = useState('all');
  const [loadingFriends, setLoadingFriends] = useState(false);
  const [loadingBoard, setLoadingBoard] = useState(false);
  const [rows, setRows] = useState([]); // [{name, avatar, count, link}]
  const [missing, setMissing] = useState([]); // names with 0 plays
  const [error, setError] = useState('');

  const crowd = useMemo(() => {
    const names = new Set();
    const out = [];
    if (owner.trim()) {
      names.add(owner.trim());
      out.push({ name: owner.trim(), realname: '', avatar: '' });
    }
    for (const f of friends) {
      if (f?.name && !names.has(f.name)) {
        names.add(f.name);
        out.push({ name: f.name, realname: f.realname || '', avatar: f.avatar || '' });
      }
    }
    return out;
  }, [owner, friends]);

  async function handleLoadFriends() {
    setError('');
    if (!owner.trim()) { setError('Enter your Last.fm username.'); return; }
    if (vercelKeyMissing()) { setError('Missing NEXT_PUBLIC_LASTFM_API_KEY in Vercel env.'); return; }
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
    if (!artist.trim()) { setError('Enter an artist name.'); return; }
    if (!owner.trim()) { setError('Enter your Last.fm username and load friends first.'); return; }
    if (crowd.length === 0) { setError('No users to compare.'); return; }

    setLoadingBoard(true);
    try {
      const win = windowFor(tf);
      const tasks = crowd.map(u => async () => {
        let count = 0;
        try {
          if (!win) {
            count = await getArtistUserPlaycount(u.name, artist.trim());
          } else {
            count = await getArtistTracksTotal(u.name, artist.trim(), win.start, win.end);
          }
        } catch (_) {
          count = 0;
        }
        return {
          name: u.name,
          avatar: u.avatar,
          count,
          link: artistLibLink(u.name, artist.trim(), tf),
        };
      });

      const results = (await runWithConcurrency(tasks, 4)).filter(Boolean);
      const zero = results.filter(r => (r.count || 0) === 0).map(r => r.name);
      const nonZero = results.filter(r => (r.count || 0) > 0).sort((a, b) => b.count - a.count);
      setRows(nonZero);
      // friends not listed (zero) includes anyone in crowd with 0
      const everyone = new Set(crowd.map(c => c.name));
      const seen = new Set(results.map(r => r.name));
      // add missing results (e.g., request failed) as zero as well
      for (const name of everyone) if (!seen.has(name)) zero.push(name);
      setMissing([...new Set(zero)].sort((a, b) => a.localeCompare(b)));
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
               onChange={e => setOwner(e.target.value)} />
        <div style={{marginTop:8}}>
          <button onClick={handleLoadFriends} disabled={loadingFriends}>
            {loadingFriends ? 'Loading friends…' : 'Load Friends'}
          </button>
        </div>
        {friends.length > 0 && (
          <p className="small" style={{marginTop:8}}>
            Loaded {friends.length} friend{friends.length===1?'':'s'} (plus you).
          </p>
        )}
      </div>

      <div className="card">
        <div style={{display:'grid', gridTemplateColumns:'2fr 1fr 1fr', gap:8}}>
          <div>
            <label>Artist</label>
            <input type="text" placeholder="Taylor Swift" value={artist}
                   onChange={e => setArtist(e.target.value)} />
          </div>
          <div>
            <label>Timeframe</label>
            <select value={tf} onChange={e => setTf(e.target.value)}>
              {TF.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
            </select>
          </div>
          <div style={{display:'flex', alignItems:'end'}}>
            <button onClick={handleBuild} disabled={loadingBoard || !owner || !artist}>
              {loadingBoard ? 'Building…' : 'Build Leaderboard'}
            </button>
          </div>
        </div>

        {error && <p style={{color:'#d71e28', marginTop:12}}>{error}</p>}

        {rows.length > 0 && (
          <div style={{marginTop:16}}>
            <h3>Leaderboard</h3>
            <ol style={{paddingLeft:18}}>
              {rows.map((r, idx) => (
                <li key={r.name} style={{marginBottom:8}}>
                  <div style={{display:'flex', alignItems:'center', gap:8}}>
                    <span style={{width:18, display:'inline-block'}}>{idx+1}</span>
                    <img src={r.avatar || 'https://lastfm.freetls.fastly.net/i/u/avatar170s/'} alt="" width="24" height="24" style={{borderRadius:999}} />
                    <strong style={{minWidth:140}}>{r.name}</strong>
                    <a href={r.link} target="_blank" rel="noreferrer"
                      style={{flex:1, height:14, background:'#f5d6d6', borderRadius:6, position:'relative', display:'inline-block', textDecoration:'none'}}>
                      <span style={{
                        position:'absolute', left:0, top:0, bottom:0,
                        width: Math.max(4, Math.min(100, (r.count/ (rows[0]?.count || 1)) * 100)) + '%',
                        background:'#d71e28', borderRadius:6
                      }} />
                    </a>
                    <span style={{width:56, textAlign:'right'}}>{r.count}</span>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        )}

        {rows.length === 0 && !loadingBoard && friends.length > 0 && artist && (
          <p className="small" style={{marginTop:12}}>No scrobbles found for this artist and timeframe.</p>
        )}

        {missing.length > 0 && (
          <div style={{marginTop:16}}>
            <h4 className="small" style={{margin:'8px 0'}}>Friends with zero plays</h4>
            <p className="small">{missing.join(', ')}</p>
          </div>
        )}
      </div>
    </div>
  );
}
