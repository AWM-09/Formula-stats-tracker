# Formula Stats Tracker

A multi-series motorsport statistics platform inspired by the AWM-09 NFL Stats Tracker.

## Coverage
- **Formula 1:** 1950 onwards.
- **Modern FIA Formula 2:** 2017 onwards. GP2 (2005–2016) is a separate predecessor series.
- **Modern FIA Formula 3:** 2019 onwards. GP3 (2010–2018) is a separate predecessor series.

## First release
- F1 season selector and historical archive.
- Driver and constructor standings.
- Searchable race results.
- Driver versus driver season comparison.
- Season-level wins, podiums and fastest-lap summaries.
- Data-source and coverage notes.
- Responsive dark motorsport interface.

F2/F3 are visible as planned integrations until verified historical datasets are connected. Their results will not be fabricated or replaced with F1 data.

## Deployment
1. Open repository Settings → Pages.
2. Set the build and deployment source to GitHub Actions.
3. Push to main or run the Update and deploy workflow.
4. Open the published Pages URL shown in the deployment.

## Local development
This is a static HTML/CSS/JavaScript project with Node.js data scripts. Serve the repository root with any static file server.

See DATA_SOURCES.md for source provenance, methodology and coverage.
Independent project; not affiliated with Formula One, FIA, Formula 2, Formula 3 or any promoter.


## Data refresh
Run **Actions → Update Formula Stats and deploy → Run workflow** to import missing F2/F3 seasons and publish the latest dashboard.

## F2 and F3 data coverage
- F2 (2017–2023): race classifications from the Alarchemn Formula 2 dataset; final standings from FIA archives.
- F2 (2024 onwards): FIA standings archives; full timed session data is not provided by the standings tables.
- F3 (2019 onwards): FIA standings archives plus per-season race summary sources for winners, poles and fastest laps. Some years do not publish complete finishing orders in the FIA standings archive, so podium statistics are deliberately left unavailable.
- GP2 and GP3 are not silently combined with modern F2/F3.


## F2 and F3 data coverage
- F2 (2017–2023): race classifications from the Alarchemn F2 historical archive; final points and season positions from FIA pages.
- F2 (2024 onwards): FIA standings archives; these provide per-session finishing places where published, but not full timing sheets.
- F3 (2019 onwards): FIA season standings plus per-season race summary sources for winners, poles and fastest laps. Some early years do not publish full finishing orders in the FIA standings archive, so podiums are left unavailable.
- GP2 and GP3 are not silently combined with modern F2/F3.


## Expanded platform features
- Clickable cross-season driver and constructor profiles.
- Searchable circuit directory and historical event records.
- Season calendar with individual race-centre pages and session-level classifications where provided.
- Driver and constructor career comparison, season comparison, all-time records and historical analytics.
- Research-only prediction estimates with a visible methodology and confidence note.
- Generated profile/index data under `data/indexes/` and `data/profiles/`.

The prediction model is an exploratory statistical estimate, not a guarantee. Result and circuit metric coverage is season-specific and shown in the dashboard.


## Full platform navigation
- Dashboard, season calendar and searchable race centre.
- Individual race pages with session filters, classifications and circuit archive summaries.
- Cross-season driver and constructor profiles.
- Circuit directory and circuit-specific event history/facts derived from archive records.
- Career/season comparison pages, historical records and championship analytics.
- Research-only predictions with component weights and data-depth limitations.
- Data Centre with coverage by season and documented source limitations.

The build workflow generates the cross-season indexes and per-entity profile JSON files under `data/indexes/` and `data/profiles/`. Track length, corner counts, official lap records, qualifying, pit stops and telemetry are shown only when a verified source is connected.
