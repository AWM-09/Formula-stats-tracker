(() => {
"use strict";
const SERIES = { f1:{label:"Formula 1",first:1950}, f2:{label:"Formula 2",first:2017}, f3:{label:"Formula 3",first:2019} };
const CURRENT_YEAR = new Date().getUTCFullYear();
function loadWatchlist(){
  try {
    const parsed=JSON.parse(localStorage.getItem("formulaStatsWatchlist")||"{}");
    return {
      drivers:Array.isArray(parsed.drivers)?parsed.drivers:[],
      teams:Array.isArray(parsed.teams)?parsed.teams:[]
    };
  } catch {
    return {drivers:[],teams:[]};
  }
}
function watchlistKey(series,id){return String(series)+":"+String(id);}
function isWatchlisted(type,series,id){
  return !!(state.watchlist[type]||[]).includes(watchlistKey(series,id));
}
function toggleWatchlist(type,series,id){
  const key=watchlistKey(series,id),items=state.watchlist[type]||[];
  state.watchlist[type]=items.includes(key)?items.filter(x=>x!==key):[...items,key];
  try{localStorage.setItem("formulaStatsWatchlist",JSON.stringify(state.watchlist));}
  catch(error){console.warn("Watchlist could not be saved in this browser.",error);}
}
const state = {
  series:"f1", season:CURRENT_YEAR, data:null, route:["dashboard"],
  dataCache:new Map(), indexCache:new Map(), profileCache:new Map(),
  compareDriverDirectory:new Map(),
  sessionFilter:"", predictionEvent:"", compareResult:"", countdownTimer:null,
  newsSeriesFilter:"all", newsCategoryFilter:"all", newsSearch:"", watchlist:loadWatchlist()
};
const $ = id => document.getElementById(id);
const esc = value => String(value==null?"":value).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const norm = value => String(value||"").normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]/g,"");
const number = value => value===null||value===undefined||value===""||!Number.isFinite(Number(value))?"—":Number(value).toLocaleString("en-GB",{maximumFractionDigits:2});
const driverName = d => [d&&d.givenName,d&&d.familyName].filter(Boolean).join(" ").trim()||(d&&(d.code||d.driverId))||"Not supplied";
const routeHref = parts => "#/"+parts.map(x=>encodeURIComponent(String(x))).join("/");
const slug = value => norm(value)||"unknown";
const niceDate = value => {
  if(!value)return "Date not supplied";
  const date=new Date(value+"T00:00:00Z");
  return Number.isNaN(date.getTime())?String(value):date.toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric",timeZone:"UTC"});
};
const seriesLabel = series => SERIES[series]?.label || String(series||"").toUpperCase();
const status = (kind,label) => { $("statusDot").className="status-dot "+kind; $("statusText").textContent=label; };
const notice = (message,kind="") => { $("statusMessage").textContent=message; $("statusStrip").className="status-strip "+kind; };
const safeId = id => String(id||"").replace(/[^a-zA-Z0-9_-]/g,"-");
const table = (heads,rows,extraClass="") => rows.length
 ? "<div class='table-wrap'><table class='"+extraClass+"'><thead><tr>"+heads.map(h=>"<th>"+h+"</th>").join("")+"</tr></thead><tbody>"+rows.join("")+"</tbody></table></div>"
 : "<div class='empty-state'>No records are available in this dataset.</div>";
const pageHead = (eyebrow,title,desc,actions="") =>
 "<div class='page-heading'><div><span class='eyebrow'>"+esc(eyebrow)+"</span><h1>"+esc(title)+"</h1><p>"+esc(desc)+"</p></div><div class='page-actions'>"+actions+"</div></div>";
const panel = (eyebrow,title,body,action="") =>
 "<section class='panel'><div class='panel-header'><div><span class='eyebrow'>"+eyebrow+"</span><h2>"+title+"</h2></div>"+action+"</div>"+body+"</section>";
const kpi = (label,value,sub,accent="") =>
 "<article class='kpi "+accent+"'><span class='kpi-label'>"+esc(label)+"</span><strong>"+esc(value)+"</strong><small>"+esc(sub)+"</small></article>";
const metric = (label,value,sub="") =>
 "<div class='metric'><span>"+esc(label)+"</span><strong>"+esc(value)+"</strong><small>"+esc(sub)+"</small></div>";
