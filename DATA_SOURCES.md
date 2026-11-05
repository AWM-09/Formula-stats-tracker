# Data sources, coverage and definitions

## Formula 1 — 1950 onwards
- Source: Jolpica F1, an open-source continuation of the Ergast-compatible Formula 1 API.
- API: https://api.jolpi.ca/ergast/f1/
- Documentation: https://github.com/jolpica/jolpica-f1
- This project uses the API from a Node.js GitHub Actions workflow. The workflow sends the custom User-Agent required by the provider, then stores season snapshots in data/f1/.
- First release metrics: race results, season driver standings, constructor standings, race wins, podiums, fastest laps and race points.
- F1 qualifying and Sprint classifications are imported from Jolpica where the source publishes them. Current-season F1 practice classifications are imported through FastF1 after a session is complete; this is not a complete historical practice archive. Official pole records are kept distinct from grid-position-one starts. Pit stops, full lap charts and telemetry are not yet imported as a comprehensive historical dataset.

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
3. Extend verified qualifying, Sprint, practice and pole-position coverage across F1, F2 and F3, clearly labelling series-specific gaps.
4. Expand historical lap timing, pit-stop, tyre and telemetry datasets where redistribution and source coverage permit.
5. Improve back-testing, data-health reports and source-specific completeness checks.

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



## Generated profile and circuit indexes
The scheduled GitHub Actions pipeline builds cross-season driver, constructor and circuit indexes from the season JSON archives. Individual profile files are written to `data/profiles/`; compact directory indexes are written to `data/indexes/`. These are derived project indexes, not independent primary sources.

## Calendar and race detail coverage
- F1 event dates and schedule entries are imported from Jolpica's season race endpoint; completed classifications are merged by round.
- F2/F3 calendar entries are currently derived from the season's available event archive. Historical season summary pages do not always supply a reliable date, so the calendar may show an event round and circuit without a date.
- Race-centre pages expose only fields actually present in the selected season archive. Qualifying, pit stops, telemetry, tyre strategy and official circuit lap records are not implied when absent.
- Circuit "fun facts" are computed from the archive (event count, years represented, and repeat winners). Physical circuit specifications such as length and corners are not guessed.


## Motorsport news feed
- Source: Crash.net RSS feeds for F1, F2 and F3: [feed directory](https://www.crash.net/rssnewsfeeds).
- The scheduled GitHub Actions workflow stores article headlines, a short publisher-provided feed summary, publication time, source attribution and the direct story URL in `data/news.json`.
- Full article text and publisher images are not copied into this project. Each news card links directly to the original Crash.net story.
- The browser reads the cached snapshot, so the news page does not depend on a third-party RSS proxy or direct cross-origin feed access.
- If one feed is unavailable, its previous snapshot is retained; if all feeds fail, the existing news file is left unchanged.


## Circuit layouts and track specifications
- Circuit layout metadata and historical layout-era mappings are imported from [MisterSix2295/f1-circuits-svg](https://github.com/MisterSix2295/f1-circuits-svg). The upstream project lists the layouts of 77 venues that have hosted a Formula 1 World Championship Grand Prix. Its SVG artwork is released under the MIT licence; the project licence notice is retained in this repository's circuit profile interface.
- Track type, direction, current dimensions and layout-specific length/turn counts are imported from [F1DB](https://github.com/f1db/f1db), using its `src/data/circuits` records. F1DB is licensed under CC BY 4.0. Its circuit and layout records are versioned by the upstream project.
- The importer joins circuit and layout identifiers, then uses names and close geographic coordinates only as a fallback when the two sources use different IDs. Layout selection is by the season range in the layout source. A circuit with no defensible match displays an unavailable message rather than a substitute map.
- Circuit profile lap totals, average winner laps and recorded classified distance are calculated from this project's imported event classifications. Distance is computed only when the event's winning-lap count and matching historical layout length are both present. These are project-derived archive statistics, not official lap records.
- The fastest race lap shown on a circuit profile is the fastest lap value present in this project's imported classifications. It is not presented as an official all-time circuit lap record.
- F1 layout coverage is not the same as universal F2/F3 layout coverage. Where an F2/F3 venue does not match a verified F1DB circuit/layout record, the profile explains that physical specifications or artwork are unavailable.

## Added platform tools
- Browser-local driver and constructor watchlists use local storage and do not sync across devices.
- Race-by-race driver comparisons use shared rounds and stored numeric classifications; missing classifications do not count as a loss.
- Season points progression is calculated from race-session points present in the selected season archive. Sprint points are only included where the data is represented in the stored session rows.
- The Export Centre downloads CSV standings, calendars and session results, plus the stored season snapshot as JSON.
- News categories are heuristic labels based on publisher feed headlines and summaries. They are filters, not an editorially verified classification.
