# Elgato Calendar Key

A [Stream Deck](https://www.elgato.com/stream-deck) plugin that shows a month calendar on LCD keys. Pick any month of the current year and see the correct day grid (28–31 days) with today highlighted.

Built for Stream Deck + keys using the [Stream Deck SDK](https://docs.elgato.com/sdk) and Node.js.

## Features

- Month calendar rendered on each key (Sun–Sat grid)
- Small month label (e.g. `OCT`, `JUN`)
- Month selectable per key in Stream Deck settings
- Year auto-detected from the system clock
- Today highlighted when viewing the current month
- **Apple Calendar events** (macOS) — press the key to cycle views
- Public holidays overlay (optional country in settings)

## Requirements

- Stream Deck app **7.1+**
- Node.js **24+**
- macOS 12+ or Windows 10+
- **macOS only for live calendar events** (reads Apple Calendar via Calendar.app)

## Connect your Apple Calendar (macOS)

Events come from the same calendars as the macOS **Calendar** app (iCloud / Google / Exchange if subscribed there).

1. Make sure your calendars are visible in the macOS **Calendar** app.
2. Put a **Month Calendar** action on a Stream Deck + LCD key.
3. The first time the plugin reads events, macOS may ask to allow **CalendarFetch** (or **Calendar Keys**) calendar access. Click **Allow**.
4. If you denied it earlier:
   - **System Settings → Privacy & Security → Calendars**
   - Enable **CalendarFetch** / **Calendar Keys** (and Full Access if shown)
5. **Press the key once** to cycle views:
   - **Month** — day grid (orange dots = days with events)
   - **Events** — list of that month’s events (press again to page)
   - **Year** — year overview, then back to month

If the events view says **Allow Calendar access**, grant the permission above and restart the plugin (`npx streamdeck restart com.orionwong.calendar-keys`).

## Development

```bash
npm install
npx streamdeck link com.orionwong.calendar-keys.sdPlugin
npx streamdeck dev
npm run watch
```

Drag **Month Calendar** from the **Calendar Keys** category onto an LCD key in the Stream Deck app.

## Build

```bash
npm run build
npx streamdeck validate com.orionwong.calendar-keys.sdPlugin
npx streamdeck pack com.orionwong.calendar-keys.sdPlugin
```

## License

MIT
