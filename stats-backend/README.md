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

- **Events**: one row per word shown, with the time, language, word,
  normal/frenzy, frenzy card, seconds on screen (paused time excluded), how
  it ended, whether it was a quick skip, and a random per-phone id.
  `end` values:
  - `change`: Change Word tapped (guessed or skipped)
  - `timeout`: the Speed Round timer ran out
  - `timesup`: the round ended
  - `quit`: Home was pressed
- **Summary**: per word, sorted by skip rate. A quick skip is a `change`
  under 3 seconds.

Opening the web app URL in a browser returns the same summary as JSON. That's
what a future Hard mode will read.

## Updating the script later

Edit the code, then go to **Deploy → Manage deployments → ✏️ Edit**, set
**Version: New version**, and click **Deploy**. This keeps the same URL. Don't
create a *New deployment*, because that gives you a different URL.

Note: the URL ends up in the public page source, so anyone who digs it out
could post junk rows. That's acceptable for a party game. If it ever happens,
make a new deployment and swap the URL.
