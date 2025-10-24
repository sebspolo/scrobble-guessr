import { useState, useMemo } from 'react';
import { getTop, normalize } from '../lib/lastfm';

const TIMEFRAMES = ['7day', '1month', '12month', 'overall'];
const KINDS = ['tracks', 'albums', 'artists']; // maps to track/album/artist

function parseUsernames(input) {
  return input
    .split(/\n|,|;/)
    .map(s => s.trim())
    .filter(Boolean)
    .slice(0, 10);
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
  const [data, setData] = useState(null); // aggregated results
  const [questions, setQuestions] = useState([]);
  const [qIndex, setQIndex] = useState(0);
  const [score, setScore] = useState(0);
  const [lastAnswer, setLastAnswer] = useState(null);

  const usernames = useMemo(() => parseUsernames(userInput), [userInput]);

  async function handleFetchAll(e) {
    e.preventDefault();
    setError('');
    if (usernames.length === 0) {
      setError('Enter at least one Last.fm username.');
      return;
    }
    const apiKey = process.env.NEXT_PUBLIC_LASTFM_API_KEY;
    if (!apiKey) {
      setError('Missing NEXT_PUBLIC_LASTFM_API_KEY. Add it in Vercel project settings.');
      return;
    }

    setStatus('loading');

    try {
      // For each user and timeframe, fetch tracks/albums/artists top 10
      const results = {};
      for (const user of usernames) {
        results[user] = {};
        for (const tf of TIMEFRAMES) {
          results[user][tf] = { track: [], album: [], artist: [] };
        }
      }

      // We'll do limited concurrency: 4 at a time
      const tasks = [];
      for (const user of usernames) {
        for (const tf of TIMEFRAMES) {
          for (const kind of KINDS) {
            tasks.push(async () => {
              const json = await getTop(user, kind, tf, 10);
              const items = normalize(kind, json);
              const type = (kind === 'tracks' ? 'track' : (kind === 'albums' ? 'album' : 'artist'));
              results[user][tf][type] = items;
            });
          }
        }
      }

      const CONCURRENCY = 4;
      async function runPool() {
        let idx = 0;
        const workers = new Array(CONCURRENCY).fill(0).map(async () => {
          while (idx < tasks.length) {
            const cur = idx++;
            try { await tasks[cur](); } catch (e) {
              // Keep going; skip failed user or timeframe
              console.error('Fetch failed:', e);
            }
          }
        });
        await Promise.all(workers);
      }
      await runPool();

      setData(results);
      setStatus('ready');
    } catch (e) {
      console.error(e);
      setError('Something went wrong while fetching. Try fewer users or try again.');
      setStatus('idle');
    }
  }

  function startGame() {
    if (!data) return;
    const qs = [];
    const MAX_Q = 10;

    // Generate MAX_Q random questions following: user -> category -> timeframe -> item
    for (let i = 0; i < MAX_Q; i++) {
      const user = usernames[Math.floor(Math.random() * usernames.length)];
      const category = ['track', 'album', 'artist'][Math.floor(Math.random() * 3)];
      const tf = TIMEFRAMES[Math.floor(Math.random() * TIMEFRAMES.length)];
      const pool = data[user][tf][category];
      if (!pool || pool.length === 0) { i--; continue; } // regenerate if empty

      const item = pool[Math.floor(Math.random() * pool.length)];
      const X = item.playcount;
      const Y = item; // holds name/artist/type
      const Z = tf;

      // Build choices (all usernames); optionally shuffle
      const choices = [...usernames];
      for (let s = choices.length - 1; s > 0; s--) {
        const r = Math.floor(Math.random() * (s + 1));
        [choices[s], choices[r]] = [choices[r], choices[s]];
      }

      qs.push({
        user, category, timeframe: Z, item: Y, scrobbles: X, choices
      });
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
      <p className="small">A barebones Last.fm party quiz. No storage. Top 10 per timeframe.</p>

      {status === 'idle' && (
        <div className="card">
          <form onSubmit={handleFetchAll}>
            <label>Last.fm usernames (comma or new line, up to 10)</label>
            <textarea
              rows={6}
              placeholder="alice
bob
charlie"
              value={userInput}
              onChange={e => setUserInput(e.target.value)}
            />
            <p className="small">Timeframes fetched: 7day, 1month, 12month, overall • Categories: track, album, artist</p>
            <button type="submit">Fetch Data</button>
          </form>
          {error && <p style={{color:'#d71e28', marginTop: 12}}>{error}</p>}
        </div>
      )}

      {status === 'loading' && (
        <div className="card">
          <h2>Loading data…</h2>
          <p className="small">Fetching Top 10 tracks, albums, and artists for each user and timeframe. This can take a moment.</p>
        </div>
      )}

      {status === 'ready' && (
        <div className="card">
          <h2>Data ready</h2>
          <p className="small">Start the game. Questions are generated from fetched data.</p>
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
                {questions[qIndex].choices.map((c) => (
                  <button key={c} onClick={() => answer(c)} disabled={!!lastAnswer}>{c}</button>
                ))}
              </div>
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
        </div>
      )}
    </div>
  );
}
