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
- Final driver and team championship standings: season-specific [Wikipedia season article](https://en.wikipedia.org/wiki/2017_Formula_2_Championship), which cites published championship sources. The precise article URL is stored in each season JSON. Wikipedia text is licensed under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/); the season JSON retains source links and this attribution.
- Race classifications from 2017–2023: [Alarchemn's F2 historical dataset](https://github.com/Alarchemn/F2-Data-Pipeline), released under the repository's MIT licence. Imported fields include classified position, laps, race time, gap, team and best lap where present.
- From 2024 onwards: season article summary tables provide Sprint/Feature winners, pole positions and fastest-lap drivers where published. They do not provide full timing sheets or podium classifications.
- The earlier GP2 championship (2005–2016) is not merged into modern F2.

## Formula 3 — 2019 onwards
- Final driver and team championship standings: season-specific [Wikipedia season article](https://en.wikipedia.org/wiki/2019_FIA_Formula_3_Championship), which cites published championship sources. The precise article URL is stored in each season JSON. Wikipedia text is licensed under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/); the season JSON retains source links and this attribution.
- Race summaries: per-season championship summary tables with Sprint/Feature or Race 1/Race 2 winners, pole positions and fastest-lap drivers. These are linked individually in each season JSON.
- These season summaries are winner-level and do not provide full per-session finishing orders, so podium totals remain unavailable.
- GP3 (2010–2018) is a predecessor competition and is not merged into modern FIA Formula 3.

## F2/F3 data coverage conventions
- Final championship positions and points come from the season standings tables parsed from the season articles.
- A blank position or metric means that the upstream source does not publish it in the imported table.
- F2 2017–2023 race rows include classified order, laps, race time, gaps and best lap where present in the MIT-licensed archive. That CSV does not publish race-session championship points, so those cells remain blank.
- F2 2024 onwards and F3 seasons use season-summary winners, poles and fastest-lap drivers where published; lap-by-lap timing and full podiums are not included.
- Every season JSON includes its upstream source URL and a coverage description.

