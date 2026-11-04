(() => {
"use strict";
const CURRENT_YEAR = new Date().getFullYear();
const state = {series:"f1",season:CURRENT_YEAR,drivers:[],constructors:[],races:[],results:[],loading:false};
const $ = (id) => document.getElementById(id);
const safe = (v) => String(v == null ? "" : v).replace(/[&<>"']/g,(c)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const num = (v) => Number.isFinite(Number(v)) ? Number(v).toLocaleString("en-GB",{maximumFractionDigits:2}) : "—";
const name = (d) => [d && d.givenName,d && d.familyName].filter(Boolean).join(" ") || (d && (d.code || d.driverId)) || "Unknown";
function status(kind,label){$("statusDot").className="status-dot "+kind;$("statusText").textContent=label;}
function notice(text){$("coverageNotice").innerHTML="<strong>DATA NOTE</strong><span>"+safe(text)+"</span>";}
function seasons(){
 const start=state.series==="f1"?1950:state.series==="f2"?2017:2019;
 const select=$("seasonSelect");select.innerHTML="";
 for(let y=CURRENT_YEAR;y>=start;y--){const o=document.createElement("option");o.value=String(y);o.textContent=String(y);select.appendChild(o);}
 state.season=Math.max(start,Math.min(CURRENT_YEAR,state.season));select.value=String(state.season);
}
function table(headers,rows){
 if(!rows.length)return "<div class='empty-state'>No records available for this season.</div>";
 return "<table><thead><tr>"+headers.map(h=>"<th>"+h+"</th>").join("")+"</tr></thead><tbody>"+rows.join("")+"</tbody></table>";
}
function driverRows(items){
 return items.map(e=>"<tr><td class='rank'>"+safe(e.position||"—")+"</td><td><span class='driver-name'>"+safe(name(e.Driver))+"</span><div class='muted'>"+safe(e.Driver && e.Driver.nationality)+"</div></td><td>"+safe((e.Constructors||[]).map(c=>c.name).join(", ")||"—")+"</td><td class='num'>"+safe(e.wins||"0")+"</td><td class='num'>"+safe(num(e.points))+"</td></tr>");
}
function constructorRows(items){
 return items.map(e=>"<tr><td class='rank'>"+safe(e.position||"—")+"</td><td class='driver-name'>"+safe(e.Constructor && e.Constructor.name)+"</td><td>"+safe(e.Constructor && e.Constructor.nationality||"—")+"</td><td class='num'>"+safe(e.wins||"0")+"</td><td class='num'>"+safe(num(e.points))+"</td></tr>");
}
function raceRows(races){
 return races.map(r=>{
 const winner=(r.Results||[]).find(x=>x.position==="1") || (r.Results||[])[0];
 return "<tr><td class='rank'>"+safe(r.round)+"</td><td><span class='driver-name'>"+safe(r.raceName)+"</span><div class='muted'>"+safe(r.Circuit && r.Circuit.circuitName)+"</div></td><td>"+safe(r.date||"—")+"</td><td>"+safe(winner?name(winner.Driver):"Pending")+"</td><td class='num'>"+safe(winner?num(winner.points):"—")+"</td></tr>";
 });
}
function flatten(races){return races.flatMap(r=>(r.Results||[]).map(x=>({race:r,result:x})))}
function records(){
 const map=new Map();
 state.results.forEach(({result:r})=>{
 const id=r.Driver && r.Driver.driverId;if(!id)return;
 if(!map.has(id))map.set(id,{name:name(r.Driver),wins:0,podiums:0,fastest:0,points:0});
 const x=map.get(id),p=Number(r.position);
 if(p===1)x.wins++;if(p>=1&&p<=3)x.podiums++;
 if(r.FastestLap&&r.FastestLap.rank==="1")x.fastest++;
 x.points+=Number(r.points)||0;
 });
 return Array.from(map.values()).sort((a,b)=>b.points-a.points);
}
function render(){
 const ds=state.drivers,cs=state.constructors,rs=state.races;
 $("kpiRaces").textContent=num(rs.length);$("kpiDrivers").textContent=num(ds.length);$("kpiTeams").textContent=num(cs.length);
 const leader=ds[0];$("kpiLeader").textContent=leader?name(leader.Driver):"—";
 $("kpiLeaderPoints").textContent=leader?num(leader.points)+" points":"No championship classification";
 $("overviewDrivers").innerHTML=table(["POS","DRIVER","CONSTRUCTOR","WINS","POINTS"],driverRows(ds.slice(0,10)));
 $("driversTable").innerHTML=table(["POS","DRIVER","CONSTRUCTOR","WINS","POINTS"],driverRows(ds));
 $("overviewTeams").innerHTML=cs.slice(0,10).map(e=>"<div class='mini-row'><span class='mini-rank'>"+safe(e.position)+"</span><span><span class='mini-name'>"+safe(e.Constructor.name)+"</span><br><span class='mini-sub'>"+safe(e.wins||0)+" wins</span></span><strong class='mini-points'>"+safe(num(e.points))+"</strong></div>").join("")||"<div class='empty-state'>No constructor standings.</div>";
 $("teamsTable").innerHTML=table(["POS","CONSTRUCTOR","NATIONALITY","WINS","POINTS"],constructorRows(cs));
 $("overviewRaces").innerHTML=table(["ROUND","GRAND PRIX / CIRCUIT","DATE","WINNER","WINNER PTS"],raceRows(rs.slice(-8)));
 $("racesTable").innerHTML=table(["ROUND","GRAND PRIX / CIRCUIT","DATE","WINNER","WINNER PTS"],raceRows(rs));
 $("driverCount").textContent=ds.length+" DRIVERS";$("raceCount").textContent=rs.length+" EVENTS";
 $("seasonMeta").textContent="SEASON "+state.season+" · LOCAL DATA SNAPSHOT";
 const rec=records();
 const leaderFor=(field)=>rec.slice().sort((a,b)=>b[field]-a[field])[0];
 const set=(field,id,note)=>{const x=leaderFor(field);$(id).textContent=x?String(x[field]):"—";$(note).textContent=x?x.name:"No data";};
 set("wins","recordWins","recordWinsNote");set("podiums","recordPodiums","recordPodiumsNote");set("fastest","recordFastest","recordFastestNote");
 $("recordPoles").textContent="—";$("recordPolesNote").textContent="Qualifying data not integrated yet";
 $("recordsTable").innerHTML=table(["DRIVER","WINS","PODIUMS","FASTEST LAPS","RACE POINTS"],rec.slice(0,25).map(x=>"<tr><td class='driver-name'>"+safe(x.name)+"</td><td class='num'>"+x.wins+"</td><td class='num'>"+x.podiums+"</td><td class='num'>"+x.fastest+"</td><td class='num'>"+num(x.points)+"</td></tr>"));
 populateCompare();filterRows();
}
function populateCompare(){
 ["compareOne","compareTwo"].forEach(id=>{
 const el=$(id),old=el.value;el.innerHTML="<option value=''>Select driver</option>"+state.drivers.map(e=>"<option value='"+safe(e.Driver.driverId)+"'>"+safe(name(e.Driver))+"</option>").join("");
 if(state.drivers.some(e=>e.Driver.driverId===old))el.value=old;
 });compare();
}
function compare(){
 const a=state.drivers.find(e=>e.Driver.driverId===$("compareOne").value),b=state.drivers.find(e=>e.Driver.driverId===$("compareTwo").value);
 if(!a||!b){$("comparisonOutput").innerHTML="<div class='empty-state'>Choose two drivers to compare their season standings.</div>";return;}
 const card=e=>"<article class='compare-card'><h3>"+safe(name(e.Driver))+"</h3><div class='compare-stat'><span>Championship position</span><strong>#"+safe(e.position)+"</strong></div><div class='compare-stat'><span>Points</span><strong>"+safe(num(e.points))+"</strong></div><div class='compare-stat'><span>Wins</span><strong>"+safe(e.wins||0)+"</strong></div><div class='compare-stat'><span>Constructor</span><strong>"+safe((e.Constructors||[]).map(c=>c.name).join(", "))+"</strong></div></article>";
 $("comparisonOutput").innerHTML="<div class='compare-grid'>"+card(a)+card(b)+"</div>";
}
function filterRows(){
 const rq=$("raceSearch").value.toLowerCase(),dq=$("driverSearch").value.toLowerCase();
 document.querySelectorAll("#racesTable tbody tr").forEach(row=>row.hidden=!row.textContent.toLowerCase().includes(rq));
 document.querySelectorAll("#driversTable tbody tr").forEach(row=>row.hidden=!row.textContent.toLowerCase().includes(dq));
}
function unavailableSeries(){
 state.drivers=[];state.constructors=[];state.races=[];state.results=[];
 ["kpiRaces","kpiDrivers","kpiTeams","kpiLeader","recordWins","recordPodiums","recordPoles","recordFastest"].forEach(id=>$(id).textContent="—");
 ["overviewDrivers","overviewTeams","overviewRaces","driversTable","teamsTable","racesTable","recordsTable"].forEach(id=>$(id).innerHTML="<div class='empty-state'>Verified "+state.series.toUpperCase()+" results have not been connected yet. No placeholder statistics are shown.</div>");
 $("kpiLeaderPoints").textContent="No connected data";$("seasonMeta").textContent="SOURCE INTEGRATION REQUIRED";
 notice(state.series.toUpperCase()+" selector is ready, but the historical dataset has not yet been connected. Modern F2 begins in 2017; modern F3 begins in 2019. GP2 and GP3 predecessor series will remain separate.");
 status("bad","SERIES DATA NOT CONNECTED");
}
async function load(){
 if(state.loading)return;state.loading=true;status("","LOADING DATA");$("seasonMeta").textContent="FETCHING "+state.season;
 try{
  if(state.series!=="f1"){unavailableSeries();return;}
  const response=await fetch("./data/f1/"+state.season+".json?b="+Date.now(),{cache:"no-store"});
  if(!response.ok)throw new Error(response.status===404?"No saved data file for this season yet. Run the GitHub Actions data update workflow.":"Unable to read the season data file.");
  const data=await response.json();
  if(!data||Number(data.season)!==state.season)throw new Error("Season data file is invalid or does not match the selected season.");
  state.drivers=data.driverStandings||[];state.constructors=data.constructorStandings||[];state.races=data.races||[];state.results=flatten(state.races);
  render();status("good","F1 DATA LOADED");
  notice("F1 data from Jolpica is stored in this repository. Last updated: "+(data.updatedAt||"date not supplied")+". Some metrics, including poles and qualifying, are not included in this first release.");
 }catch(err){
  console.error(err);state.drivers=[];state.constructors=[];state.races=[];state.results=[];
  ["kpiRaces","kpiDrivers","kpiTeams","kpiLeader","recordWins","recordPodiums","recordPoles","recordFastest"].forEach(id=>$(id).textContent="—");
  ["overviewDrivers","overviewTeams","overviewRaces","driversTable","teamsTable","racesTable","recordsTable"].forEach(id=>$(id).innerHTML="<div class='empty-state'>"+safe(err.message)+"</div>");
  $("kpiLeaderPoints").textContent="Data unavailable";status("bad","DATA UNAVAILABLE");notice(err.message);
 }finally{state.loading=false;}
}
function switchView(view){
 document.querySelectorAll(".view").forEach(el=>el.classList.toggle("active",el.id==="view-"+view));
 document.querySelectorAll(".nav-link").forEach(el=>el.classList.toggle("active",el.dataset.view===view));
}
document.querySelectorAll(".nav-link").forEach(b=>b.addEventListener("click",()=>switchView(b.dataset.view)));
document.querySelectorAll("[data-open-view]").forEach(b=>b.addEventListener("click",()=>switchView(b.dataset.openView)));
document.querySelectorAll(".series-button").forEach(b=>b.addEventListener("click",()=>{
 document.querySelectorAll(".series-button").forEach(x=>x.classList.toggle("selected",x===b));state.series=b.dataset.series;seasons();load();
}));
$("seasonSelect").addEventListener("change",e=>{state.season=Number(e.target.value);load();});
$("refreshButton").addEventListener("click",load);
$("compareOne").addEventListener("change",compare);$("compareTwo").addEventListener("change",compare);
$("raceSearch").addEventListener("input",filterRows);$("driverSearch").addEventListener("input",filterRows);
seasons();load();
})();