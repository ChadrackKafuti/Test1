# CAFI Climate Week Planner 2026

A mobile-first, single-page planner for the CAFI delegation at Climate Week and UNGA in New York, 21–25 September 2026. It turns the Secretariat's logistics note into a browsable agenda with a personal schedule, practical information and contacts.

## Features

- **Agenda** – day tabs for Monday 21 to Friday 25 September, with every session, meeting, lunch, reception and logistics item from the logistics note. Each card shows time, duration, venue, address, Google Maps link, organiser contact and the CAFI participants.
- **Filters** – filter by CAFI participant or by event type, view one day or the whole week, and full-text search across the programme.
- **Travel timeline** – with a participant selected (or in My plan), consecutive events are joined by travel connectors: New York area to area, suggested transport, estimated minutes, a leave-by time and the remaining buffer, colour-coded as comfortable, tight, leave early or overlap. Stat tiles count the transitions and conflicts, and each card can show travel from every earlier event that day. Times are estimates; always verify on Google Maps.
- **My plan** – star events to build a personal schedule, saved in the browser. Export it as an `.ics` calendar file or print it.
- **Info** – ground pass, MPTFO office, agenda folder, electricity, communication, weather, emergency numbers and JFK airport.
- **Contacts** – tap-to-call and WhatsApp links for the logistics contacts, plus a per-person event count for the delegation.
- "Now" and "Soon" badges appear on the current day, using New York time. Light and dark themes follow the device setting. The app can be added to a phone home screen.

## Running it

There is no build step. Open `index.html` directly, or serve the folder with any static server:

```
python3 -m http.server 8000
```

Then open <http://localhost:8000>. The site can be deployed as-is to any static host (Surge, GitHub Pages, Netlify).

## Updating the programme

All content lives in `js/data.js`:

- `sessions` – one object per event (`date`, `start`, `end`, `title`, `type`, `area`, `venue`, `address`, `map`, `contact`, `participants`).
- `areas` and `travel` – the New York areas and the door-to-door minutes and transport mode between each pair. Use `"all"` for the whole delegation, or a list of participant ids. Set `tbc: true` when the venue is not yet confirmed.
- `participants`, `info` and `contacts` – the delegation, the practical information cards and the contact list.

## Structure

```
index.html            page shell and icon sprite
css/styles.css        styles (light/dark, mobile/desktop, print)
js/data.js            programme and logistics data
js/app.js             rendering, filters, plan storage, .ics export
assets/               CAFI logo and app icon (SVG)
manifest.webmanifest  web app manifest
```

## Deployment

**Surge** – <https://cafi-climate-week-2026.surge.sh>. Every push to `main` (or the current feature branch) deploys through `.github/workflows/surge.yml`. It needs repository secrets under Settings > Secrets and variables > Actions: either `SURGE_TOKEN` (from `npx surge token` on your machine) or the `SURGE_LOGIN` and `SURGE_PASSWORD` of your Surge account. To deploy by hand instead:

```
npx surge ./ cafi-climate-week-2026.surge.sh
```

**GitHub Pages** – <https://chadrackkafuti.github.io/Test1/>, through `.github/workflows/pages.yml`, once Pages is enabled with "GitHub Actions" as the source in Settings > Pages.
