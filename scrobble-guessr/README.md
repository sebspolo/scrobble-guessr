# Scrobble Guessr (Barebones)

A minimal Last.fm party quiz. Enter up to 10 usernames, the app fetches **Top 10** tracks, albums, and artists for **7day, 1month, 12month, overall**, then generates questions of the form:

**Which user had X scrobbles on Y in Z timeframe?**

- **No storage**: everything is computed per request and kept in memory in the browser.
- **No animations**: simple, reliable UI.
- **Client-only requests to Last.fm**: uses a _public_ API key (`NEXT_PUBLIC_LASTFM_API_KEY`). The Shared Secret is **not used** for read-only endpoints.

## One-time setup

1. Create a free Vercel account.
2. Create a new project → **Drag & Drop** this folder.
3. Go to **Project → Settings → Environment Variables** and add:
   - `NEXT_PUBLIC_LASTFM_API_KEY` = your Last.fm API key
4. Deploy.

> Note: Because requests are made from the browser, your API key will be visible to clients. This is common for Last.fm read-only use, but you can rotate keys any time in your Last.fm account.

## Local dev (optional)

```bash
cp .env.example .env.local
# edit .env.local to insert your API key
npm install
npm run dev
```

Open http://localhost:3000

## How it works

- For each username and each timeframe, the app calls:
  - `user.getTopTracks?limit=10`
  - `user.getTopAlbums?limit=10`
  - `user.getTopArtists?limit=10`
- After **all** fetches succeed (or skip failed ones), it builds in-memory lists:
  - `track → playcount`, `album → playcount`, `artist → playcount`
- It then generates 10 random questions: choose **user → category → timeframe → item**.

## Notes / Future improvements

- If you want to **hide your API key** and avoid CORS/rate-limit surprises, we can move calls to an API route and implement batching/queueing (with careful timeouts on Vercel).
- Add tie-handling (accept multiple correct users if scrobble counts tie).
- Add per-username validation and clearer errors for private or invalid profiles.
