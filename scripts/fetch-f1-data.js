"use strict";
const fs=require("node:fs/promises"),path=require("node:path");
const BASE="https://api.jolpi.ca/ergast/f1",START=1950,END=new Date().getUTCFullYear(),OUT=path.join("data","f1");
const MIN_INTERVAL_MS=900,MAX_RETRIES=8;
let lastRequestAt=0;
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function retryDelay(response,attempt){
 const header=response.headers.get("retry-after");
 if(header){const seconds=Number(header);if(Number.isFinite(seconds))return Math.max(1000,seconds*1000);const date=Date.parse(header);if(Number.isFinite(date))return Math.max(1000,date-Date.now());}
 return Math.min(300000,15000*Math.pow(2,attempt));
}
async function request(url){
 for(let attempt=0;attempt<MAX_RETRIES;attempt++){
  const remaining=MIN_INTERVAL_MS-(Date.now()-lastRequestAt);if(remaining>0)await pause(remaining);
  lastRequestAt=Date.now();
  let response;
  try{response=await fetch(url,{headers:{"Accept":"application/json","User-Agent":"FormulaStatsTracker/1.0"}});}
  catch(error){if(attempt===MAX_RETRIES-1)throw error;const delay=Math.min(60000,3000*Math.pow(2,attempt));console.warn("Network issue; retrying in "+Math.round(delay/1000)+"s");await pause(delay);continue;}
  if(response.status===429||response.status>=500){
   if(attempt===MAX_RETRIES-1)throw new Error("HTTP "+response.status+" after retries for "+url);
   const delay=retryDelay(response,attempt);console.warn("Provider returned HTTP "+response.status+"; backing off for "+Math.round(delay/1000)+"s");await pause(delay);continue;
  }
  if(!response.ok)throw new Error("HTTP "+response.status+" for "+url);
  const json=await response.json();if(!json||!json.MRData)throw new Error("Unexpected API response from "+url);return json.MRData;
 }
 throw new Error("Retry limit reached for "+url);
}
async function resultsFor(year){
 let offset=0,total=0;const grouped=new Map();
 do{
  const data=await request(BASE+"/"+year+"/results.json?limit=100&offset="+offset);
  for(const race of (data.RaceTable&&data.RaceTable.Races)||[]){const key=String(race.round);if(!grouped.has(key))grouped.set(key,{...race,Results:[]});grouped.get(key).Results.push(...(race.Results||[]));}
  total=Number(data.total)||0;offset+=Number(data.limit)||100;
 }while(offset<total);
 return Array.from(grouped.values()).sort((a,b)=>Number(a.round)-Number(b.round));
}
async function scheduleFor(year){
 const data=await request(BASE+"/"+year+"/races.json?limit=100");
 return (data.RaceTable&&data.RaceTable.Races)||[];
}
async function standings(year,type){
 if(type==="constructorStandings"&&year<1958)return [];
 const data=await request(BASE+"/"+year+"/"+type+".json?limit=100");
 const lists=data.StandingsTable&&data.StandingsTable.StandingsLists;
 if(!lists||!lists.length)return [];
 return lists[0][type==="driverStandings"?"DriverStandings":"ConstructorStandings"]||[];
}
async function main(){
 await fs.mkdir(OUT,{recursive:true});
 for(let year=START;year<=END;year++){
  const file=path.join(OUT,year+".json"),exists=await fs.access(file).then(()=>true).catch(()=>false);
  if(exists&&year!==END){console.log("Historical snapshot retained: "+year);continue;}
  console.log("Fetching F1 "+year);
  const races=await resultsFor(year),schedule=await scheduleFor(year),driverStandings=await standings(year,"driverStandings"),constructorStandings=await standings(year,"constructorStandings");
  if(year<1958&&constructorStandings.length)throw new Error("Unexpected pre-1958 constructor standings.");
  const resultByRound=new Map(races.map(r=>[String(r.round),r]));
  const mergedRaces=schedule.map(s=>{
   const actual=resultByRound.get(String(s.round));
   return actual?{...s,...actual,Circuit:actual.Circuit||s.Circuit}:{...s,Results:[]};
  });
  const calendar=schedule.map(r=>({round:String(r.round),raceName:r.raceName,date:r.date||null,time:r.time||null,Circuit:r.Circuit||{}}));
  const data={series:"f1",season:year,updatedAt:new Date().toISOString(),source:"Jolpica F1 API",driverStandings,constructorStandings,races:mergedRaces,calendar};
  if(!races.length&&year<END)throw new Error("No race results returned for historical season "+year+"; refusing to save an empty snapshot.");
  await fs.writeFile(file,JSON.stringify(data));
  console.log(year+": "+races.length+" race weekends, "+driverStandings.length+" driver standings, "+constructorStandings.length+" constructor standings.");
 }
}
main().catch(error=>{console.error(error);process.exit(1);});
