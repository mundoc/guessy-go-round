# Word stats → Google Sheet

The game records how long each word stays on screen and sends those events to a
Google Sheet, so stats from every phone end up in one place. Phones that are
offline keep their events and send them later.

## One-time setup (about 5 minutes)

1. Create a new Google Sheet, e.g. "Guessy-Go-Round stats".
2. In the sheet: **Extensions → Apps Script**. Delete the sample code, paste in
   everything from [`Code.gs`](Code.gs), and click **Save**.
3. Click **Deploy → New deployment**. Under "Select type" (gear icon) choose
   **Web app**, then set:
   - **Execute as:** Me
   - **Who has access:** Anyone
4. Click **Deploy** and **Authorize access**. Google warns that the app isn't
   verified because it's your own script: click **Advanced → Go to … (unsafe)**,
   then **Allow**.
5. Copy the **Web app URL** (it ends in `/exec`) and set it as `STATS_URL` in
   `index.html`.

The **Events** and **Summary** tabs appear on their own once the first round's
data arrives.

## What's in the sheet

A **user** is a phone: a random id the game keeps on the device. It's not a
person, because one phone gets passed around a whole group. Clearing the
browser data makes the phone count as a new user. A **session** is one sitting
with the app. It continues while words keep being played, and a new one starts
after 30+ minutes without activity. Opening the app without playing a word
doesn't count as a session.

- **Summary**: users, sessions, sessions per user, users active in the last
  7 and 30 days, how many users came back 1, 2, 3–5 or 6+ times, and users,
  sessions and sessions per user by country.
- **Words**: per word, sorted by skip rate. A quick skip is a `change` under
  3 seconds.
- **Players**: one row per phone, with its country, sessions, words shown,
  and first and last seen.
- **Events**: one row per word shown, with the time, language, word,
  normal/frenzy, frenzy card, seconds on screen (paused time excluded), how
  it ended, whether it was a quick skip, the phone id, the session id, the
  country and the time zone. `end` values:
  - `change`: Change Word tapped (guessed or skipped)
  - `timeout`: the Speed Round timer ran out
  - `timesup`: the round ended
  - `quit`: Home was pressed

The country comes from the game's Netlify edge function
(`netlify/edge-functions/geo.js`), which returns only the 2-letter code Netlify
derives from the request. IP addresses aren't stored anywhere. When the country
is unavailable it shows as `?`, and the time zone column usually still gives a
good idea of where the phone is.

Opening the web app URL in a browser returns the same summary as JSON. That's
what a future Hard mode will read.

## Updating the script later

Edit the code, then go to **Deploy → Manage deployments → ✏️ Edit**, set
**Version: New version**, and click **Deploy**. This keeps the same URL. Don't
create a *New deployment*, because that gives you a different URL.

Note: the URL ends up in the public page source, so anyone who digs it out
could post junk rows. That's acceptable for a party game. If it ever happens,
make a new deployment and swap the URL.
