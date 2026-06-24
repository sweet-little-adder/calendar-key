# Elgato Calendar Key

A [Stream Deck](https://www.elgato.com/stream-deck) plugin that shows a month calendar on LCD keys. Pick any month of the current year and see the correct day grid (28–31 days) with today highlighted.

Built for Stream Deck + keys using the [Stream Deck SDK](https://docs.elgato.com/sdk) and Node.js.

## Features

- Month calendar rendered on each key (Sun–Sat grid)
- Small month label (e.g. `OCT`, `JUN`)
- Month selectable per key in Stream Deck settings
- Year auto-detected from the system clock
- Today highlighted in blue when viewing the current month

## Requirements

- Stream Deck app **7.1+**
- Node.js **24+**
- macOS 12+ or Windows 10+

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