const badge = (text,kind="") => "<span class='badge "+kind+"'>"+esc(text)+"</span>";
const driverHref = (series,id) => routeHref(["driver",series,id]);
const teamHref = (series,id) => routeHref(["team",series,id]);
const circuitHref = id => routeHref(["circuit",id]);
const raceHref = (series,year,round) => routeHref(["race",series,year,round]);
const driverLink = (series,id,name) => id ? "<a class='person-link' href='"+driverHref(series,id)+"'>"+esc(name)+"</a>" : esc(name||"Not supplied");
const teamLink = (series,id,name) => id ? "<a class='person-link' href='"+teamHref(series,id)+"'>"+esc(name)+"</a>" : esc(name||"—");
function routeParse(){
  const raw=location.hash.replace(/^#\/?/,"");
  if(!raw)return ["dashboard"];
  return raw.split("/").filter(Boolean).map(x=>{try{return decodeURIComponent(x)}catch{return x}});
}
function navigate(parts){location.hash="/"+parts.map(encodeURIComponent).join("/");}
async function fetchJson(path,cache,force=false){
  if(!force&&cache.has(path))return cache.get(path);
  const response=await fetch("./"+path+"?v="+(force?Date.now():"1"),{cache:force?"no-store":"default"});
  if(!response.ok)throw new Error("Missing archive file: "+path);
  const data=await response.json();cache.set(path,data);return data;
}
async function getSeason(series,year,force=false){
  const key=series+"/"+year;
  if(!force&&state.dataCache.has(key))return state.dataCache.get(key);
  const data=await fetchJson("data/"+series+"/"+year+".json",state.dataCache,force);
  if(data.series!==series||Number(data.season)!==Number(year))throw new Error("Season file does not match the selected championship and year.");
  state.dataCache.set(key,data);return data;
}
async function getIndex(series,kind){
  const key=series+"-"+kind;
  if(state.indexCache.has(key))return state.indexCache.get(key);
  const data=await fetchJson("data/indexes/"+key+".json",state.indexCache);
  state.indexCache.set(key,data);return data;
}
async function getProfile(series,kind,id){
  const key=series+"/"+kind+"/"+id;
  if(state.profileCache.has(key))return state.profileCache.get(key);
  const baseSeries=series;
  const data=await fetchJson("data/profiles/"+baseSeries+"/"+kind+"/"+safeId(id)+".json",state.profileCache);
  state.profileCache.set(key,data);return data;
}
function fillSeasonOptions(){
  const start=SERIES[state.series].first,select=$("seasonSelect");
  select.innerHTML="";
  for(let year=CURRENT_YEAR;year>=start;year--){
    const option=document.createElement("option");option.value=String(year);option.textContent=String(year);select.appendChild(option);
  }
  state.season=Math.max(start,Math.min(CURRENT_YEAR,state.season));
  select.value=String(state.season);
}
function setActiveNav(route){
  const root=route[0]==="overview"?"dashboard":route[0]==="driver"?"drivers":route[0]==="team"?"teams":route[0]==="circuit"?"circuits":route[0]==="race"?"race-centre":route[0];
  document.querySelectorAll(".main-nav a").forEach(a=>a.classList.toggle("active",a.dataset.nav===root));
}
function pageError(error){
  status("bad","DATA OR PAGE ERROR");
  $("viewRoot").innerHTML="<div class='notice red'><strong>Unable to load this section.</strong> "+esc(error.message)+"</div><div class='panel'><p class='secondary'>Check the data source and try refreshing. This page will not substitute fabricated values.</p><button class='text-button' id='retryButton'>Retry</button></div>";
  $("retryButton")?.addEventListener("click",()=>renderRoute(true));
}
async function renderRoute(force=false){
  if(state.countdownTimer){clearInterval(state.countdownTimer);state.countdownTimer=null;}
  state.route=routeParse();
  const route=state.route[0]||"dashboard";
  if(["driver","team"].includes(route)&&state.route[1]&&SERIES[state.route[1]]){
    state.series=state.route[1];if(state.route[2])state.season=Math.max(SERIES[state.series].first,Math.min(CURRENT_YEAR,state.season));
  }else if(route==="race"&&SERIES[state.route[1]]){
    state.series=state.route[1];state.season=Number(state.route[2])||CURRENT_YEAR;
  }else if(["circuit"].includes(route)&&state.route[1]){
    // Circuit profiles span every series; keep the selected championship unchanged.
  }
  $("seriesSelect").value=state.series;fillSeasonOptions();$("seasonSelect").value=String(state.season);
  setActiveNav(state.route);
  if(route==="dashboard"){
    status("good",state.series.toUpperCase()+" PLATFORM READY");
    notice("Choose a tool based on what you want to investigate.");
    $("updatedLabel").textContent=state.season+" SEASON SELECTED";
    $("viewRoot").innerHTML=renderDashboard();
    bindDynamicEvents();
    return;
  }
  if(route==="news"){
    status("good","NEWS SNAPSHOT LOADED");
    notice("Publisher headlines from F1, F2 and F3. Open a story to read the full article on Crash.net.");
    $("updatedLabel").textContent="NEWS FEED";
    $("viewRoot").innerHTML="<div class='page-loading'><span class='spinner'></span><p>Loading motorsport headlines…</p></div>";
    try{
      const snapshot=await fetchJson("data/news.json",state.dataCache,force);
      $("updatedLabel").textContent=snapshot.updatedAt?"NEWS UPDATED "+formatNewsDate(snapshot.updatedAt).toUpperCase():"AWAITING FIRST NEWS IMPORT";
      $("viewRoot").innerHTML=renderNews(snapshot);
      bindDynamicEvents();
    }catch(error){console.error(error);pageError(error);}
    return;
  }
  $("viewRoot").innerHTML="<div class='page-loading'><span class='spinner'></span><p>Loading "+esc(route.replace(/-/g," "))+"…</p></div>";
  try{
    state.data=await getSeason(state.series,state.season,force);
    $("updatedLabel").textContent="UPDATED "+(state.data.updatedAt?niceDate(state.data.updatedAt.slice(0,10)).toUpperCase():"DATE NOT SUPPLIED");
    status("good",state.series.toUpperCase()+" ARCHIVE LOADED");
    const coverage=state.data.coverage;
    notice(coverage&&coverage.message?coverage.message:seriesLabel(state.series)+" season archive loaded.");
    let content="";
    switch(route){
      case "dashboard": content=renderDashboard();break;
      case "overview": content=await renderSeasonOverview();break;
      case "calendar": content=await renderCalendar();break;
      case "drivers": content=await renderDrivers();break;
      case "driver": content=await renderDriverProfile(state.route[1],state.route[2]);break;
      case "teams": content=await renderTeams();break;
      case "team": content=await renderTeamProfile(state.route[1],state.route[2]);break;
      case "circuits": content=await renderCircuits();break;
      case "circuit": content=await renderCircuitProfile(state.route[1]);break;
      case "race-centre": content=await renderRaceCentre();break;
      case "race": content=await renderRaceDetail(state.route[1],Number(state.route[2]),state.route[3]);break;
      case "predictions": content=await renderPredictions();break;
      case "comparisons": content=await renderComparisons();break;
      case "records": content=await renderRecords();break;
      case "analytics": content=await renderAnalytics();break;
      case "data-centre": content=await renderDataCentre();break;
      case "watchlist": content=await renderWatchlist();break;
      case "exports": content=renderExportCentre();break;
      default: content=await renderDashboard();
    }
    $("viewRoot").innerHTML=content;
    bindDynamicEvents();
    startCountdown();
  }catch(error){console.error(error);pageError(error);}
}
function availableEvents(data){
  const races=Array.isArray(data.races)?data.races:[];
  const schedule=Array.isArray(data.calendar)&&data.calendar.length?data.calendar:races;
  const raceByRound=new Map(races.map(event=>[String(event.round),event]));
  const merged=schedule.map(event=>{
    const actual=raceByRound.get(String(event.round));
    return {
      ...(actual||{}),
      ...event,
      Circuit:(actual&&actual.Circuit)||event.Circuit||{},
      Results:(actual&&Array.isArray(actual.Results)?actual.Results:event.Results)||[],
      raceName:(actual&&actual.raceName)||event.raceName,
      date:(actual&&actual.date)||event.date||null,
      time:(actual&&actual.time)||event.time||null
    };
  });
  const included=new Set(merged.map(event=>String(event.round)));
  for(const event of races){
    if(!included.has(String(event.round)))merged.push(event);
  }
  return merged.map(event=>{
    const circuit=event.Circuit||{};
    return {
      ...event,
      round:String(event.round),
      raceName:event.raceName||circuit.circuitName||("Round "+event.round),
      date:event.date||null,
      dateEnd:event.dateEnd||event.date||null,
      time:event.time||null,
      Circuit:circuit,
      circuitId:circuit.circuitId||slug(circuit.circuitName||event.raceName),
      Results:event.Results||[]
    };
  }).sort((a,b)=>(Number(a.round)||0)-(Number(b.round)||0));
}

function isRaceClassification(series, session) {
  const name=String(session||"Race");
  if(series==="f1")return name==="Race";
  return ["Race","Race 1","Race 2","Sprint Race","Feature Race","Feature Race 1","Feature Race 2"].includes(name);
}
function eventHasResults(event,series=state.series){
  return (event.Results||[]).some(r=>!r.isRecordOnly&&r.Driver&&isRaceClassification(series,r.session));
}
function eventCard(series,year,event){
  const location=event.Circuit&&event.Circuit.Location;
  const venue=[location&&location.locality,location&&location.country].filter(Boolean).join(", ");
  const sessions=[...new Set((event.Results||[]).filter(r=>!r.isRecordOnly).map(r=>r.session||"Race"))];
  const winner=(event.Results||[]).find(r=>!r.isRecordOnly&&isRaceClassification(series,r.session)&&String(r.position)==="1"&&r.Driver);
  const meta=[niceDate(event.date),venue,sessions.join(" / ")].filter(x=>x&&x!=="Date not supplied").join(" · ");
  return "<a class='event-row' href='"+raceHref(series,year,event.round)+"'><span class='event-round'>"+esc(event.round)+"</span><span class='event-main'><strong>"+esc(event.raceName)+"</strong><small>"+esc(meta||"Event listed · exact date or result detail not present in source")+"</small></span><span class='event-side'><strong>"+esc(winner?driverName(winner.Driver):eventHasResults(event)?"Results available":"Scheduled / classification pending")+"</strong><small>"+esc(winner?"Winner":"Open race page")+" ↗</small></span></a>";
}
function eventCountdownTarget(event){
  if(!event||!event.date)return null;
  if(event.time){
    const dateTime=Date.parse(String(event.date).slice(0,10)+"T"+String(event.time));
    if(Number.isFinite(dateTime))return {
      timestamp:dateTime,
      label:"RACE START",
      precision:"Scheduled race start · shown in your local timezone"
    };
  }
  const parts=String(event.date).slice(0,10).split("-").map(Number);
  if(parts.length!==3||parts.some(value=>!Number.isFinite(value)))return null;
  const timestamp=new Date(parts[0],parts[1]-1,parts[2],0,0,0,0).getTime();
  return {
    timestamp,
    label:"RACE WEEKEND",
    precision:"Weekend date supplied; exact session start time not published"
  };
}
function countdownMarkup(events){
  if(state.season!==CURRENT_YEAR){
    return "<section class='countdown-panel countdown-muted'><div><span class='eyebrow'>UPCOMING RACE COUNTDOWN</span><h2>Historical season selected</h2><p>Choose the current season to see its next scheduled event.</p></div></section>";
  }
  const now=Date.now();
  const upcoming=events.map(event=>({event,target:eventCountdownTarget(event)}))
    .filter(item=>item.target&&item.target.timestamp>now)
    .sort((a,b)=>a.target.timestamp-b.target.timestamp)[0];
  if(!upcoming){
    return "<section class='countdown-panel countdown-muted'><div><span class='eyebrow'>UPCOMING RACE COUNTDOWN</span><h2>Season complete</h2><p>No later event with a confirmed date is listed in this season's calendar.</p></div></section>";
  }
  const {event,target}=upcoming;
  const location=event.Circuit&&event.Circuit.Location||{};
  const venue=[location.locality,location.country].filter(Boolean).join(", ");
  const dateText=new Date(target.timestamp).toLocaleString("en-GB",{weekday:"short",day:"numeric",month:"short",year:"numeric",hour:target.label==="RACE START"?"2-digit":undefined,minute:target.label==="RACE START"?"2-digit":undefined});
  return "<section class='countdown-panel' id='nextRaceCountdown' data-target='"+target.timestamp+"'>"+
    "<div class='countdown-info'><span class='eyebrow'>NEXT "+(target.label==="RACE START"?"RACE":"RACE WEEKEND")+"</span><h2>"+esc(event.raceName)+"</h2><p>"+esc([seriesLabel(state.series),venue,"Round "+event.round].filter(Boolean).join(" · "))+"</p><small>"+esc(dateText)+" · "+esc(target.precision)+"</small>"+
    "<a class='countdown-link' href='"+raceHref(state.series,state.season,event.round)+"'>Open event centre ↗</a></div>"+
    "<div class='countdown-clock' aria-live='off'><div><strong id='countdownDays'>—</strong><span>DAYS</span></div><b>:</b><div><strong id='countdownHours'>—</strong><span>HRS</span></div><b>:</b><div><strong id='countdownMinutes'>—</strong><span>MINS</span></div><b>:</b><div><strong id='countdownSeconds'>—</strong><span>SECS</span></div></div></section>";
}
function startCountdown(){
  if(state.countdownTimer){clearInterval(state.countdownTimer);state.countdownTimer=null;}
  const panel=$("nextRaceCountdown");
  if(!panel)return;
  const target=Number(panel.dataset.target);
  if(!Number.isFinite(target))return;
  const update=()=>{
    const remaining=target-Date.now();
    if(remaining<=0){
      for(const id of ["countdownDays","countdownHours","countdownMinutes","countdownSeconds"]){
        const element=$(id);if(element)element.textContent="00";
      }
      const eyebrow=panel.querySelector(".countdown-info .eyebrow");
      if(eyebrow)eyebrow.textContent="EVENT STARTED";
      return;
    }
    const total=Math.floor(remaining/1000);
    const values={
      countdownDays:Math.floor(total/86400),
      countdownHours:Math.floor(total%86400/3600),
      countdownMinutes:Math.floor(total%3600/60),
      countdownSeconds:total%60
    };
    for(const [id,value] of Object.entries(values)){
      const element=$(id);if(element)element.textContent=String(value).padStart(2,"0");
    }
  };
  update();
  state.countdownTimer=setInterval(update,1000);
}
async function renderSeasonOverview(){
  const data=state.data,events=availableEvents(data),drivers=data.driverStandings||[],teams=data.constructorStandings||[];
  const leader=drivers[0],topTeam=teams[0];
  const next=events.find(e=>!eventHasResults(e))||events[events.length-1];
  const latest=events.slice(-5).reverse();
  const driverRows=drivers.slice(0,10).map(e=>"<tr><td class='rank'>"+esc(e.position||"—")+"</td><td>"+driverLink(state.series,e.Driver&&e.Driver.driverId,driverName(e.Driver))+"</td><td>"+esc((e.Constructors||[]).map(c=>c.name).join(", ")||"—")+"</td><td class='num'>"+esc(e.wins==null?"—":e.wins)+"</td><td class='num'>"+esc(number(e.points))+"</td></tr>");
  const teamRows=teams.slice(0,8).map(e=>"<tr><td class='rank'>"+esc(e.position||"—")+"</td><td>"+teamLink(state.series,(e.Constructor||{}).constructorId||slug(e.Constructor&&e.Constructor.name),e.Constructor&&e.Constructor.name)+"</td><td class='num'>"+esc(number(e.points))+"</td></tr>");
  return "<section class='hero'><div class='hero-kicker'><span class='red-line'></span> HISTORICAL MOTORSPORT ANALYTICS · "+esc(state.season)+"</div><div class='hero-layout'><div><h1>Every lap has<br><em>a story.</em></h1><p class='hero-copy'>Explore the people, teams, circuits and races behind "+esc(seriesLabel(state.series))+". From championship tables to individual race reports, this is your motorsport data lab.</p></div><div class='hero-side'><span>THE ARCHIVE</span><strong>"+esc(data.season||state.season)+"</strong><small>SELECTED SEASON</small></div></div></section>"+
  countdownMarkup(events)+
  "<div class='kpi-grid'>"+kpi("Events in season",events.length,"Scheduled and recorded rounds")+kpi("Drivers in standings",drivers.length,"Season championship table")+kpi("Constructors",teams.length,"Team standings entries")+kpi("Championship leader",leader?driverName(leader.Driver):"—",leader?number(leader.points)+" points":"No standings", "accent")+"</div>"+
  "<div class='grid-2'>"+panel("CHAMPIONSHIP","Driver leaderboard",table(["POS","DRIVER","CONSTRUCTOR","WINS","POINTS"],driverRows),"<a class='text-link' href='#/drivers'>All drivers ↗</a>")+panel("CONSTRUCTOR BATTLE","Team standings",table(["POS","CONSTRUCTOR","POINTS"],teamRows),"<a class='text-link' href='#/teams'>All teams ↗</a>")+"</div>"+
  "<div class='grid-2'>"+panel("SEASON SCHEDULE","Race calendar","<div class='event-list'>"+latest.map(e=>eventCard(state.series,state.season,e)).join("")+"</div>","<a class='text-link' href='#/calendar'>Full calendar ↗</a>")+panel("QUICK EXPLORE","Open a database","<div class='event-list'>"+[
    ["Drivers","Browse every driver and open a career profile","/drivers"],
    ["Constructors","Explore team histories and driver line-ups","/teams"],
    ["Circuits","Discover tracks and historical event facts","/circuits"],
    ["Predictions","Explore the research-only race form model","/predictions"]
  ].map(x=>"<a class='event-row' href='#"+x[2]+"'><span class='event-round'>↗</span><span class='event-main'><strong>"+x[0]+"</strong><small>"+x[1]+"</small></span></a>").join("")+"</div>")+"</div>"+
  "<div class='notice'>Season pages only display verified fields. If a historic F2/F3 source supplies winners but not full classifications, the race centre will say so rather than inventing finishing positions.</div>";
}
function formatNewsDate(value){
  const date=new Date(value);
  return Number.isNaN(date.getTime())?"Date not supplied":date.toLocaleString("en-GB",{day:"numeric",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit",timeZone:"Europe/London"});
}
function applyNewsFilters(){
  const query=String(state.newsSearch||"").toLowerCase().trim();
  const cards=[...document.querySelectorAll(".news-card")];
  let visible=0;
  cards.forEach(card=>{
    const seriesOk=state.newsSeriesFilter==="all"||card.dataset.series===state.newsSeriesFilter;
    const searchOk=!query||(card.dataset.search||"").includes(query);
    const show=seriesOk&&searchOk;
    card.classList.toggle("hidden",!show);
    if(show)visible++;
  });
  const empty=$("newsEmpty");
  if(empty){
    empty.classList.toggle("hidden",visible>0);
    empty.textContent=cards.length?"No stories match the selected championship or search.":"No headlines are available in the cached feed yet. The scheduled importer will retry.";
  }
}
function renderNews(snapshot){
  const articles=Array.isArray(snapshot.articles)?snapshot.articles:[];
  const filters=[["all","ALL"],["f1","F1"],["f2","F2"],["f3","F3"]];
  const filterMarkup=filters.map(([value,label])=>
    "<button class='news-filter "+(state.newsSeriesFilter===value?"active":"")+"' type='button' data-news-series='"+value+"'>"+label+"</button>"
  ).join("");
  const cards=articles.map(article=>{
    const series=String(article.series||"").toLowerCase();
    const seriesLabel=SERIES[series]?.label||"Motorsport";
    const shortSeries=["f1","f2","f3"].includes(series)?series.toUpperCase():"NEWS";
    const title=String(article.title||"Untitled story");
    const summary=String(article.summary||"");
    const source=String(article.source||"Crash.net");
    const link=String(article.link||"");
    const safeLink=/^https?:\/\//i.test(link)?link:"";
    const searchable=[title,summary,seriesLabel,source].join(" ").toLowerCase();
    const date=article.published?formatNewsDate(article.published):"Date not supplied";
    return "<article class='news-card' data-series='"+esc(series)+"' data-search='"+esc(searchable)+"'>"+
      "<div class='news-card-meta'><span class='news-series-pill'>"+esc(shortSeries)+"</span><span>"+esc(source)+"</span><time datetime='"+esc(article.published||"")+"'>"+esc(date)+"</time></div>"+
      "<h2>"+esc(title)+"</h2>"+
      (summary?"<p>"+esc(summary)+"</p>":"")+
      (safeLink?"<a class='news-link' href='"+esc(safeLink)+"' target='_blank' rel='noopener noreferrer'>Read on "+esc(source)+" ↗</a>":"")+
      "</article>";
  }).join("");
  const stale=Object.entries(snapshot.feedStatus||{}).filter(([,value])=>value!=="ok").map(([key])=>key.toUpperCase());
  const warning=stale.length?" Some feeds were unavailable during the last update; their previous headlines have been retained ("+esc(stale.join(", "))+").":"";
  const updated=snapshot.updatedAt?formatNewsDate(snapshot.updatedAt):"Awaiting first import";
  return pageHead("MOTORSPORT NEWS","Latest news","Search stories and filter the feed by championship. Headlines and short feed summaries are credited to the publisher.")+
    "<div class='news-toolbar'><div class='news-filters' aria-label='Filter news by championship'>"+filterMarkup+"</div>"+
    "<label class='news-search'><span>SEARCH STORIES</span><input class='search-input' id='newsSearch' type='search' value='"+esc(state.newsSearch)+"' placeholder='Driver, team, topic…'></label></div>"+
    "<div class='news-feed-info'><span>"+articles.length+" stories in the latest snapshot</span><span>Updated: "+esc(updated)+" · Source: Crash.net RSS</span></div>"+
    (warning?"<div class='notice'>"+warning+"</div>":"")+
    "<div class='news-grid'>"+cards+"</div>"+
    "<div class='empty-state "+(articles.length?"hidden":"")+"' id='newsEmpty'>"+(articles.length?"No stories match the selected championship or search.":"No headlines are available in the cached feed yet. The scheduled importer will retry.")+"</div>";
}
function renderDashboard(){
  const cards=[
    ["📊","CORE STATISTICS","Season Overview","Championship standings, driver and constructor battles, season totals and key performance statistics.","overview"],
    ["🏁","RACE SCHEDULE","Race Calendar","Browse the Formula 1, Formula 2 and Formula 3 calendars, upcoming rounds and completed events.","calendar"],
    ["📰","MOTORSPORT NEWS","Latest News","Follow F1, F2 and F3 headlines in one searchable feed, with every story linked to its publisher.","news"],
    ["🏎️","DRIVER DATABASE","Driver Profiles","Search driver profiles, explore career progression, season statistics, teams and race histories.","drivers"],
    ["🏆","TEAM DATABASE","Constructor Database","Explore constructor histories, championship performance, line-ups and team statistics across seasons.","teams"],
    ["🏎","CIRCUIT DATABASE","Circuit Explorer","Discover circuits, locations, race histories and the statistics behind each venue.","circuits"],
    ["📋","RACE WEEKENDS","Race Centre","Open race weekends and inspect available practice, qualifying, sprint and race classifications.","race-centre"],
    ["🎯","MODEL EVALUATION","Prediction Lab","Explore model-based race forecasts, historical backtests and prediction performance.","predictions"],
    ["⇄","COMPARISON TOOLS","Comparisons","Compare drivers and constructors across seasons with head-to-head statistics and performance trends.","comparisons"],
    ["🏅","HISTORICAL RESEARCH","Records & Milestones","Find championship milestones, career records, race records and all-time statistical leaders.","records"],
    ["📈","DEEP ANALYTICS","Advanced Analytics","Investigate progression, performance metrics, historical trends and configurable statistical analyses.","analytics"],
    ["🗂️","RELIABILITY","Data Centre","Review archive coverage, update timestamps, source information and incomplete or missing session data.","data-centre"],
    ["⭐","PERSONAL TRACKING","Watchlist","Save favourite drivers and teams and return to their latest career and season statistics.","watchlist"],
    ["⬇","DATA OUTPUT","Export Centre","Download season standings, complete race-session results, calendars and career statistic tables.","exports"]
  ];
  return "<section class='platform-heading'><div><h1>Explore the platform</h1><p>Choose a tool based on what you want to investigate.</p></div></section>"+
    "<div class='platform-grid'>"+cards.map(card=>
      "<a class='platform-card' href='#/"+card[4]+"' aria-label='"+esc(card[2])+": "+esc(card[3])+"'>"+
        "<div class='platform-card-top'><span class='platform-icon' aria-hidden='true'>"+card[0]+"</span><span class='platform-category'>"+esc(card[1])+"</span><span class='platform-arrow' aria-hidden='true'>↗</span></div>"+
        "<h2>"+esc(card[2])+"</h2><p>"+esc(card[3])+"</p>"+
      "</a>"
    ).join("")+"</div>";
}
async function renderCalendar(){
  const events=availableEvents(state.data);
  const races=events.map(e=>eventCard(state.series,state.season,e)).join("");
  const completed=events.filter(eventHasResults).length;
  return pageHead("SEASON SCHEDULE",seriesLabel(state.series)+" calendar", "Choose a round to open its race centre. Some historic F2/F3 event dates are not present in the source archive.")+
    "<div class='kpi-grid'>"+kpi("Rounds listed",events.length,"Events in selected season")+kpi("With result data",completed,"At least one classified result")+kpi("Without result data",events.length-completed,"Scheduled or summary-only entries")+kpi("Season",state.season,"Change using the selector above")+"</div>"+
    "<div class='panel'><div class='panel-header'><div><span class='eyebrow'>ROUND BY ROUND</span><h2>Season events</h2></div><span class='badge'>"+esc(seriesLabel(state.series))+" · "+esc(state.season)+"</span></div><div class='event-list'>"+(races||"<div class='empty-state'>No events have been archived for this season.</div>")+"</div></div>";
}
async function renderDrivers(){
  const idx=await getIndex(state.series,"drivers");
  const cards=idx.drivers.map(d=>"<a class='entity-card searchable' data-search='"+esc((d.name+" "+d.nationality+" "+d.code).toLowerCase())+"' href='"+driverHref(state.series,d.id)+"'><div class='card-top'>"+badge(d.nationality||"Nationality not supplied")+"<span class='secondary'>"+esc(d.code||"DRIVER")+"</span></div><h3>"+esc(d.name)+"</h3><p>"+esc(d.seasons)+" seasons · "+esc(d.firstSeason||"—")+"–"+esc(d.lastSeason||"—")+"</p><div class='entity-meta'>"+badge("Titles "+number(d.championships),"gold")+badge("Wins "+(d.wins==null?"—":d.wins+(d.winsComplete?"":"+")),"green")+badge("Podiums "+number(d.podiums))+"</div></a>").join("");
  return pageHead("DRIVER DATABASE",seriesLabel(state.series)+" drivers","Search drivers, open their profiles and explore each season of their career.")+
    "<div class='panel'><div class='search-row'><input class='search-input' id='entitySearch' type='search' placeholder='Search driver, nationality or code…'><span class='result-count'>"+idx.drivers.length+" DRIVER PROFILES</span></div><div class='card-grid' id='entityList'>"+cards+"</div></div>";
}
async function renderDriverProfile(series,id){
  if(!SERIES[series]||!id)throw new Error("Driver profile link is invalid.");
  const p=await getProfile(series,"drivers",id);
  const c=p.career||{},seasons=p.seasons||[],results=p.results||[];
  const mostRecent=results.slice(-12).reverse();
  const resultRows=mostRecent.map(r=>"<tr><td>"+esc(r.season)+"</td><td><a class='person-link' href='"+raceHref(series,r.season,r.round)+"'>"+esc(r.raceName)+"</a><div class='secondary'>"+esc(r.session)+"</div></td><td>"+esc(r.circuitName)+"</td><td class='num rank'>"+esc(r.position==null?"—":r.position)+"</td><td>"+esc(r.team||"—")+"</td><td class='num'>"+esc(number(r.points))+"</td></tr>");
  const teamHistory=[...new Set(seasons.flatMap(s=>s.constructors||[]))];
  const maxPoints=Math.max(1,...seasons.map(s=>s.points||0));
  const timeline=seasons.slice().reverse().map(s=>"<div class='season-item'><strong>"+esc(s.season)+"<small>"+esc(s.position==null?"Position unavailable":"P"+s.position)+"</small></strong><div><div class='secondary'>"+esc((s.constructors||[]).join(", ")||"Constructor not linked")+" · "+esc(number(s.points))+" pts</div><div class='mini-bar'><span style='width:"+Math.max(2,Math.min(100,(s.points||0)/maxPoints*100))+"%'></span></div></div>"+badge(s.position===1?"Champion":s.coverage||"Season")+"</div>").join("");
  const knownWins=c.wins==null?"—":c.wins+(c.winsComplete?"":"*");
  return pageHead("DRIVER PROFILE",p.name, [p.nationality,seriesLabel(series)+" career",c.firstSeason+"–"+c.lastSeason].filter(Boolean).join(" · "),"<a class='text-link' href='#/drivers'>← All drivers</a><button type='button' class='watch-toggle' data-watch='drivers' data-series='"+esc(series)+"' data-id='"+esc(id)+"'>"+(isWatchlisted("drivers",series,id)?"★ Saved to watchlist":"☆ Add to watchlist")+"</button>")+
    "<div class='profile-hero'><div><span class='eyebrow'>CAREER ARCHIVE · "+esc(seriesLabel(series))+"</span><h1>"+esc(p.name)+"</h1><p>"+esc(p.nationality||"Nationality not in source")+(p.code?" · "+esc(p.code):"")+(p.number?" · Permanent number #"+esc(p.number):"")+"</p><div class='entity-meta'>"+teamHistory.slice(0,8).map(t=>badge(t)).join("")+"</div></div><div class='profile-number'>"+esc(p.number||"N/A")+"<small class='secondary'>"+(p.number?"PERMANENT NO.":"NO PERMANENT NUMBER ASSIGNED")+"</small></div></div>"+
    "<div class='profile-metrics'>"+metric("Championships",number(c.championships),"Season titles in archive")+metric("Race wins",knownWins,c.winsComplete?"Career total":"Available-source total*")+metric("Podiums",c.podiums==null?"—":c.podiums+(c.podiumsComplete?"":"*"),c.podiumsComplete?"Derived from full classifications":"Available-source total*")+metric("Points",c.points==null?"—":number(c.points),"Raw historical championship points")+"</div>"+
    "<div class='grid-2'>"+panel("CAREER TIMELINE","Season-by-season performance","<div class='season-list'>"+(timeline||"<div class='empty-state'>No season history.</div>")+"</div>")+panel("CAREER OVERVIEW","Profile details","<div class='fact-grid'>"+[
      ["Seasons competed",c.seasons],["First season",c.firstSeason||"—"],["Last season",c.lastSeason||"—"],["Classified results",c.classifiedResults],["Fastest laps",c.fastestLaps==null?"—":c.fastestLaps+(c.fastestLapsComplete?"":"*")],["Pole starts",c.poleStarts==null?"—":c.poleStarts+(c.poleStartsComplete?"":"*")]
    ].map(x=>"<div class='fact'><span>"+esc(x[0])+"</span><strong>"+esc(number(x[1]))+"</strong></div>").join("")+"</div><p class='secondary'>* Available-source total. Pole starts count cars that started from grid position one; this is not a substitute for an official qualifying pole record. Historical points systems also changed over time.</p>")+"</div>"+
    panel("RACE HISTORY","Most recent indexed results",table(["SEASON","EVENT / SESSION","CIRCUIT","POS","CONSTRUCTOR","POINTS"],resultRows),"<span class='secondary'>"+results.length+" result rows in profile archive</span>");
}
async function renderTeams(){
  const idx=await getIndex(state.series,"teams");
  const cards=idx.teams.map(t=>"<a class='entity-card searchable' data-search='"+esc((t.name+" "+t.nationality).toLowerCase())+"' href='"+teamHref(state.series,t.id)+"'><div class='card-top'>"+badge(t.nationality||"Nationality not supplied")+"<span class='secondary'>"+esc(t.firstSeason||"—")+"–"+esc(t.lastSeason||"—")+"</span></div><h3>"+esc(t.name)+"</h3><p>"+esc(t.seasons)+" seasons in the indexed archive</p><div class='entity-meta'>"+badge("Titles "+number(t.championships),"gold")+badge("Wins "+(t.wins==null?"—":t.wins+(t.winsComplete?"":"+")),"green")+badge("Points "+number(t.points))+"</div></a>").join("");
  return pageHead("CONSTRUCTOR DATABASE",seriesLabel(state.series)+" constructors","Explore team profiles, championship history, driver line-ups and results.")+
    "<div class='panel'><div class='search-row'><input class='search-input' id='entitySearch' type='search' placeholder='Search constructor or nationality…'><span class='result-count'>"+idx.teams.length+" CONSTRUCTOR PROFILES</span></div><div class='card-grid' id='entityList'>"+cards+"</div></div>";
}
async function renderTeamProfile(series,id){
  const p=await getProfile(series,"teams",id),c=p.career||{},seasons=p.seasons||[],results=p.results||[];
  const maxPoints=Math.max(1,...seasons.map(s=>s.points||0));
  const timeline=seasons.slice().reverse().map(s=>"<div class='season-item'><strong>"+esc(s.season)+"<small>"+esc(s.position==null?"Position unavailable":"P"+s.position)+"</small></strong><div><div class='secondary'>"+esc(number(s.points))+" pts · "+esc(s.wins==null?"—":s.wins)+" wins</div><div class='mini-bar'><span style='width:"+Math.max(2,Math.min(100,(s.points||0)/maxPoints*100))+"%'></span></div></div>"+badge(s.position===1?"Champion":"Season")+"</div>").join("");
  const drivers=(p.drivers||[]).map(d=>"<a class='entity-card' href='"+driverHref(series,d.id)+"'><h3>"+esc(d.name)+"</h3><p>Open driver profile ↗</p></a>").join("");
  const resultRows=results.slice(-15).reverse().map(r=>"<tr><td>"+esc(r.season)+"</td><td><a class='person-link' href='"+raceHref(series,r.season,r.round)+"'>"+esc(r.raceName)+"</a></td><td>"+esc(r.session)+"</td><td>"+driverLink(series,r.driverId,r.driverName)+"</td><td class='num'>"+esc(r.position==null?"—":r.position)+"</td><td class='num'>"+esc(number(r.points))+"</td></tr>");
  return pageHead("CONSTRUCTOR PROFILE",p.name,[seriesLabel(series)+" history",c.firstSeason+"–"+c.lastSeason].join(" · "),"<a class='text-link' href='#/teams'>← All constructors</a><button type='button' class='watch-toggle' data-watch='teams' data-series='"+esc(series)+"' data-id='"+esc(id)+"'>"+(isWatchlisted("teams",series,id)?"★ Saved to watchlist":"☆ Add to watchlist")+"</button>")+
    "<div class='profile-hero'><div><span class='eyebrow'>TEAM ARCHIVE</span><h1>"+esc(p.name)+"</h1><p>"+esc(p.nationality||"Nationality not supplied")+" · "+esc(c.seasons)+" seasons in the archive</p></div><div class='profile-number'>"+esc(c.championships||0)+"<small class='secondary'> TITLES</small></div></div>"+
    "<div class='profile-metrics'>"+metric("Championships",number(c.championships),"Season titles")+metric("Race wins",c.wins==null?"—":c.wins+(c.winsComplete?"":"*"),"Available-source total")+metric("Podiums",c.podiums==null?"—":c.podiums,"Where classified")+metric("Points",c.points==null?"—":number(c.points),"Across indexed seasons")+"</div>"+
    "<div class='grid-2'>"+panel("TEAM HISTORY","Season-by-season", "<div class='season-list'>"+timeline+"</div>")+panel("DRIVER LINE-UP","Drivers associated with this team","<div class='card-grid'>"+drivers+"</div>")+"</div>"+
    panel("RACE ARCHIVE","Latest team results",table(["SEASON","EVENT","SESSION","DRIVER","POS","POINTS"],resultRows));
}
async function renderWatchlist(){
  const [driverIndex,teamIndex]=await Promise.all([
    getIndex(state.series,"drivers"),getIndex(state.series,"teams")
  ]);
  const driverIds=new Set(state.watchlist.drivers.filter(x=>x.startsWith(state.series+":")).map(x=>x.slice(state.series.length+1)));
  const teamIds=new Set(state.watchlist.teams.filter(x=>x.startsWith(state.series+":")).map(x=>x.slice(state.series.length+1)));
  const driverCards=driverIndex.drivers.filter(x=>driverIds.has(x.id)).map(d=>
    "<article class='watch-card'><a href='"+driverHref(state.series,d.id)+"'><span class='eyebrow'>DRIVER</span><h3>"+esc(d.name)+"</h3><p>"+esc(d.nationality||"Nationality not supplied")+" · "+esc(d.firstSeason)+"–"+esc(d.lastSeason)+"</p><div class='entity-meta'>"+badge("Wins "+number(d.wins))+badge("Titles "+number(d.championships),"gold")+"</div></a><button type='button' class='watch-remove' data-watch='drivers' data-series='"+esc(state.series)+"' data-id='"+esc(d.id)+"'>Remove</button></article>"
  ).join("");
  const teamCards=teamIndex.teams.filter(x=>teamIds.has(x.id)).map(t=>
    "<article class='watch-card'><a href='"+teamHref(state.series,t.id)+"'><span class='eyebrow'>CONSTRUCTOR</span><h3>"+esc(t.name)+"</h3><p>"+esc(t.nationality||"Nationality not supplied")+" · "+esc(t.firstSeason)+"–"+esc(t.lastSeason)+"</p><div class='entity-meta'>"+badge("Wins "+number(t.wins))+badge("Titles "+number(t.championships),"gold")+"</div></a><button type='button' class='watch-remove' data-watch='teams' data-series='"+esc(state.series)+"' data-id='"+esc(t.id)+"'>Remove</button></article>"
  ).join("");
  return pageHead("PERSONAL TRACKING","Your watchlist","Saved in this browser only. Switch the championship above to see saved entries for another series.")+
    "<div class='grid-2'><section class='panel'><div class='panel-header'><div><span class='eyebrow'>SAVED DRIVERS</span><h2>"+driverIds.size+" drivers</h2></div></div><div class='watch-grid'>"+(driverCards||"<div class='empty-state'>No drivers saved for "+esc(seriesLabel(state.series))+". Open a driver profile and select Add to watchlist.</div>")+"</div></section>"+
    "<section class='panel'><div class='panel-header'><div><span class='eyebrow'>SAVED CONSTRUCTORS</span><h2>"+teamIds.size+" teams</h2></div></div><div class='watch-grid'>"+(teamCards||"<div class='empty-state'>No constructors saved for "+esc(seriesLabel(state.series))+". Open a constructor profile and select Add to watchlist.</div>")+"</div></section></div>"+
    "<p class='secondary'>Your watchlist uses browser storage. It is not synced between devices or browsers.</p>";
}
function csvCell(value){
  const textValue=value==null?"":typeof value==="object"?JSON.stringify(value):String(value);
  return '"'+textValue.replace(/"/g,'""')+'"';
}
function rowsToCsv(headers,rows){
  return [headers.map(csvCell).join(","),...rows.map(row=>headers.map(h=>csvCell(row[h])).join(","))].join("\r\n");
}
function downloadExport(content,filename,mime){
  const blob=new Blob([content],{type:mime});
  const url=URL.createObjectURL(blob);
  const link=document.createElement("a");
  link.href=url;link.download=filename;document.body.appendChild(link);link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function runDataExport(kind){
  const data=state.data||await getSeason(state.series,state.season);
  const prefix=state.series.toUpperCase()+"-"+state.season;
  let filename="",content="",mime="text/csv;charset=utf-8";
  if(kind==="driver-standings"){
    const rows=(data.driverStandings||[]).map(r=>({position:r.position,driver:driverName(r.Driver),driverId:r.Driver&&r.Driver.driverId,constructor:(r.Constructors||[]).map(c=>c.name).join(" / "),points:r.points,wins:r.wins}));
    filename=prefix+"-driver-standings.csv";content=rowsToCsv(["position","driver","driverId","constructor","points","wins"],rows);
  }else if(kind==="constructor-standings"){
    const rows=(data.constructorStandings||[]).map(r=>({position:r.position,constructor:r.Constructor&&r.Constructor.name,constructorId:r.Constructor&&r.Constructor.constructorId,points:r.points,wins:r.wins}));
    filename=prefix+"-constructor-standings.csv";content=rowsToCsv(["position","constructor","constructorId","points","wins"],rows);
  }else if(kind==="race-results"){
    const rows=[];
    for(const event of data.races||[])for(const result of event.Results||[]){
      if(result.isRecordOnly)continue;
      rows.push({series:state.series,season:state.season,round:event.round,event:event.raceName,circuit:event.Circuit&&event.Circuit.circuitName,session:result.session||"Race",position:result.position,driver:driverName(result.Driver),driverId:result.Driver&&result.Driver.driverId,constructor:result.Constructor&&result.Constructor.name,grid:result.grid,laps:result.laps,time:result.Time&&result.Time.time,gap:result.gap,points:result.points,status:result.status,fastestLap:result.FastestLap&&result.FastestLap.Time&&result.FastestLap.Time.time});
    }
    filename=prefix+"-race-session-results.csv";content=rowsToCsv(["series","season","round","event","circuit","session","position","driver","driverId","constructor","grid","laps","time","gap","points","status","fastestLap"],rows);
  }else if(kind==="calendar"){
    const rows=availableEvents(data).map(e=>({series:state.series,season:state.season,round:e.round,event:e.raceName,circuit:e.Circuit&&e.Circuit.circuitName,date:e.date,location:[e.Circuit&&e.Circuit.Location&&e.Circuit.Location.locality,e.Circuit&&e.Circuit.Location&&e.Circuit.Location.country].filter(Boolean).join(", ")}));
    filename=prefix+"-calendar.csv";content=rowsToCsv(["series","season","round","event","circuit","date","location"],rows);
  }else if(kind==="season-json"){
    filename=prefix+"-full-archive.json";mime="application/json;charset=utf-8";content=JSON.stringify(data,null,2);
  }else if(kind==="career-drivers"||kind==="career-teams"){
    const kindName=kind==="career-drivers"?"drivers":"teams";
    const index=await getIndex(state.series,kindName);
    const rows=kindName==="drivers"?index.drivers.map(d=>({name:d.name,nationality:d.nationality,firstSeason:d.firstSeason,lastSeason:d.lastSeason,championships:d.championships,wins:d.wins,podiums:d.podiums,poles:d.poles,fastestLaps:d.fastestLaps,points:d.points,starts:d.eventResults,winRatePct:d.winRate,maxConsecutiveWins:d.maxConsecutiveWins})):index.teams.map(t=>({name:t.name,nationality:t.nationality,firstSeason:t.firstSeason,lastSeason:t.lastSeason,championships:t.championships,wins:t.wins,podiums:t.podiums,points:t.points}));
    const headers=Object.keys(rows[0]||{name:""});
    filename=state.series.toUpperCase()+"-"+kindName+"-career-statistics.csv";content=rowsToCsv(headers,rows);
  }else{
    throw new Error("Unknown export type.");
  }
  downloadExport(content,filename,mime);
  status("good","EXPORT READY");notice("Downloaded "+filename,"good");
}
function renderExportCentre(){
  const item=(kind,title,description)=>"<button type='button' class='export-item' data-export='"+kind+"'><span><strong>"+title+"</strong><small>"+description+"</small></span><b>↓</b></button>";
  return pageHead("DATA OUTPUT","Export Centre","Download the selected "+seriesLabel(state.series)+" "+state.season+" archive or cross-season career tables.")+
    "<div class='grid-2'><section class='panel'><div class='panel-header'><div><span class='eyebrow'>SELECTED SEASON</span><h2>"+esc(state.season)+" exports</h2></div></div><div class='export-list'>"+
      item("driver-standings","Driver standings CSV","Positions, constructors, wins and points")+
      item("constructor-standings","Constructor standings CSV","Team positions, wins and points")+
      item("race-results","Race and session results CSV","Practice, qualifying, sprint and race rows where imported")+
      item("calendar","Season calendar CSV","Rounds, circuits, dates and locations")+
      item("season-json","Full season archive JSON","Complete source snapshot as stored")+
    "</div></section><section class='panel'><div class='panel-header'><div><span class='eyebrow'>CROSS-SEASON</span><h2>Career statistics</h2></div></div><div class='export-list'>"+
      item("career-drivers","Driver career statistics CSV","Career records and source coverage totals")+
      item("career-teams","Constructor career statistics CSV","Championships, wins, podiums and points")+
    "</div><p class='secondary'>Exports contain only fields present in the imported archive. Missing source values remain blank; they are not converted to zero.</p></section></div>";
}

async function renderCircuits(){
  const idx=await getIndex(state.series,"circuits");
  const cards=idx.circuits.map(c=>"<a class='entity-card searchable' data-search='"+esc((c.name+" "+(c.location?.locality||"")+" "+(c.location?.country||"")).toLowerCase())+"' href='"+circuitHref(c.id)+"'><div class='card-top'>"+badge((c.location&&c.location.country)||c.series.join(" / "))+"<span class='secondary'>"+esc(c.firstSeason)+"–"+esc(c.lastSeason)+"</span></div><h3>"+esc(c.name)+"</h3><p>"+esc(c.eventCount)+" events represented in the archive</p><div class='entity-meta'>"+badge("Most recorded wins: "+(c.topWinner?c.topWinner.driverName:"—"),"gold")+"</div></a>").join("");
  return pageHead("CIRCUIT DATABASE","Circuits & venues","Browse tracks from the historical archive. Track facts are calculated from stored events; unavailable physical specifications are not guessed.")+
    "<div class='panel'><div class='search-row'><input class='search-input' id='entitySearch' type='search' placeholder='Search circuit, city or country…'><span class='result-count'>"+idx.circuits.length+" CIRCUITS</span></div><div class='card-grid' id='entityList'>"+cards+"</div></div>";
}
async function renderCircuitProfile(id){
  const p=await getProfile(state.series,"circuits",id),events=p.events||[];
  const wins=p.mostWins||[];
  const sessions=events.reduce((sum,e)=>sum+(e.sessions||[]).length,0);
  const winnerRows=wins.map((w,i)=>"<tr><td class='rank'>"+(i+1)+"</td><td>"+driverLink(state.series,w.driverId,w.driverName)+"</td><td class='num'>"+esc(w.wins)+"</td></tr>");
  const eventRows=events.slice().reverse().slice(0,30).map(e=>"<tr><td>"+esc(e.series.toUpperCase())+"</td><td>"+esc(e.season)+"</td><td>"+esc(e.round||"—")+"</td><td><a class='person-link' href='"+raceHref(e.series,e.season,e.round)+"'>"+esc(e.raceName)+"</a></td><td>"+esc(niceDate(e.date))+"</td><td>"+esc(e.sessions.join(" / ")||"Result not in source")+"</td></tr>");
  const location=p.location||{};
  return pageHead("CIRCUIT PROFILE",p.name,[location.locality,location.country].filter(Boolean).join(", ")||"Location not supplied in imported data","<a class='text-link' href='#/circuits'>← All circuits</a>")+
    "<div class='profile-hero'><div><span class='eyebrow'>TRACK ARCHIVE</span><h1>"+esc(p.name)+"</h1><p>"+esc([location.locality,location.country].filter(Boolean).join(" · ")||"Track location not in archive")+" · "+esc((p.series||[]).join(" / ").toUpperCase())+"</p>"+(p.url?"<a class='text-link' href='"+esc(p.url)+"' target='_blank' rel='noopener'>Circuit reference ↗</a>":"")+"</div><div class='profile-number'>"+esc(p.eventCount)+"<small class='secondary'> EVENTS</small></div></div>"+
    "<div class='fact-grid'>"+[
      ["Events in archive",p.eventCount],["Years represented",(p.firstSeason||"—")+"–"+(p.lastSeason||"—")],["Session classifications",sessions],["Most recorded wins",wins[0]?wins[0].driverName:"—"],["Recorded wins by leader",wins[0]?wins[0].wins:"—"],["Series represented",(p.series||[]).join(", ").toUpperCase()]
    ].map(x=>"<div class='fact'><span>"+esc(x[0])+"</span><strong>"+esc(x[1])+"</strong></div>").join("")+"</div>"+
    "<div class='grid-2'>"+panel("CIRCUIT RECORDS","Most recorded winners",table(["RANK","DRIVER","WINS IN ARCHIVE"],winnerRows))+panel("TRACK FACTS","What the archive can verify","<div class='notice'>These facts are calculated from this project's imported race archive. Track length, corner count, official lap record and opening date are not currently in the connected datasets, so they are not displayed as facts.</div><p class='secondary'>First indexed season: "+esc(p.firstSeason)+"</p><p class='secondary'>Most recent indexed season: "+esc(p.lastSeason)+"</p><p class='secondary'>Series represented: "+esc((p.series||[]).join(", ").toUpperCase())+"</p>")+"</div>"+
    panel("EVENT HISTORY","Races at this circuit",table(["SERIES","SEASON","ROUND","EVENT","DATE","SESSIONS"],eventRows));
}
function sessionNames(event,series=state.series){
  const actual=[...new Set((event.Results||[]).filter(r=>!r.isRecordOnly).map(r=>r.session||"Race"))];
  if(series==="f1"){
    const options=[];
    const has=(label,field)=>actual.includes(label)||!!event[field];
    if(has("Practice 1","FirstPractice"))options.push("Practice 1");
    if(has("Practice 2","SecondPractice"))options.push("Practice 2");
    if(has("Practice 3","ThirdPractice"))options.push("Practice 3");
    if(has("Sprint Qualifying","SprintQualifying")||actual.includes("Sprint Shootout")||event.SprintShootout)options.push("Sprint Qualifying");
    if(has("Qualifying","Qualifying"))options.push("Qualifying");
    if(has("Sprint","Sprint"))options.push("Sprint");
    options.push("Race");
    for(const session of actual)if(!options.includes(session))options.splice(options.length-1,0,session);
    return options;
  }
  const supplied=Array.isArray(event.sessionTypes)?event.sessionTypes:[];
  const splitFeature=supplied.includes("Feature Race 1")||supplied.includes("Feature Race 2")||actual.includes("Feature Race 1")||actual.includes("Feature Race 2");
  const canonical=["Practice","Qualifying","Sprint Race",...(splitFeature?["Feature Race 1","Feature Race 2"]:["Feature Race"])];
  const result=[];
  for(const session of [...canonical,...supplied,...actual]){
    if(!result.includes(session))result.push(session);
  }
  return result;
}
function sessionHasResults(event,session){
  return (event.Results||[]).some(row=>!row.isRecordOnly&&(row.session||"Race")===session&&row.Driver);
}
function sessionScheduleInfo(event,series,session){
  if(series==="f1"){
    const fields={
      "Practice 1":"FirstPractice","Practice 2":"SecondPractice","Practice 3":"ThirdPractice",
      "Qualifying":"Qualifying","Sprint":"Sprint","Sprint Qualifying":"SprintQualifying"
    };
    const info=event[fields[session]];
    if(!info||!info.date)return "";
    const timestamp=info.time?Date.parse(String(info.date)+"T"+String(info.time)):Date.parse(String(info.date)+"T00:00:00");
    const date=Number.isFinite(timestamp)?new Date(timestamp).toLocaleString("en-GB",{
      weekday:"short",day:"numeric",month:"short",
      hour:info.time?"2-digit":undefined,minute:info.time?"2-digit":undefined
    }):niceDate(info.date);
    return date+(info.time?" · local session time":" · exact time not supplied");
  }
  if(event.date){
    const start=niceDate(event.date);
    const end=event.dateEnd&&event.dateEnd!==event.date?niceDate(event.dateEnd):"";
    return (end?start+" – "+end:start)+" · session start time not published in archive";
  }
  return "";
}
function sessionUnavailableMessage(series,year,session,event){
  const scheduled=sessionScheduleInfo(event,series,session);
  if(series==="f1"){
    if(/^Practice/.test(session)){
      return year>=2018
        ?"No practice classification is stored for this event yet. FastF1 imports completed practice sessions for the current season when the official timing feed is available."
        :"Practice classifications are not included in this historical F1 archive.";
    }
    if(session==="Qualifying")return "The event is listed in the calendar, but its qualifying classification has not been returned by the connected data source yet.";
    if(session==="Sprint"||session==="Sprint Qualifying")return "This event has no Sprint classification stored. The session may not apply to this race weekend.";
    return "The race classification is not available in this archive yet.";
  }
  return "This session is part of the championship weekend format, but a verified Practice/Qualifying classification is not stored in this F2/F3 archive yet. The page will not invent a result.";
}

function resultTableRows(series,event,session){
  const results=(event.Results||[]).filter(r=>!r.isRecordOnly&&(r.session||"Race")===session);
  results.sort((a,b)=>{
    const pa=Number(a.position),pb=Number(b.position);
    if(Number.isFinite(pa)&&Number.isFinite(pb))return pa-pb;
    if(Number.isFinite(pa))return -1;if(Number.isFinite(pb))return 1;return 0;
  });
  return results.map(r=>{
    const d=r.Driver||{},c=r.Constructor||{};
    const driverId=d.driverId||null,teamId=c.constructorId||slug(c.name);
    if(["Qualifying","Sprint Qualifying","Sprint Shootout","Qualifying 1","Qualifying 2"].includes(session)){
      if(series!=="f1"){
        return "<tr><td class='rank'>"+esc(r.position||"—")+"</td><td>"+driverLink(series,driverId,driverName(d))+"</td><td>"+teamLink(series,teamId,c.name||"—")+"</td><td>"+esc((r.Time&&r.Time.time)||r.time||(r.FastestLap&&r.FastestLap.Time&&r.FastestLap.Time.time)||"—")+"</td><td>"+esc(r.gap||"—")+"</td><td class='num'>"+esc(number(r.laps))+"</td></tr>";
      }
      return "<tr><td class='rank'>"+esc(r.position||"—")+"</td><td>"+driverLink(series,driverId,driverName(d))+"</td><td>"+teamLink(series,teamId,c.name||"—")+"</td><td>"+esc(r.Q1||"—")+"</td><td>"+esc(r.Q2||"—")+"</td><td>"+esc(r.Q3||((r.Time||{}).time)||r.time||"—")+"</td></tr>";
    }
    if(session==="Practice"||/^Practice /.test(session)){
      return "<tr><td class='rank'>"+esc(r.position||"—")+"</td><td>"+driverLink(series,driverId,driverName(d))+"</td><td>"+teamLink(series,teamId,c.name||"—")+"</td><td>"+esc((r.Time&&r.Time.time)||r.time||(r.FastestLap&&r.FastestLap.Time&&r.FastestLap.Time.time)||"—")+"</td><td class='num'>"+esc(number(r.laps))+"</td><td>"+esc(r.status||"—")+"</td></tr>";
    }
    return "<tr><td class='rank'>"+esc(r.position||"—")+"</td><td>"+driverLink(series,driverId,driverName(d))+"</td><td>"+teamLink(series,teamId,c.name||"—")+"</td><td class='num'>"+esc(number(r.grid))+"</td><td class='num'>"+esc(number(r.laps))+"</td><td>"+esc((r.Time&&r.Time.time)||r.time||"—")+"</td><td>"+esc(r.gap||"—")+"</td><td class='num'>"+esc(number(r.points))+"</td><td>"+(r.FastestLap&&r.FastestLap.rank==="1"?badge("Fastest","green"):"—")+"</td></tr>";
  });
}

async function renderRaceDetail(series,year,round){
  if(!SERIES[series])throw new Error("Race series is not supported.");
  const data=await getSeason(series,year),events=availableEvents(data),event=events.find(e=>String(e.round)===String(round));
  if(!event)throw new Error("Race round "+round+" is not present in the "+year+" "+series.toUpperCase()+" archive.");
  const sessions=sessionNames(event,series);
  const defaultSession=series==="f1"?"Race":(sessions.includes("Feature Race 2")?"Feature Race 2":sessions.includes("Feature Race 1")?"Feature Race 1":sessions.includes("Feature Race")?"Feature Race":sessions.find(x=>sessionHasResults(event,x))||sessions[0]);
  const session=state.sessionFilter&&sessions.includes(state.sessionFilter)?state.sessionFilter:defaultSession;
  state.sessionFilter=session;
  const hasResults=sessionHasResults(event,session);
  const rows=resultTableRows(series,event,session);
  const raceLike=["Race","Sprint","Sprint Race","Feature Race","Feature Race 1","Feature Race 2","Race 1","Race 2"].includes(session);
  const winner=raceLike?(event.Results||[]).find(r=>!r.isRecordOnly&&(r.session||"Race")===session&&String(r.position)==="1"&&r.Driver):null;
  const location=event.Circuit&&event.Circuit.Location||{};
  const circuitId=event.circuitId||event.Circuit&&event.Circuit.circuitId||slug(event.Circuit&&event.Circuit.circuitName||event.raceName);
  let circuitProfile=null;try{circuitProfile=await getProfile(series,"circuits",circuitId);}catch{}
  const factContent=circuitProfile?
    "<div class='fact-grid'><div class='fact'><span>Events in archive</span><strong>"+esc(circuitProfile.eventCount)+"</strong></div><div class='fact'><span>Years represented</span><strong>"+esc(circuitProfile.firstSeason)+"–"+esc(circuitProfile.lastSeason)+"</strong></div><div class='fact'><span>Most recorded wins</span><strong>"+esc(circuitProfile.mostWins&&circuitProfile.mostWins[0]?circuitProfile.mostWins[0].driverName:"—")+"</strong></div></div>":
    "<div class='notice'>Track history is limited for this event in the current source archive. The circuit profile may contain additional indexed results.</div>";
  const resultCount=rows.length;
  const coverage=data.coverage&&data.coverage.message?data.coverage.message:"The source archive supplies the displayed session data where available.";
  const isQualifying=["Qualifying","Sprint Qualifying","Sprint Shootout","Qualifying 1","Qualifying 2"].includes(session);
  const isPractice=session==="Practice"||/^Practice /.test(session);
  const headers=isQualifying?(series==="f1"?["POS","DRIVER","CONSTRUCTOR","Q1","Q2","Q3"]:["POS","DRIVER","CONSTRUCTOR","BEST TIME","GAP","LAPS"]):isPractice?["POS","DRIVER","CONSTRUCTOR","BEST LAP","LAPS","STATUS"]:["POS","DRIVER","CONSTRUCTOR","GRID","LAPS","TIME","GAP","PTS","FASTEST"];
  const tabs=sessions.map(name=>{
    const available=sessionHasResults(event,name);
    const suffix=available?"":" · —";
    return "<button class='session-tab "+(name===session?"active ":"")+(available?"":"session-tab-unavailable")+"' data-session='"+esc(name)+"' title='"+(available?"Classifications available":"No classification stored for this session")+"'>"+esc(name+suffix)+"</button>";
  }).join("");
  const scheduled=sessionScheduleInfo(event,series,session);
  const emptyMessage=sessionUnavailableMessage(series,year,session,event);
  const dateText=event.dateEnd&&event.dateEnd!==event.date?niceDate(event.date)+" – "+niceDate(event.dateEnd):niceDate(event.date);
  const officialTimingUrl=series==="f2"?"https://www.fiaformula2.com/livetiming/index.html":series==="f3"?"https://www.fiaformula3.com/livetiming/index.html":"";
  return pageHead("RACE CENTRE",event.raceName,[seriesLabel(series),year,"Round "+round].join(" · "),"<a class='text-link' href='#/calendar'>← Season calendar</a>")+
    "<div class='profile-hero'><div><span class='eyebrow'>"+esc(session)+" · "+esc(year)+"</span><h1>"+esc(event.raceName)+"</h1><p>"+esc([location.locality,location.country].filter(Boolean).join(" · ")||event.Circuit.circuitName||"Circuit location not supplied")+" · "+esc(dateText)+"</p><a class='text-link' href='"+circuitHref(circuitId)+"'>Open circuit profile ↗</a></div><div class='profile-number'>R"+esc(round)+"</div></div>"+
    (winner?"<div class='result-flag'><div><small>SESSION WINNER</small><strong>"+driverLink(series,winner.Driver.driverId,driverName(winner.Driver))+"</strong><small>"+esc(winner.Constructor&&winner.Constructor.name||"Constructor not supplied")+"</small></div>"+badge(session,"gold")+"</div>":"")+
    "<div class='panel'><div class='panel-header'><div><span class='eyebrow'>RACE WEEKEND SESSION</span><h2>"+esc(resultCount)+" result entries</h2></div>"+badge(hasResults?"RESULTS AVAILABLE":"NOT IMPORTED",hasResults?"green":"gold")+"</div><div class='session-tabs'>"+tabs+"</div>"+
    (scheduled?"<p class='secondary session-schedule'>Scheduled: "+esc(scheduled)+"</p>":"")+
    (rows.length?table(headers,rows):"<div class='empty-state'><strong>"+esc(session)+"</strong><p>"+esc(emptyMessage)+"</p>"+(officialTimingUrl?"<a class='text-link' href='"+officialTimingUrl+"' target='_blank' rel='noopener'>Open official live timing ↗</a>":"")+"</div>")+
    "<div class='notice'>"+esc(coverage)+"</div><div class='notice red'>"+(isPractice?"Practice result feed is imported after the session is completed and the source publishes a classification.":isQualifying?"Q1, Q2 and Q3 are displayed only where the source publishes those times.":"Pit stops, lap charts, tyre strategy and telemetry are not implied by a race classification.")+" Missing values are not inferred.</div></div>"+
    "<div class='grid-2'>"+panel("CIRCUIT INFORMATION",event.Circuit.circuitName||event.raceName,"<div class='fact-grid'><div class='fact'><span>Locality</span><strong>"+esc(location.locality||"—")+"</strong></div><div class='fact'><span>Country</span><strong>"+esc(location.country||"—")+"</strong></div><div class='fact'><span>Coordinates</span><strong>"+esc(location.lat&&location.long?location.lat+", "+location.long:"—")+"</strong></div></div>")+panel("TRACK FACTS","Historical archive summary",factContent)+"</div>";
}

async function renderRaceCentre(){
  const events=availableEvents(state.data).slice().reverse();
  const cards=events.map(event=>{
    const classified=(event.Results||[]).filter(r=>!r.isRecordOnly&&r.Driver).length;
    const sessions=sessionNames(event).join(" / ");
    const winner=(event.Results||[]).find(r=>!r.isRecordOnly&&isRaceClassification(state.series,r.session)&&String(r.position)==="1"&&r.Driver);
    const location=event.Circuit&&event.Circuit.Location;
    const venue=[location&&location.locality,location&&location.country].filter(Boolean).join(", ");
    return "<a class='entity-card race-archive-card searchable' data-search='"+esc((event.raceName+" "+(event.Circuit.circuitName||"")+" "+venue).toLowerCase())+"' href='"+raceHref(state.series,state.season,event.round)+"'><div class='card-top'><span class='eyebrow'>ROUND "+esc(event.round)+"</span>"+badge(classified?classified+" result rows":"Summary only",classified?"green":"gold")+"</div><h3>"+esc(event.raceName)+"</h3><p>"+esc([niceDate(event.date),venue].filter(x=>x&&x!=="Date not supplied").join(" · ")||"Event date or venue not present in source")+"</p><div class='entity-meta'>"+badge("Sessions "+sessions)+badge(winner?"Winner "+driverName(winner.Driver):"Open race centre")+"</div><p class='secondary'>Open full event page ↗</p></a>";
  }).join("");
  return pageHead("RACE ARCHIVE","Race centre","Search the selected season's events, open individual classifications and inspect circuit history.")+
    "<div class='panel'><div class='search-row'><input id='raceArchiveSearch' class='search-input' type='search' placeholder='Search Grand Prix, circuit or venue…'><span class='result-count'>"+events.length+" EVENTS</span></div><div class='card-grid' id='raceArchiveList'>"+(cards||"<div class='empty-state'>No races in the selected archive.</div>")+"</div></div>";
}
async function renderPredictions(){
  const events=availableEvents(state.data);
  const selected=events.find(e=>String(e.round)===String(state.predictionEvent))||events.find(e=>!eventHasResults(e))||events[events.length-1];
  if(!selected)return pageHead("PREDICTION CENTRE","No event to model","No event data is available for this season.");
  state.predictionEvent=String(selected.round);
  const circuitId=selected.Circuit.circuitId||slug(selected.Circuit.circuitName||selected.raceName);
  let circuit=null;try{circuit=await getProfile("shared","circuits",circuitId);}catch{}
  const standings=state.data.driverStandings||[];
  const allResults=(state.data.races||[]).flatMap(r=>(r.Results||[]).filter(x=>!x.isRecordOnly&&isRaceClassification(state.series,x.session)).map(x=>({result:x,race:r})));
  const candidates=standings.map(entry=>{
    const d=entry.Driver||{},id=d.driverId;
    const points=Number(entry.points),position=Number(entry.position);
    const seasonForm=Number.isFinite(points)&&standings.length?points/Math.max(1,...standings.map(x=>Number(x.points)||0))*100:(Number.isFinite(position)?Math.max(0,100-(position-1)/(standings.length||1)*100):null);
    const recent=allResults.filter(x=>x.result.Driver&&x.result.Driver.driverId===id&&x.result.position!==undefined).sort((a,b)=>(Number(b.race.round)||0)-(Number(a.race.round)||0)).slice(0,5).map(x=>Number(x.result.position)).filter(x=>Number.isFinite(x)&&x>0);
    const recentForm=recent.length?Math.max(0,100-(recent.reduce((a,b)=>a+b,0)/recent.length-1)*5):null;
    let trackForm=null,trackSamples=0,trackWins=0;
    if(circuit){
      const trackResults=(circuit.events||[]).flatMap(e=>(e.results||[]).filter(r=>!r.recordOnly&&r.driverId===id&&r.position!==null));
      trackSamples=trackResults.length;
      trackWins=trackResults.filter(r=>Number(r.position)===1).length;
      if(trackSamples)trackForm=Math.min(100,trackWins/trackSamples*100+Math.min(35,trackSamples*3));
    }
    const components=[{v:seasonForm,w:.5},{v:recentForm,w:.3},{v:trackForm,w:.2}].filter(x=>x.v!==null);
    const weight=components.reduce((a,b)=>a+b.w,0);
    const score=weight?components.reduce((a,b)=>a+b.v*b.w,0)/weight:0;
    return {id,name:driverName(d),team:(entry.Constructors||[]).map(c=>c.name).join(", "),position:entry.position,points:entry.points,score,seasonForm,recentForm,trackForm,trackSamples,trackWins};
  }).sort((a,b)=>b.score-a.score);
  const rows=candidates.slice(0,10).map((p,i)=>"<div class='prediction-row'><div class='prediction-rank'>"+(i+1)+"</div><div><strong>"+driverLink(state.series,p.id,p.name)+"</strong><div class='secondary'>"+esc(p.team||"Team not supplied")+" · P"+esc(p.position)+" championship</div><div class='prediction-score'><span style='width:"+Math.max(0,Math.min(100,p.score))+"%'></span></div></div><div class='prediction-score-label'>"+p.score.toFixed(1)+" / 100</div></div>").join("");
  const optionHtml=events.map(e=>"<option value='"+esc(e.round)+"' "+(String(e.round)===String(selected.round)?"selected":"")+">Round "+esc(e.round)+" · "+esc(e.raceName)+"</option>").join("");
  return pageHead("PREDICTION CENTRE","Race form model","An exploratory ranking based on season points, recent classified results and prior results at the selected circuit.")+
    "<div class='panel'><div class='toolbar'><label class='field' style='min-width:min(100%,420px)'><span>SELECT EVENT</span><select id='predictionEventSelect' class='field-select'>"+optionHtml+"</select></label>"+badge("Research model · v1","gold")+"</div><div class='profile-hero'><div><span class='eyebrow'>MODEL TARGET</span><h1>"+esc(selected.raceName)+"</h1><p>"+esc(seriesLabel(state.series)+" · "+state.season+" · "+niceDate(selected.date))+"</p></div><div class='profile-number'>R"+esc(selected.round)+"</div></div><div class='notice'>This is a ranking score, not a probability of winning. It is not a betting forecast. The model has not yet been back-tested; confidence depends on how much historical classification data exists for each driver and circuit.</div><div class='grid-2'><div>"+panel("TOP PREDICTED CONTENDERS","Model ranking","<div class='prediction-list'>"+(rows||"<div class='empty-state'>No championship standings for this event.</div>")+"</div>")+"</div><div>"+panel("MODEL INPUTS","How the score is built","<div class='fact-grid'><div class='fact'><span>Season form</span><strong>50%</strong></div><div class='fact'><span>Recent form</span><strong>30%</strong></div><div class='fact'><span>Circuit history</span><strong>20%</strong></div></div><p class='secondary'>Unavailable components are excluded and the remaining weights are rescaled. Recent form uses up to five classified results. Circuit history uses archived sessions for this championship.</p>")+"</div></div></div>";
}
async function renderComparisons(){
  const idx=await getIndex(state.series,"drivers");
  state.compareDriverDirectory=new Map(idx.drivers.map(d=>[norm(d.name),d]));
  const driverOptions=idx.drivers.map(d=>"<option value='"+esc(d.name)+"'></option>").join("");
  const years=idx.seasons.map(s=>s.year).sort((a,b)=>b-a);
  const seasonOptions=years.map(y=>"<option value='"+y+"'>"+y+"</option>").join("");
  return pageHead("COMPARISON LAB","Compare careers & seasons","Type driver names and choose the matching suggestion, or compare championship seasons.")+
  "<div class='grid-2'><section class='panel'><div class='panel-header'><div><span class='eyebrow'>DRIVER HEAD-TO-HEAD</span><h2>Career comparison</h2></div></div><div class='toolbar'><label class='field'><span>DRIVER ONE</span><input id='compareDriverOne' class='field-select' type='search' list='compareDriverNames' placeholder='Start typing a driver name…' autocomplete='off'></label><label class='field'><span>DRIVER TWO</span><input id='compareDriverTwo' class='field-select' type='search' list='compareDriverNames' placeholder='Start typing a driver name…' autocomplete='off'></label></div><datalist id='compareDriverNames'>"+driverOptions+"</datalist><p class='secondary'>You can type the driver's name instead of scrolling through a long dropdown. Select a matching suggestion to compare.</p><div id='driverCompareOutput' class='comparison-output'></div></section>"+
  "<section class='panel'><div class='panel-header'><div><span class='eyebrow'>CHAMPIONSHIP HISTORY</span><h2>Season comparison</h2></div></div><div class='toolbar'><label class='field'><span>SEASON ONE</span><select id='compareSeasonOne' class='field-select'>"+seasonOptions+"</select></label><label class='field'><span>SEASON TWO</span><select id='compareSeasonTwo' class='field-select'>"+seasonOptions+"</select></label></div><div id='seasonCompareOutput' class='comparison-output'></div></section></div>";
}
async function runDriverCompare(){
  const aChoice=norm($("compareDriverOne").value),bChoice=norm($("compareDriverTwo").value);
  const aEntry=state.compareDriverDirectory.get(aChoice),bEntry=state.compareDriverDirectory.get(bChoice);
  const out=$("driverCompareOutput");
  if(!aEntry||!bEntry){
    out.innerHTML="<div class='empty-state'>Type both driver names and choose an exact match from the suggestions above.</div>";
    return;
  }
  if(aEntry.id===bEntry.id){
    out.innerHTML="<div class='empty-state'>Choose two different drivers.</div>";
    return;
  }
  try{
    const [a,b]=await Promise.all([getProfile(state.series,"drivers",aEntry.id),getProfile(state.series,"drivers",bEntry.id)]);
    const fields=[["Championships","championships"],["Wins","wins"],["Podiums","podiums"],["Pole starts","poleStarts"],["Fastest laps","fastestLaps"],["Points","points"],["Seasons","seasons"]];
    const rows=fields.map(([label,key])=>"<tr><td>"+label+"</td><td class='num'>"+number(a.career[key])+(a.career[key+"Complete"]===false?"*":"")+"</td><td class='num'>"+number(b.career[key])+(b.career[key+"Complete"]===false?"*":"")+"</td></tr>");
    out.innerHTML="<div class='compare-grid'><div class='compare-card'><h3>"+esc(a.name)+"</h3><p class='secondary'>"+esc(a.nationality||"")+"</p></div><div class='compare-card'><h3>"+esc(b.name)+"</h3><p class='secondary'>"+esc(b.nationality||"")+"</p></div></div>"+table(["CAREER METRIC",a.name,b.name],rows)+"<p class='secondary'>* Available-source total. Points systems have changed over time, so raw career points are not adjusted for era.</p>";
  }catch(e){out.innerHTML="<div class='notice red'>"+esc(e.message)+"</div>";}
}

async function runSeasonCompare(){
  const one=Number($("compareSeasonOne").value),two=Number($("compareSeasonTwo").value),out=$("seasonCompareOutput");
  if(!one||!two){out.innerHTML="<div class='empty-state'>Select two seasons.</div>";return;}
  try{
    const [a,b]=await Promise.all([getSeason(state.series,one),getSeason(state.series,two)]);
    const champion=d=>(d.driverStandings||[]).find(x=>Number(x.position)===1)||(d.driverStandings||[])[0];
    const constructor=d=>(d.constructorStandings||[]).find(x=>Number(x.position)===1)||(d.constructorStandings||[])[0];
    const ca=champion(a),cb=champion(b),ta=constructor(a),tb=constructor(b);
    const labelA=one===CURRENT_YEAR?"Current leader":"Champion",labelB=two===CURRENT_YEAR?"Current leader":"Champion";
    out.innerHTML="<div class='compare-grid'><div class='compare-card'><span class='eyebrow'>"+one+" · "+labelA+"</span><h3>"+esc(ca?driverName(ca.Driver):"No standings leader")+"</h3><p>"+esc(ca?number(ca.points)+" points":"")+"</p><div class='secondary'>Constructor "+(one===CURRENT_YEAR?"leader: ":"champion: ")+esc(ta&&ta.Constructor?ta.Constructor.name:"—")+"</div></div><div class='compare-card'><span class='eyebrow'>"+two+" · "+labelB+"</span><h3>"+esc(cb?driverName(cb.Driver):"No standings leader")+"</h3><p>"+esc(cb?number(cb.points)+" points":"")+"</p><div class='secondary'>Constructor "+(two===CURRENT_YEAR?"leader: ":"champion: ")+esc(tb&&tb.Constructor?tb.Constructor.name:"—")+"</div></div></div><div class='fact-grid'><div class='fact'><span>Events listed · "+one+"</span><strong>"+availableEvents(a).length+"</strong></div><div class='fact'><span>Events listed · "+two+"</span><strong>"+availableEvents(b).length+"</strong></div><div class='fact'><span>Driver standings</span><strong>"+(a.driverStandings||[]).length+" / "+(b.driverStandings||[]).length+"</strong></div></div>";
  }catch(e){out.innerHTML="<div class='notice red'>"+esc(e.message)+"</div>";}
}
async function renderRecords(){
  const [drivers,teams]=await Promise.all([getIndex(state.series,"drivers"),getIndex(state.series,"teams")]);
  const top=(items,key)=>items.filter(x=>x[key]!==null&&x[key]!==undefined).sort((a,b)=>(b[key]||0)-(a[key]||0)).slice(0,10);
  const recordCard=(title,key,items,kind)=>"<section class='panel'><div class='panel-header'><div><span class='eyebrow'>CAREER RECORDS</span><h2>"+title+"</h2></div></div>"+table(["RANK",kind==="drivers"?"DRIVER":"CONSTRUCTOR","VALUE"],top(items,key).map((x,i)=>"<tr><td class='rank'>"+(i+1)+"</td><td><a class='person-link' href='"+(kind==="drivers"?driverHref(state.series,x.id):teamHref(state.series,x.id))+"'>"+esc(x.name)+"</a></td><td class='num'>"+esc(x[key])+(x[key+"Complete"]===false?"*":"")+"</td></tr>"))+"</section>";
  return pageHead("RECORD BOOK","Career & historical records","Rankings are calculated from the stored season archive. Partial totals are marked, and raw points are not normalized across eras.")+
    "<div class='grid-2'>"+recordCard("Most championship titles","championships",drivers.drivers,"drivers")+recordCard("Most race wins","wins",drivers.drivers,"drivers")+"</div>"+
    "<div class='grid-2'>"+recordCard("Most podiums","podiums",drivers.drivers,"drivers")+recordCard("Most career points","points",drivers.drivers,"drivers")+"</div>"+
    "<div class='grid-2'>"+recordCard("Most pole starts","poleStarts",drivers.drivers,"drivers")+recordCard("Most fastest laps in available data","fastestLaps",drivers.drivers,"drivers")+"</div>"+
    "<div class='grid-2'>"+recordCard("Constructor championships","championships",teams.teams,"teams")+recordCard("Constructor career points","points",teams.teams,"teams")+"</div>"+
    "<div class='notice'>* Partial or source-limited total. Historical points systems changed considerably; points totals are shown as recorded, not adjusted to a common scoring system. Pole starts are based on starting-grid position one, not independently verified qualifying classifications.</div>";
}

async function renderAnalytics(){
  const idx=await getIndex(state.series,"drivers"),seasons=idx.seasons||[];
  const champions=seasons.filter(s=>s.status==="final"&&s.champion);
  const currentLeader=seasons.find(s=>s.status==="current"&&s.leader);
  const counts=new Map();
  champions.forEach(s=>counts.set(s.champion,(counts.get(s.champion)||0)+1));
  const titleRows=Array.from(counts,([name,titles])=>({name,titles})).sort((a,b)=>b.titles-a.titles).slice(0,12);
  const max=Math.max(1,...titleRows.map(x=>x.titles));
  const bars=titleRows.map(x=>"<div class='chart-row'><span>"+esc(x.name.split(" ").slice(-1)[0])+"</span><div class='bar'><span style='width:"+(x.titles/max*100)+"%'></span></div><strong>"+x.titles+"</strong></div>").join("");
  const timeline=champions.slice().reverse().map(s=>"<tr><td>"+s.year+"</td><td>"+driverLink(state.series,s.championId,s.champion)+"</td><td class='num'>"+esc(number(s.championPoints))+"</td><td>"+esc(s.constructorChampion||"—")+"</td></tr>");
  const leaderRow=currentLeader?"<tr><td>"+currentLeader.year+"</td><td>"+driverLink(state.series,currentLeader.leaderId,currentLeader.leader)+" "+badge("Current leader","gold")+"</td><td class='num'>"+esc(number(currentLeader.championPoints))+"</td><td>"+esc(currentLeader.constructorLeader||"—")+"</td></tr>":"";
  return pageHead("ADVANCED ANALYTICS",seriesLabel(state.series)+" analytics","Explore title history, season-by-season performance and historical patterns.")+
    "<div class='kpi-grid'>"+kpi("Seasons indexed",seasons.length,"Years with season files")+kpi("Champions identified",champions.length,"Completed seasons only")+kpi("Different champions",counts.size,"Unique completed-season winners")+kpi("Current season leader",currentLeader?currentLeader.leader:"—",currentLeader?"Provisional "+currentLeader.year+" standings":"No current leader","accent")+"</div>"+
    "<div class='grid-2'>"+panel("TITLE HISTORY","Most championships", "<div class='chart-bars'>"+bars+"</div>")+panel("DATA METHOD","How to read this page","<p class='secondary'>This page is built from final season standings, not live timing. Only years with an indexed champion are counted. Points systems and championship formats changed over time, so raw points across decades are not directly comparable.</p><p class='secondary'>Further analytics can be added as source coverage improves, including qualifying pace, teammate comparisons, points-per-start and circuit-specific performance.</p>")+"</div>"+
    panel("CHAMPIONSHIP ARCHIVE","Season champions and current leader",table(["SEASON","DRIVER CHAMPION / LEADER","POINTS","CONSTRUCTOR CHAMPION / LEADER"],timeline.concat(leaderRow)));
}
async function renderDataCentre(){
  const idx=await getIndex(state.series,"drivers");
  const rows=idx.seasons.slice().reverse().map(s=>{
    const c=s.coverage||{};
    const label=c.classification||"full";
    const kind=label==="full"?"green":label==="winners-only"?"gold":"red";
    return "<tr><td>"+s.year+"</td><td>"+badge(label,kind)+"</td><td>"+esc(s.champion||"—")+"</td><td>"+esc(s.constructorChampion||"—")+"</td><td>"+esc(s.updatedAt?niceDate(s.updatedAt.slice(0,10)):"—")+"</td><td>"+esc(s.source||"—")+"</td></tr>";
  });
  return pageHead("DATA TRANSPARENCY","Sources & coverage","See which seasons are indexed and what each source actually supplies.")+
    "<div class='kpi-grid'>"+kpi("Seasons indexed",idx.seasonCount,"Selected championship")+kpi("Driver profiles",idx.drivers.length,"Generated from season tables")+kpi("Constructor profiles",(await getIndex(state.series,"teams")).teams.length,"Cross-season team archive")+kpi("Circuit directory",(await getIndex(state.series,"circuits")).circuits.length,"Shared circuit index")+"</div>"+
    panel("SEASON COVERAGE","Imported data by year",table(["SEASON","CLASSIFICATION COVERAGE","CHAMPION","CONSTRUCTOR CHAMPION","UPDATED","SOURCE"],rows))+
    "<div class='grid-2'>"+panel("PRIMARY SOURCES","Data provenance","<p><a class='text-link' href='https://github.com/jolpica/jolpica-f1' target='_blank' rel='noopener'>Jolpica F1 API ↗</a> · F1 historical race data and standings.</p><p><a class='text-link' href='https://github.com/Alarchemn/F2-Data-Pipeline' target='_blank' rel='noopener'>F2 historical archive ↗</a> · 2017–2023 classifications.</p><p><a class='text-link' href='https://www.fia.com/' target='_blank' rel='noopener'>FIA ↗</a> · Championship context and official archive references.</p><p><a class='text-link' href='./DATA_SOURCES.md'>Full source and methodology notes ↗</a></p>")+panel("KNOWN GAPS","Not yet connected","<ul class='secondary'><li>Qualifying classifications for the full historical span.</li><li>F2/F3 full results in years where only winners are available.</li><li>Official track length, corner count and circuit lap records.</li><li>Pit stops, tyre strategy, telemetry and lap charts.</li><li>Prediction-model back-testing and calibrated probabilities.</li></ul>")+"</div>";
}
function bindDynamicEvents(){
  $("entitySearch")?.addEventListener("input",e=>{
    const query=e.target.value.toLowerCase();
    document.querySelectorAll(".searchable").forEach(card=>card.classList.toggle("hidden",!card.dataset.search.includes(query)));
  });
  $("raceArchiveSearch")?.addEventListener("input",e=>{
    const query=e.target.value.toLowerCase();
    document.querySelectorAll("#raceArchiveList .searchable").forEach(card=>card.classList.toggle("hidden",!card.dataset.search.includes(query)));
  });
  $("predictionEventSelect")?.addEventListener("change",e=>{state.predictionEvent=e.target.value;renderRoute();});
  $("newsSearch")?.addEventListener("input",e=>{state.newsSearch=e.target.value;applyNewsFilters();});
  document.querySelectorAll("[data-news-series]").forEach(button=>button.addEventListener("click",()=>{
    state.newsSeriesFilter=button.dataset.newsSeries;
    document.querySelectorAll("[data-news-series]").forEach(tab=>tab.classList.toggle("active",tab===button));
    applyNewsFilters();
  }));
  document.querySelectorAll("[data-watch]").forEach(button=>button.addEventListener("click",()=>{
    toggleWatchlist(button.dataset.watch,button.dataset.series,button.dataset.id);
    renderRoute();
  }));
  document.querySelectorAll("[data-export]").forEach(button=>button.addEventListener("click",()=>{
    runDataExport(button.dataset.export).catch(error=>{status("bad","EXPORT FAILED");notice(error.message,"red");});
  }));
  $("compareDriverOne")?.addEventListener("input",runDriverCompare);
  $("compareDriverTwo")?.addEventListener("input",runDriverCompare);
  $("compareDriverOne")?.addEventListener("change",runDriverCompare);
  $("compareDriverTwo")?.addEventListener("change",runDriverCompare);
  $("compareSeasonOne")?.addEventListener("change",runSeasonCompare);
  $("compareSeasonTwo")?.addEventListener("change",runSeasonCompare);
  document.querySelectorAll("[data-session]").forEach(button=>button.addEventListener("click",()=>{
    state.sessionFilter=button.dataset.session;
    renderRoute();
  }));
  if($("compareDriverOne")&&$("compareDriverTwo")){
    getIndex(state.series,"drivers").then(idx=>{
      state.compareDriverDirectory=new Map(idx.drivers.map(d=>[norm(d.name),d]));
      const list=$("compareDriverNames");
      if(list)list.innerHTML=idx.drivers.map(d=>"<option value='"+esc(d.name)+"'></option>").join("");
      runDriverCompare();
    }).catch(e=>{$("driverCompareOutput").innerHTML="<div class='notice red'>"+esc(e.message)+"</div>";});
  }
  if($("compareSeasonOne")&&$("compareSeasonTwo")){
    const idxPromise=getIndex(state.series,"drivers");
    idxPromise.then(idx=>{
      const years=idx.seasons.map(s=>s.year).sort((a,b)=>b-a);
      $("compareSeasonOne").innerHTML=years.map(y=>"<option value='"+y+"'>"+y+"</option>").join("");
      $("compareSeasonTwo").innerHTML=years.map(y=>"<option value='"+y+"'>"+y+"</option>").join("");
      if(years.length>1){$("compareSeasonOne").value=String(years[0]);$("compareSeasonTwo").value=String(years[1]);runSeasonCompare();}
    }).catch(e=>{$("seasonCompareOutput").innerHTML="<div class='notice red'>"+esc(e.message)+"</div>";});
  }
}

document.querySelectorAll(".main-nav a").forEach(a=>a.addEventListener("click",()=>{}));
$("seriesSelect").addEventListener("change",e=>{
  state.series=e.target.value;state.season=CURRENT_YEAR;state.sessionFilter="";state.predictionEvent="";fillSeasonOptions();navigate(["dashboard"]);
});
$("seasonSelect").addEventListener("change",e=>{
  state.season=Number(e.target.value);state.sessionFilter="";state.predictionEvent="";renderRoute();
});
$("refreshButton").addEventListener("click",()=>{
  const key=state.series+"/"+state.season;state.dataCache.delete(key);
  state.indexCache.clear();state.profileCache.clear();renderRoute(true);
});
window.addEventListener("hashchange",()=>{state.sessionFilter="";renderRoute();});
fillSeasonOptions();
renderRoute();
})();