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
