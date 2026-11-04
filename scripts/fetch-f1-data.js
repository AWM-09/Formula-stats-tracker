"use strict";
const fs = require("node:fs/promises");
const path = require("node:path");
const BASE = "https://api.jolpi.ca/ergast/f1";
const START_YEAR = 1950;
const END_YEAR = new Date().getUTCFullYear();
const OUT = path.join("data","f1");
const wait = (ms) => new Promise(resolve => setTimeout(resolve,ms));
async function getJson(url) {
  const response = await fetch(url,{headers:{"Accept":"application/json","User-Agent":"FormulaStatsTracker/1.0"}});
  if (!response.ok) throw new Error("HTTP "+response.status+" for "+url);
  return response.json();
}
async function endpoint(url) { await wait(325); const json=await getJson(url); if(!json || !json.MRData) throw new Error("Unexpected API response from "+url); return json.MRData; }
async function getPagedResults(year) {
  const all=[]; let offset=0; let total=0;
  do {
    const data=await endpoint(BASE+"/"+year+"/results.json?limit=100&offset="+offset);
    const races=(data.RaceTable && data.RaceTable.Races)||[];
    races.forEach(race=>all.push(race));
    total=Number(data.total)||0;
    offset+=Number(data.limit)||100;
  } while(offset<total);
  const byRound=new Map();
  all.forEach(race=>{
    const key=String(race.round);
    if(!byRound.has(key))byRound.set(key,{...race,Results:[]});
    byRound.get(key).Results.push(...(race.Results||[]));
  });
  return Array.from(byRound.values()).sort((a,b)=>Number(a.round)-Number(b.round));
}
async function getStandings(year,type) {
  const data=await endpoint(BASE+"/"+year+"/"+type+".json?limit=100");
  const lists=data.StandingsTable && data.StandingsTable.StandingsLists;
  if(!lists || !lists.length) return [];
  return lists[0][type==="driverStandings"?"DriverStandings":"ConstructorStandings"]||[];
}
async function main() {
  await fs.mkdir(OUT,{recursive:true});
  for(let year=START_YEAR;year<=END_YEAR;year++) {
    const target=path.join(OUT,year+".json");
    const exists=await fs.access(target).then(()=>true).catch(()=>false);
    if(exists && year!==END_YEAR) { console.log("Keeping historical snapshot "+year); continue; }
    console.log("Updating F1 season "+year);
    const races=await getPagedResults(year);
    const driverStandings=await getStandings(year,"driverStandings");
    const constructorStandings=await getStandings(year,"constructorStandings");
    const payload={series:"f1",season:year,updatedAt:new Date().toISOString(),source:"Jolpica F1 API",driverStandings,constructorStandings,races};
    await fs.writeFile(target,JSON.stringify(payload));
    console.log(year+": "+races.length+" race weekends, "+driverStandings.length+" driver standings, "+constructorStandings.length+" constructor standings");
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});