# Scrobble Guessr

Enter **1–10** Last.fm usernames (comma-separated or one-per-line). The app fetches **Top 10** tracks, albums, and artists for **7day, 1month, 12month, overall**, then asks:

**Which user had X scrobbles on Y in Z timeframe?**

- No storage, no animations.
- Uses a public Last.fm key via `NEXT_PUBLIC_LASTFM_API_KEY`.

## Deploy (Vercel)
1) Connect the repo to Vercel and deploy.
2) In Project → Settings → Environment Variables, add:
   - `NEXT_PUBLIC_LASTFM_API_KEY` = your Last.fm API key
3) Redeploy and visit your URL.
