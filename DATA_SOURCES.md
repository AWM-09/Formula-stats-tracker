# Data sources, coverage and definitions

## Formula 1 — 1950 onwards
- Source: Jolpica F1, an open-source continuation of the Ergast-compatible Formula 1 API.
- API: https://api.jolpi.ca/ergast/f1/
- Documentation: https://github.com/jolpica/jolpica-f1
- This project uses the API from a Node.js GitHub Actions workflow. The workflow sends the custom User-Agent required by the provider, then stores season snapshots in data/f1/.
- First release metrics: race results, season driver standings, constructor standings, race wins, podiums, fastest laps and race points.
- Qualifying, pole positions, sprint results, pit stops, lap charts and telemetry are not yet included.

## Modern FIA Formula 2 — 2017 onwards
The FIA Formula 2 Championship was inaugurated in 2017. GP2 (2005–2016) is its predecessor series and will be stored as a separate competition unless an explicitly labelled combined-history view is added.
Official history: https://www.fiaformula2.com/en/information/the-championship-f2.ey1hQTCs7BVYMl34JLpxD

## Modern FIA Formula 3 — 2019 onwards
The FIA Formula 3 Championship launched in 2019. GP3 (2010–2018) is a predecessor series and will be stored as a separate competition unless an explicitly labelled combined-history view is added.
Official history: https://www.fiaformula3.com/en/information/the-championship-f3.6ScTODIl7hwV4anyqB5CHk

## Data integrity rules
- Blank or unavailable values are not zero.
- Historical coverage varies by metric and championship.
- A season-level record calculated by this project is not automatically an official all-time record.
- F2, F3, GP2 and GP3 are distinct series in the project data model.
- Failed or partial source downloads must fail the update rather than overwrite valid historical data with empty files.

## Planned work
1. Connect verified race-by-race historical sources for F2 and GP2.
2. Connect verified race-by-race historical sources for F3 and GP3.
3. Add qualifying, sprint and pole-position datasets with source-specific coverage.
4. Build driver and team profiles, career comparisons, season comparisons, advanced analytics and data-health reports.
5. Add cached indexes and reliable scheduled refreshes.

Independent project; not affiliated with Formula One, FIA, Formula 2, Formula 3 or any team. Check the license and attribution terms of each upstream dataset before redistributing its data.
