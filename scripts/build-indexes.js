"use strict";
const fs = require("node:fs/promises");
const path = require("node:path");
const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "data");
const SERIES = { f1: 1950, f2: 2017, f3: 2019 };
const CURRENT_YEAR = new Date().getUTCFullYear();
const norm = value => String(value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
const displayName = d => [d && d.givenName, d && d.familyName].filter(Boolean).join(" ").trim() || (d && (d.code || d.driverId)) || "Unknown";
const n = value => value === null || value === undefined || value === "" || !Number.isFinite(Number(value)) ? null : Number(value);
const slug = value => norm(value) || "unknown";

async function readSeason(series, year) {
  try {
    const data = JSON.parse(await fs.readFile(path.join(OUT, series, year + ".json"), "utf8"));
    return Number(data.season) === year && data.series === series ? data : null;
  } catch { return null; }
}
function seasonStats(row, year, series) {
  const coverage = row && row.coverage || {};
  return {
    season: year, position: n(row.position), points: n(row.points),
    wins: n(row.wins), podiums: n(row.podiums),
    poles: n(row.poles), fastestLaps: n(row.fastestLaps),
    constructors: (row.Constructors || []).map(c => c.name).filter(Boolean),
    dataCoverage: coverage.classification || "full"
  };
}
function isChampionshipRaceSession(series, session) {
  const name = String(session || "Race");
  if (series === "f1") return name === "Race";
  return ["Race", "Race 1", "Race 2", "Sprint Race", "Feature Race", "Feature Race 1", "Feature Race 2"].includes(name);
}

function summarizeCareer(seasons, results, type) {
  const sumKnown = key => {
    const present = seasons.map(s => s[key]).filter(v => v !== null && v !== undefined);
    return { value: present.length ? present.reduce((a,b) => a + b, 0) : null, complete: present.length === seasons.length && seasons.length > 0 };
  };
  const classified = results.filter(r => r.position !== null && r.position !== undefined);
  const allSeasonsClassified = seasons.length > 0
    && seasons.every(s => s.coverage === "full")
    && seasons.every(s => classified.some(r => r.season === s.season));
  const hasAnyFullClassifications = results.some(r => r.coverage === "full" && r.position !== null);
  const standingsWins = sumKnown("wins");
  const derivedWins = classified.filter(r => Number(r.position) === 1).length;
  const derivedPodiums = classified.filter(r => Number(r.position) >= 1 && Number(r.position) <= 3).length;
  const wins = classified.length
    ? { value: derivedWins, complete: allSeasonsClassified }
    : standingsWins;
  const podiums = hasAnyFullClassifications
    ? { value: derivedPodiums, complete: allSeasonsClassified }
    : sumKnown("podiums");
  const standingsPoles = sumKnown("poles");
  const fastestFromResults = results.filter(r => r.isFastestLap).length;
  const standingsFastest = sumKnown("fastestLaps");
  const fastest = fastestFromResults > 0
    ? { value: fastestFromResults, complete: false }
    : standingsFastest;
  const points = sumKnown("points");
  const poleStarts = results.filter(r => r.grid === 1).length;
  const poleStartDataComplete = results.length > 0
    && allSeasonsClassified
    && results.every(r => r.grid !== null && r.grid !== undefined);
  return {
    seasons: seasons.length,
    firstSeason: seasons.length ? seasons[0].season : null,
    lastSeason: seasons.length ? seasons[seasons.length - 1].season : null,
    championships: seasons.filter(s => s.position === 1 && s.season < CURRENT_YEAR).length,
    points: points.value, pointsComplete: points.complete,
    wins: wins.value, winsComplete: wins.complete,
    podiums: podiums.value, podiumsComplete: podiums.complete,
    poles: standingsPoles.value, polesComplete: standingsPoles.complete,
    poleStarts, poleStartsComplete: poleStartDataComplete,
    fastestLaps: fastest.value, fastestLapsComplete: fastest.complete,
    eventResults: results.length,
    classifiedResults: classified.length,
    resultCoverage: results.some(r => r.coverage === "winners-only" || r.coverage === "standings-only") ? "partial" : "classification"
  };
}

async function buildSeries(series, firstYear, lastYear) {
  const drivers = new Map(), teams = new Map(), circuits = new Map(), seasons = [];
  for (let year = firstYear; year <= lastYear; year++) {
    const data = await readSeason(series, year);
    if (!data) continue;
    const championRow = (data.driverStandings || []).find(row => Number(row.position) === 1) || (data.driverStandings || [])[0] || null;
    const constructorChampion = (data.constructorStandings || []).find(row => Number(row.position) === 1) || (data.constructorStandings || [])[0] || null;
    seasons.push({
      year, status: year < lastYear ? "final" : "current",
      updatedAt: data.updatedAt || null, source: data.source || "",
      coverage: data.coverage || { classification: "full" },
      champion: year < lastYear && championRow && championRow.Driver ? displayName(championRow.Driver) : null,
      championId: year < lastYear && championRow && championRow.Driver ? championRow.Driver.driverId : null,
      championPoints: championRow ? n(championRow.points) : null,
      leader: year === lastYear && championRow && championRow.Driver ? displayName(championRow.Driver) : null,
      leaderId: year === lastYear && championRow && championRow.Driver ? championRow.Driver.driverId : null,
      constructorChampion: year < lastYear && constructorChampion && constructorChampion.Constructor ? constructorChampion.Constructor.name : null,
      constructorLeader: year === lastYear && constructorChampion && constructorChampion.Constructor ? constructorChampion.Constructor.name : null
    });

    for (const row of data.driverStandings || []) {
      const d = row.Driver || {}, id = d.driverId || slug(displayName(d));
      if (!id) continue;
      if (!drivers.has(id)) drivers.set(id, {
        id, name: displayName(d), nationality: d.nationality || "", code: d.code || "",
        number: d.permanentNumber || "", url: d.url || "", seasons: [], results: [], sessionResults: []
      });
      const profile = drivers.get(id);
      profile.seasons.push({
        season: year, position: n(row.position), points: n(row.points),
        wins: n(row.wins), podiums: n(row.podiums), poles: n(row.poles),
        fastestLaps: n(row.fastestLaps),
        constructors: (row.Constructors || []).map(c => c.name).filter(Boolean),
        coverage: (data.coverage && data.coverage.classification) || "full"
      });
      if (!profile.nationality && d.nationality) profile.nationality = d.nationality;
      if (!profile.code && d.code) profile.code = d.code;
      if (!profile.number && d.permanentNumber) profile.number = d.permanentNumber;
      if (!profile.url && d.url) profile.url = d.url;
    }

    for (const row of data.constructorStandings || []) {
      const c = row.Constructor || {}, id = c.constructorId || slug(c.name);
      if (!id) continue;
      if (!teams.has(id)) teams.set(id, {
        id, name: c.name || "Unknown", nationality: c.nationality || "",
        url: c.url || "", seasons: [], results: [], sessionResults: [], driverMap: new Map()
      });
      const profile = teams.get(id);
      profile.seasons.push({
        season: year, position: n(row.position), points: n(row.points),
        wins: n(row.wins), podiums: n(row.podiums),
        coverage: (data.coverage && data.coverage.classification) || "full"
      });
    }

    for (const race of data.races || []) {
      const circuit = race.Circuit || {};
      const circuitName = circuit.circuitName || race.raceName || "Unknown circuit";
      const circuitId = circuit.circuitId || slug(circuitName);
      if (!circuits.has(circuitId)) circuits.set(circuitId, {
        id: circuitId, name: circuitName, url: circuit.url || "",
        location: circuit.Location || null, seriesSet: new Set(),
        firstSeason: year, lastSeason: year, events: [], winners: new Map(), fastestLaps: []
      });
      const cp = circuits.get(circuitId);
      cp.seriesSet.add(series);
      cp.firstSeason = Math.min(cp.firstSeason, year);
      cp.lastSeason = Math.max(cp.lastSeason, year);
      if (!cp.url && circuit.url) cp.url = circuit.url;
      if (!cp.location && circuit.Location) cp.location = circuit.Location;

      const event = {
        series, season: year, round: n(race.round),
        raceName: race.raceName || circuitName, date: race.date || null,
        time: race.time || null, circuitId, circuitName,
        sessions: [], results: []
      };
      for (const result of race.Results || []) {
        if (result.isRecordOnly) {
          const rd = result.Driver || {};
          if (result.PolePosition && rd.driverId) {
            event.results.push({ recordOnly: true, kind: "pole", driverId: rd.driverId, driverName: displayName(rd), session: result.session || "" });
          }
          if (result.FastestLap && result.FastestLap.rank === "1" && rd.driverId) {
            event.results.push({ recordOnly: true, kind: "fastestLap", driverId: rd.driverId, driverName: displayName(rd), session: result.session || "" });
          }
          continue;
        }
        const d = result.Driver || {}, c = result.Constructor || {};
        const driverId = d.driverId || null;
        const teamId = c.constructorId || slug(c.name);
        const position = n(result.position);
        const session = result.session || "Race";
        const item = {
          driverId, driverName: displayName(d), teamId, teamName: c.name || "",
          position, grid: n(result.grid), points: n(result.points),
          laps: n(result.laps), status: result.status || "",
          time: result.Time && result.Time.time || "",
          gap: result.gap || "", session,
          fastestLap: result.FastestLap && result.FastestLap.Time && result.FastestLap.Time.time || "",
          isFastestLap: !!(result.FastestLap && result.FastestLap.rank === "1"),
          coverage: (data.coverage && data.coverage.classification) || "full"
        };
        event.results.push(item);
        if (!event.sessions.includes(session)) event.sessions.push(session);
        const raceClassification = isChampionshipRaceSession(series, session);
        if (driverId && drivers.has(driverId)) {
          const driverProfile = drivers.get(driverId);
          driverProfile.sessionResults.push({
            series, season: year, round: n(race.round), raceName: event.raceName,
            circuitId, circuitName, date: race.date || null, ...item
          });
          if (raceClassification) driverProfile.results.push({
            series, season: year, round: n(race.round), raceName: event.raceName,
            circuitId, circuitName, date: race.date || null, ...item
          });
        }
        if (teamId && teams.has(teamId)) {
          const tp = teams.get(teamId);
          tp.sessionResults.push({ series, season: year, round: n(race.round), raceName: event.raceName, circuitId, circuitName, date: race.date || null, ...item });
          if (raceClassification) tp.results.push({ series, season: year, round: n(race.round), raceName: event.raceName, circuitId, circuitName, date: race.date || null, ...item });
          if (driverId) tp.driverMap.set(driverId, displayName(d));
        }
        if (raceClassification && position === 1 && driverId) {
          cp.winners.set(driverId, (cp.winners.get(driverId) || 0) + 1);
          event.winner = { driverId, driverName: displayName(d), teamName: c.name || "", session };
        }
        if (raceClassification && item.isFastestLap && driverId) cp.fastestLaps.push({ driverId, driverName: displayName(d), time: item.fastestLap, season: year, raceName: event.raceName, session });
      }
      event.sessions.sort();
      cp.events.push(event);
    }
  }

  const driverSummaries = [], teamSummaries = [], circuitSummaries = [];
  for (const p of drivers.values()) {
    p.seasons.sort((a,b)=>a.season-b.season);
    p.results.sort((a,b)=>a.season-b.season||(a.round||0)-(b.round||0));
    const career = summarizeCareer(p.seasons,p.results,"driver");
    const profile = { type:"driver", series, ...p, career };
    await writeProfile(series,"drivers",p.id,profile);
    driverSummaries.push({ id:p.id, name:p.name, nationality:p.nationality, code:p.code, number:p.number, seasons:p.seasons.length, firstSeason:career.firstSeason, lastSeason:career.lastSeason, championships:career.championships, wins:career.wins, winsComplete:career.winsComplete, podiums:career.podiums, podiumsComplete:career.podiumsComplete, poles:career.poles, poleStarts:career.poleStarts, poleStartsComplete:career.poleStartsComplete, fastestLaps:career.fastestLaps, fastestLapsComplete:career.fastestLapsComplete, points:career.points, pointsComplete:career.pointsComplete, url:p.url });
  }
  for (const p of teams.values()) {
    p.seasons.sort((a,b)=>a.season-b.season);
    p.results.sort((a,b)=>a.season-b.season||(a.round||0)-(b.round||0));
    const career = summarizeCareer(p.seasons,p.results,"team");
    const profile = { type:"team", series, id:p.id, name:p.name, nationality:p.nationality, url:p.url, seasons:p.seasons, results:p.results, sessionResults:p.sessionResults, drivers:Array.from(p.driverMap,([id,name])=>({id,name})).sort((a,b)=>a.name.localeCompare(b.name)), career };
    await writeProfile(series,"teams",p.id,profile);
    teamSummaries.push({ id:p.id, name:p.name, nationality:p.nationality, seasons:p.seasons.length, firstSeason:career.firstSeason, lastSeason:career.lastSeason, championships:career.championships, wins:career.wins, winsComplete:career.winsComplete, podiums:career.podiums, podiumsComplete:career.podiumsComplete, points:career.points, pointsComplete:career.pointsComplete, url:p.url });
  }
  for (const p of circuits.values()) {
    p.events.sort((a,b)=>a.series.localeCompare(b.series)||a.season-b.season||(a.round||0)-(b.round||0));
    const winners = Array.from(p.winners,([driverId,wins])=>({driverId,driverName:drivers.get(driverId)?.name || driverId,wins})).sort((a,b)=>b.wins-a.wins);
    const profile = {
      type:"circuit", id:p.id, name:p.name, url:p.url, location:p.location,
      series:Array.from(p.seriesSet).sort(), firstSeason:p.firstSeason, lastSeason:p.lastSeason,
      eventCount:p.events.length, events:p.events, mostWins:winners.slice(0,10),
      fastestLapHighlights:p.fastestLaps.slice().sort((a,b)=>a.season-b.season).slice(-15).reverse()
    };
    await writeProfile(series,"circuits",p.id,profile);
    circuitSummaries.push({id:p.id,name:p.name,url:p.url,location:p.location,series:profile.series,firstSeason:p.firstSeason,lastSeason:p.lastSeason,eventCount:p.events.length,topWinner:winners[0]||null});
  }
  await fs.mkdir(path.join(OUT,"indexes"),{recursive:true});
  await fs.writeFile(path.join(OUT,"indexes",series+"-drivers.json"),JSON.stringify({series,generatedAt:new Date().toISOString(),seasonCount:seasons.length,seasons,drivers:driverSummaries.sort((a,b)=>a.name.localeCompare(b.name))}));
  await fs.writeFile(path.join(OUT,"indexes",series+"-teams.json"),JSON.stringify({series,generatedAt:new Date().toISOString(),seasonCount:seasons.length,teams:teamSummaries.sort((a,b)=>a.name.localeCompare(b.name))}));
  await fs.writeFile(path.join(OUT,"indexes",series+"-circuits.json"),JSON.stringify({series,generatedAt:new Date().toISOString(),circuits:circuitSummaries.sort((a,b)=>a.name.localeCompare(b.name))}));
  console.log(series.toUpperCase()+": "+driverSummaries.length+" drivers, "+teamSummaries.length+" constructors, "+circuitSummaries.length+" circuits across "+seasons.length+" seasons.");
}
async function writeProfile(series,kind,id,profile) {
  const safeId=String(id).replace(/[^a-zA-Z0-9_-]/g,"-");
  const folder=path.join(OUT,"profiles",series,kind);
  await fs.mkdir(folder,{recursive:true});
  await fs.writeFile(path.join(folder,safeId+".json"),JSON.stringify(profile));
}
(async()=>{
 const last=new Date().getUTCFullYear();
 for(const [series,first] of Object.entries(SERIES)) await buildSeries(series,first,last);
})().catch(error=>{console.error(error);process.exit(1);});
