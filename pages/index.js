
import { useState, useMemo, useEffect } from 'react';
import { getTop, normalize } from '../lib/lastfm';

const TIMEFRAMES = ['7day', '1month', '12month', 'overall'];
const CATEGORY_KEYS = ['track', 'album', 'artist'];
const KINDS = ['tracks', 'albums', 'artists']; // fetch helpers

function parseUsernames(input) {
  const arr = input.split(/\n|,|;/).map(s => s.trim()).filter(Boolean);
  const seen = new Set();
  const out = [];
  for (const name of arr) {
    const key = name.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(name);
      if (out.length >= 10) break;
    }
  }
  return out;
}

function displayItemLabel(item) {
  if (item.type === 'track') return `${item.name} — ${item.artist}`;
  if (item.type === 'album') return `${item.name} — ${item.artist}`;
  return item.name; // artist
}

export default function Home() {
  const [userInput, setUserInput] = useState('');
  const [status, setStatus] = useState('idle'); // idle | loading | ready | playing | done
  const [error, setError] = useState('');
  const [data, setData] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [qIndex, setQIndex] = useState(0);
  const [score, setScore] = useState(0);
  const [lastAnswer, setLastAnswer] = useState(null);

  // Filters (all checked by default)
  const [tfChecked, setTfChecked] = useState({ '7day': true, '1month': true, '12month': true, 'overall': true });
  const [catChecked, setCatChecked] = useState({ 'track': true, 'album': true, 'artist': true });

  const usernames = useMemo(() => parseUsernames(userInput), [userInput]);

  // Hotkeys
  useEffect(() => {
    function onKey(e) {
      if (e.repeat) return;
      const key = e.key;
      if (key === 'Enter') {
        if (status === 'playing' && lastAnswer) {
          nextQ();
        } else if (status === 'done') {
          reset();
        } else if (status === 'ready') {
          startGame();
        }
        return;
      }
      if (status === 'playing' && !lastAnswer) {
        let idx = -1;
        if (key >= '1' && key <= '9') idx = parseInt(key, 10) - 1;
        else if (key === '0') idx = 9;
        if (idx >= 0 && questions[qIndex] && idx < questions[qIndex].choices.length) {
          answer(questions[qIndex].choices[idx]);
        }
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [status, lastAnswer, qIndex, questions]);

  async function handleFetchAll(e) {
    e.preventDefault();
    setError('');
    if (usernames.length === 0) {
      setError('Enter at least one public Last.fm username.');
      return;
    }
    const apiKey = process.env.NEXT_PUBLIC_LASTFM_API_KEY;
    if (!apiKey) {
      setError('Missing NEXT_PUBLIC_LASTFM_API_KEY. Add it in Vercel project settings.');
      return;
    }

    setStatus('loading');

    try {
      const results = {};
      for (const user of usernames) {
        results[user] = {};
        for (const tf of TIMEFRAMES) {
          results[user][tf] = { track: [], album: [], artist: [] };
        }
      }

      const tasks = [];
      for (const user of usernames) {
        for (const tf of TIMEFRAMES) {
          for (const kind of KINDS) {
            tasks.push(async () => {
              try {
                const json = await getTop(user, kind, tf, 10);
                const items = normalize(kind, json);
                const type = (kind === 'tracks' ? 'track' : (kind === 'albums' ? 'album' : 'artist'));
                results[user][tf][type] = items;
              } catch (err) {
                console.warn('Skip failed slice:', user, tf, kind, err?.message || err);
              }
            });
          }
        }
      }

      const CONCURRENCY = 4;
      let idx = 0;
      async function worker() {
        while (idx < tasks.length) {
          const cur = idx++;
          await tasks[cur]();
        }
      }
      await Promise.all(new Array(CONCURRENCY).fill(0).map(worker));

      setData(results);
      setStatus('ready');
    } catch (e) {
      console.error(e);
      setError('Something went wrong while fetching. Try a single known-good username first.');
      setStatus('idle');
    }
  }

  function startGame() {
    if (!data) return;
    const activeTFs = TIMEFRAMES.filter(tf => tfChecked[tf]);
    const activeCats = CATEGORY_KEYS.filter(k => catChecked[k]);
    if (activeTFs.length === 0) { alert('Select at least one timeframe.'); return; }
    if (activeCats.length === 0) { alert('Select at least one media type.'); return; }

    const qs = [];
    const MAX_Q = 10;

    const combos = [];
    for (const user of usernames) {
      for (const tf of activeTFs) {
        for (const category of activeCats) {
          const pool = data[user]?.[tf]?.[category] || [];
          if (pool.length > 0) combos.push({ user, tf, category });
        }
      }
    }
    if (combos.length === 0) {
      alert('No data available for the selected filters. Try enabling more timeframes/types.');
      return;
    }

    for (let i = 0; i < MAX_Q; i++) {
      const pick = combos[Math.floor(Math.random() * combos.length)];
      const pool = data[pick.user][pick.tf][pick.category];
      const item = pool[Math.floor(Math.random() * pool.length)];
      const X = item.playcount;
      const Y = item;
      const Z = pick.tf;

      const choices = [...usernames]; // keep original order, no shuffle
      }

      qs.push({ user: pick.user, category: pick.category, timeframe: Z, item: Y, scrobbles: X, choices });
    }

    setQuestions(qs);
    setQIndex(0);
    setScore(0);
    setLastAnswer(null);
    setStatus('playing');
  }

  function answer(choice) {
    const q = questions[qIndex];
    const correct = choice === q.user;
    setLastAnswer({ correct, correctUser: q.user });
    if (correct) setScore(s => s + 1);
  }

  function nextQ() {
    if (qIndex + 1 >= questions.length) {
      setStatus('done');
      return;
    }
    setQIndex(qIndex + 1);
    setLastAnswer(null);
  }

  function reset() {
    setStatus('ready');
    setQuestions([]);
    setQIndex(0);
    setScore(0);
    setLastAnswer(null);
  }

  return (
    <div className="container">
      <h1>Scrobble Guessr</h1>
      <p className="small">Enter <strong>1–10</strong> usernames (comma-separated or one-per-line). Duplicates are ignored.</p>

      {status === 'idle' && (
        <div className="card">
          <form onSubmit={handleFetchAll}>
            <label>Usernames</label>
            <textarea rows={6} placeholder={"alice\nbob\ncharlie"} value={userInput} onChange={e => setUserInput(e.target.value)} />
            <p className="small">Will fetch Top 10 tracks, albums, artists for: 7day, 1month, 12month, overall.</p>
            <button type="submit">Fetch Data</button>
          </form>
          {error && <p style={{color:'#d71e28', marginTop: 12}}>{error}</p>}
        </div>
      )}

      {status === 'loading' && (
        <div className="card">
          <h2>Loading data…</h2>
          <p className="small">This may take a moment depending on how many users you entered.</p>
        </div>
      )}

      {status === 'ready' && (
        <div className="card">
          <h2>Data ready</h2>
          <p className="small">Choose timeframes and media types to include, then press <strong>Start Game</strong>. (Enter key also starts.)</p>

          <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:16, margin:'12px 0'}}>
            <div>
              <h3 style={{margin:'4px 0'}}>Timeframes</h3>
              {TIMEFRAMES.map(tf => (
                <label key={tf} style={{fontWeight:'normal', display:'flex', alignItems:'center', gap:8}}>
                  <input type="checkbox" checked={!!tfChecked[tf]} onChange={() => setTfChecked(prev => ({...prev, [tf]: !prev[tf]}))} />
                  {tf}
                </label>
              ))}
            </div>
            <div>
              <h3 style={{margin:'4px 0'}}>Media types</h3>
              {CATEGORY_KEYS.map(cat => (
                <label key={cat} style={{fontWeight:'normal', display:'flex', alignItems:'center', gap:8}}>
                  <input type="checkbox" checked={!!(catChecked[cat])} onChange={() => setCatChecked(prev => ({...prev, [cat]: !prev[cat]}))} />
                  {cat}
                </label>
              ))}
            </div>
          </div>

          <button onClick={startGame}>Start Game</button>
          <button className="ghost" style={{marginLeft:8}} onClick={() => setStatus('idle')}>Refetch</button>
        </div>
      )}

      {status === 'playing' && (
        <div className="card">
          <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
            <div>Question {qIndex+1} / {questions.length}</div>
            <div>Score: {score}</div>
          </div>
          <hr />
          {questions[qIndex] && (
            <div>
              <p>
                <strong>Which user had {questions[qIndex].scrobbles} scrobbles on</strong><br />
                <span className="badge">{questions[qIndex].category}</span>{" "}
                <em>{displayItemLabel(questions[qIndex].item)}</em>{" "}
                <strong>in {questions[qIndex].timeframe}?</strong>
              </p>
              <div style={{display:'flex', gap:8, flexWrap:'wrap'}}>
                {questions[qIndex].choices.map((c, i) => (
                  <button key={c} onClick={() => answer(c)} disabled={!!lastAnswer}>
                    {i < 9 ? (i+1) : 0}. {c}
                  </button>
                ))}
              </div>
              <p className="small" style={{marginTop:8}}>Hotkeys: 1–9 (and 0 for 10th) to guess • Enter to continue</p>
              {lastAnswer && (
                <div style={{marginTop:12}}>
                  {lastAnswer.correct ? (
                    <div>✅ Correct!</div>
                  ) : (
                    <div>❌ Wrong. Correct answer: <strong>{lastAnswer.correctUser}</strong></div>
                  )}
                  <button style={{marginTop:8}} onClick={nextQ}>Next</button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {status === 'done' && (
        <div className="card">
          <h2>Results</h2>
          <p>You scored <strong>{score}</strong> / {questions.length}</p>
          <button onClick={reset}>Play Again</button>
          <p className="small" style={{marginTop:8}}>Tip: Press Enter to return to Start Game, then Enter again to start.</p>
        </div>
      )}
    </div>
  );
}
