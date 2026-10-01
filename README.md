# Squirrel Field Guide

A playful map explorer for the [2018 Central Park Squirrel Census](https://data.cityofnewyork.us/Environment/2018-Central-Park-Squirrel-Census-Squirrel-Data/vfnx-vebw/about_data).

[Open the live field guide](https://szweibel.github.io/squirrel-field-guide/).

The page loads every public sighting record directly from NYC Open Data, in deterministic pages of 5,000 records. It maps the observations, combines fur color, activity, and human reaction filters, and keeps every source row—including repeated source IDs and sightings without a recorded fur color.

## Run locally

```sh
bun server.js
```

Then open <http://localhost:3000>. The app is plain HTML, CSS, and browser JavaScript. Leaflet 1.9.4 and OpenStreetMap tiles are loaded from their public CDNs; there is no build step or API key.

## Publishing

GitHub Pages serves the root of the `main` branch. Push changes to `main` to update the live site. The `.nojekyll` file tells Pages to serve the static files directly.

## Data notes

This is a historical snapshot collected over 11 census days from October 6–20, 2018. Its 3,023 rows are sighting records, not necessarily 3,023 individual squirrels. Five rows repeat a source observation ID; the explorer retains all source records and uses a separate internal row key. Missing traits remain visible as “not recorded.”
