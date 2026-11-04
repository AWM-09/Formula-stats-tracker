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



## Formula 2 — 2017 onwards
- Final driver and team standings: historical season-specific pages in the official [FIA archive](https://www.fia.com/events/formula-2-championship).
- Race classifications from 2017–2023: [Alarchemn's F2 historical dataset](https://github.com/Alarchemn/F2-Data-Pipeline), which documents FIA Formula 2 as its source and is released under the repository's MIT licence. Imported fields include classification position, laps, race time, gap, team and best lap where present.
- From 2024 onwards: the FIA standings archive provides session-level Race 1 / Race 2 positions where those cells are published. These pages are standings tables, not full timing feeds.
- The earlier GP2 championship (2005–2016) is not merged into modern F2.

## Formula 3 — 2019 onwards
- Final driver and team standings: historical season-specific pages in the official [FIA Formula 3 archive](https://www.fia.com/events/fia-formula-3-championship).
- Race summaries: per-season Wikipedia championship summary tables for Sprint/Feature winners, pole positions and fastest-lap drivers. These are linked individually in each season JSON and are checked against available FIA standings.
- Some early FIA F3 standings archives publish aggregate points by event rather than full per-session classifications. In those seasons the project shows race winners and available pole/fastest-lap records only; it does not invent podiums or finishing positions.
- GP3 (2010–2018) is a predecessor competition and is not merged into modern FIA Formula 3.

## F2/F3 data coverage conventions
- FIA season standings supply official season position and points.
- A blank position or metric means that the upstream source does not publish it in the imported table.
- F2 2017–2023 race rows include classified order, laps, race time, gaps and best lap where present in the archive. That CSV does not publish race-session points, so those cells remain blank.
- F2/F3 2024–2026 per-session position values come from FIA standings tables, not timing feeds; lap-by-lap telemetry and full timing sheets are not included.
- F3 season-summary data is winner-level for seasons where FIA's standings table lacks full per-session finishing positions; podium totals remain unavailable in those seasons.
- Each season JSON includes its upstream source URL and a coverage description.

