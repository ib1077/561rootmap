(() => {
  "use strict";
  const D = window.RAIL_DATA;
  const SPEED_PROFILES = {
    "7000": {id:"7000",label:"7000",kind:"express",source:"route-data.js",points:D.speeds},
    ...(window.TRAIN_SPEED_DATA || {})
  };
  const ASSETS = window.ASSET_ROWS || [];
  const LIST_SIGNALS = ASSETS.filter(row => row.category === "信号機");
  for (const signal of D.signals) {
    const row = LIST_SIGNALS.find(item => item.categoryName === signal.direction && Math.abs(item.distanceKm - signal.km) < 1e-9);
    if (row) { signal.kind = row.type2; signal.code = row.type3; }
  }
  const TOTAL = D.meta.totalKm;
  const PAD = 34;
  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];
  const routeViewport = $("#railViewport");
  const speedViewport = $("#speedViewport");
  const routeCanvas = $("#routeCanvas");
  const routeSvg = $("#railSvg");
  const speedSvg = $("#speedSvg");
  const assetStrip = $("#assetStrip");
  const assetStripCanvas = $("#assetStripCanvas");
  const positionSlider = $("#positionSlider");
  const positionOutput = $("#positionOutput");
  const EXPRESS_STOP_NAMES = ["上郡", "佐用", "大原", "智頭"];
  let stripHits = [], stripGesture = null, stripFrame = 0;
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem("chizu-line-v2-view") || "null"); } catch (_) { saved = null; }
  const layerInfo = [
    ["stations", "駅", "全体から表示"], ["tunnels", "トンネル", "全体から表示"],
    ["gradient", "勾配", "少し拡大すると表示"], ["curves", "曲線", "少し拡大すると表示"],
    ["signals", "信号機", "詳しく拡大すると表示"], ["balises", "地上子", "さらに拡大すると表示"],
    ["points", "分岐器", "詳しく拡大すると表示"], ["exits", "避難口", "詳しく拡大すると表示"]
  ];
  const state = {
    mode: ["route","speed","list"].includes(saved?.mode) ? saved.mode : "route",
    zoom: Number.isFinite(saved?.zoom) ? saved.zoom : null,
    centerKm: Number.isFinite(saved?.centerKm) ? saved.centerKm : TOTAL / 2,
    layers: saved?.layers || Object.fromEntries(layerInfo.map(([key]) => [key, "auto"])),
    selectedTrain: SPEED_PROFILES[saved?.selectedTrain] ? saved.selectedTrain : "7000",
    speedDirections: Array.isArray(saved?.speedDirections) ? saved.speedDirections : ["up"],
    selectedAssetId: Number.isFinite(saved?.selectedAssetId) ? saved.selectedAssetId : null,
    assetStripOpen: saved?.assetStripOpen === true,
    routeYRatio: Number.isFinite(saved?.routeYRatio) ? saved.routeYRatio : .5,
    timeMethod: ["all","station","express","distance"].includes(saved?.timeMethod) ? saved.timeMethod : "all",
    timeStart: Number.isFinite(saved?.timeStart) ? saved.timeStart : 0,
    timeEnd: Number.isFinite(saved?.timeEnd) ? saved.timeEnd : TOTAL,
    selected: null, fallbackLandscape: false, orientationLocked: false
  };
  const minY = Math.min(...D.gradient.map(point => point.y));
  const maxY = Math.max(...D.gradient.map(point => point.y));
  const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[char]));
  const kmText = km => { const m = Math.max(0, Math.round(Number(km) * 1000)); return `${Math.floor(m / 1000)}k${String(m % 1000).padStart(3, "0")}m`; };
  const assetText = value => value===null||value===undefined ? "" : String(value);
  const assetKmText = km => {const m=Math.round(Number(km)*1000),a=Math.abs(m);return `${m<0?"−":""}${Math.floor(a/1000)}k${String(a%1000).padStart(3,"0")}m`;};
  const curveSpans = (() => { const spans=[]; let active=null; for(const item of D.curves){ if(["BC","BTC"].includes(item.mark)) active={start:item.km,radius:item.radius,startMark:item.mark}; if(active&&item.mark==="ETC"){spans.push({...active,end:item.km,endMark:item.mark});active=null;} } return spans.filter(item=>item.end>item.start); })();
  const expressStops = EXPRESS_STOP_NAMES.map(name=>D.stations.find(station=>station.name===name)).filter(Boolean);
  const speedProfile = () => SPEED_PROFILES[state.selectedTrain] || SPEED_PROFILES["7000"];
  const speedPoints = () => speedProfile().points;
  const trainLabel = () => speedProfile().label;
  const localStops = () => (speedProfile().stops || D.stations).map(stop=>{const station=D.stations.find(item=>Math.abs(item.km-stop.km)<.02);return {name:station?.name||stop.name,km:stop.km};});

  function interpolateY(km) {
    if (km <= D.gradient[0].km) return D.gradient[0].y;
    for (let i=1;i<D.gradient.length;i+=1) if(km<=D.gradient[i].km){const a=D.gradient[i-1],b=D.gradient[i],r=(km-a.km)/(b.km-a.km||1);return a.y+(b.y-a.y)*r;}
    return D.gradient.at(-1).y;
  }
  function x(km){return PAD+km*state.zoom;}
  function routeY(value,height){return 58+(maxY-value)/(maxY-minY||1)*Math.max(150,height-126);}
  function speedY(value,height){return 30+(150-Math.max(0,Math.min(150,value)))/150*Math.max(150,height-76);}
  function routePath(points,height){return points.map((p,i)=>`${i?"L":"M"}${x(p.km).toFixed(1)} ${routeY(p.y,height).toFixed(1)}`).join(" ");}
  function pointsBetween(start,end){return [{km:start,y:interpolateY(start)},...D.gradient.filter(p=>p.km>start&&p.km<end),{km:end,y:interpolateY(end)}];}
  function autoVisible(layer){if(["stations","tunnels"].includes(layer))return true;if(["gradient","curves"].includes(layer))return state.zoom>=24;if(["signals","points","exits"].includes(layer))return state.zoom>=68;if(layer==="balises")return state.zoom>=110;return false;}
  function visible(layer){const value=state.layers[layer]||"auto";return value==="show"||(value==="auto"&&autoVisible(layer));}
  function attrs(type,name,km,detail="",relation=""){return `class="clickable" tabindex="0" role="button" data-type="${escapeHtml(type)}" data-name="${escapeHtml(name)}" data-km="${km}" data-detail="${escapeHtml(detail)}" data-relation="${escapeHtml(relation)}"`;}

  function stripLane(row){if(row.category==="駅"||row.category.startsWith("T"))return 0;if(["勾配","‰","曲線","kp","避難口"].includes(row.category))return 1;if(row.category==="信号機")return 2;return 3;}
  function stripVisible(row){if(row.category==="駅")return visible("stations");if(row.category.startsWith("T"))return false;if(["勾配","‰"].includes(row.category))return visible("gradient");if(row.category==="曲線")return visible("curves");if(row.category==="避難口")return visible("exits");if(row.category==="信号機")return visible("signals");if(row.category.includes("地上子"))return visible("balises");return state.zoom>=38;}
  function stripLabel(row){if(row.category==="駅")return assetText(row.categoryName);if(row.category==="信号機")return assetText(row.supplementalB||row.attribute);if(row.category.includes("地上子"))return assetText(row.supplementalB||row.type3||row.type2);if(row.category==="曲線")return `${assetText(row.categoryName)}${row.attribute?` R${row.attribute}`:""}`;if(["勾配","‰"].includes(row.category))return row.attribute===null||row.attribute===""?"":`${row.attribute}‰`;if(row.category==="避難口")return assetText(row.categoryName);return row.category==="kp"?`${row.categoryName}k`:assetText(row.categoryName||row.attribute);}
  function stripLabelVisible(row){const lane=stripLane(row);return lane===0?state.zoom>=15:lane===1?state.zoom>=88:lane===2?state.zoom>=125:state.zoom>=190;}
  function renderAssetStrip(){
    if(!state.assetStripOpen){stripHits=[];return;}
    const width=Math.max(1,assetStrip.clientWidth),height=Math.max(1,assetStrip.clientHeight),ratio=Math.min(2,window.devicePixelRatio||1),ctx=assetStripCanvas.getContext("2d"),header=22,laneH=(height-header)/4;
    if(assetStripCanvas.width!==Math.round(width*ratio)||assetStripCanvas.height!==Math.round(height*ratio)){assetStripCanvas.width=Math.round(width*ratio);assetStripCanvas.height=Math.round(height*ratio);}
    ctx.setTransform(ratio,0,0,ratio,0,0);ctx.clearRect(0,0,width,height);ctx.fillStyle="#fff";ctx.fillRect(0,0,width,height);ctx.font="700 10px sans-serif";ctx.fillStyle="#a4322f";ctx.fillText("● 上り",52,14);ctx.fillStyle="#26678e";ctx.fillText("● 下り",96,14);ctx.fillStyle="#59635f";ctx.fillText("○ 中継　◆ 無電源",140,14);ctx.strokeStyle="#dedcd6";ctx.lineWidth=1;for(let i=0;i<=4;i+=1){const yy=header+i*laneH;ctx.beginPath();ctx.moveTo(0,yy+.5);ctx.lineTo(width,yy+.5);ctx.stroke();}
    const sx=km=>PAD+km*state.zoom-routeViewport.scrollLeft,laneY=lane=>header+laneH*(lane+.5),left=(routeViewport.scrollLeft-PAD)/state.zoom-1,right=(routeViewport.scrollLeft+width-PAD)/state.zoom+1;stripHits=[];
    if(visible("tunnels"))for(const tunnel of D.tunnels){if(tunnel.end<left||tunnel.start>right)continue;const x1=sx(Math.max(0,tunnel.start)),x2=sx(Math.min(TOTAL,tunnel.end)),yy=laneY(0);ctx.strokeStyle="#343b3d";ctx.lineWidth=6;ctx.lineCap="round";ctx.beginPath();ctx.moveTo(x1,yy);ctx.lineTo(x2,yy);ctx.stroke();if(x2-x1>46){ctx.fillStyle="#343b3d";ctx.font="700 10px sans-serif";ctx.fillText(tunnel.name,Math.max(46,(x1+x2)/2-ctx.measureText(tunnel.name).width/2),yy-6);}stripHits.push({kind:"span",x1,x2,y:yy,km:tunnel.start,type:"トンネル",name:`${tunnel.name}トンネル`,detail:`${assetKmText(tunnel.start)} — ${assetKmText(tunnel.end)}`,relation:`延長 ${Math.round((tunnel.end-tunnel.start)*1000)}m`});}
    for(const row of ASSETS){if(row.distanceKm<left)continue;if(row.distanceKm>right)break;if(!stripVisible(row))continue;const lane=stripLane(row),xx=sx(row.distanceKm),yy=laneY(lane),selected=row.id===state.selectedAssetId,directional=row.category==="信号機"||row.category.includes("地上子"),markColor=row.category==="無電源地上子"?"#59635f":directional&&row.categoryName==="上り"?"#a4322f":directional&&row.categoryName==="下り"?"#26678e":lane===0?"#174d3a":lane===1?"#9a6a20":"#59635f",relaySignal=row.category==="信号機"&&row.attribute==="中継";ctx.lineWidth=relaySignal?1.35:1.2;ctx.strokeStyle=markColor;ctx.fillStyle=markColor;ctx.beginPath();if(row.category==="駅"){ctx.arc(xx,yy,selected?5.5:4,0,Math.PI*2);ctx.fillStyle="#fff";ctx.fill();ctx.stroke();}else if(row.category==="信号機"){ctx.arc(xx,yy,selected?5:3.7,0,Math.PI*2);ctx.fillStyle=relaySignal?"#fff":markColor;ctx.fill();ctx.stroke();}else if(row.category.includes("地上子")){const size=selected?5:3.8;ctx.moveTo(xx,yy-size);ctx.lineTo(xx+size,yy);ctx.lineTo(xx,yy+size);ctx.lineTo(xx-size,yy);ctx.closePath();ctx.fill();ctx.stroke();}else{ctx.moveTo(xx,yy-5);ctx.lineTo(xx,yy+5);ctx.stroke();}if(selected){ctx.beginPath();ctx.arc(xx,yy,7,0,Math.PI*2);ctx.strokeStyle="#d18d20";ctx.lineWidth=1.5;ctx.stroke();}const label=stripLabel(row);if(label&&stripLabelVisible(row)){ctx.fillStyle="#364b52";ctx.font="700 10px sans-serif";ctx.fillText(label,xx+5,yy-5);}stripHits.push({kind:"point",x:xx,y:yy,row});}
    if(state.selected){const xx=sx(state.selected.km);if(xx>=44&&xx<=width){ctx.strokeStyle="#d18d20";ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(xx,0);ctx.lineTo(xx,height);ctx.stroke();}}
  }

  function renderRoute(){
    const visibleHeight=Math.max(260,routeViewport.clientHeight||400),height=visibleHeight,width=Math.max(routeViewport.clientWidth,PAD*2+TOTAL*state.zoom),canvasHeight=Math.max(480,Math.round(visibleHeight*1.5));
    routeCanvas.style.width=`${width}px`;routeCanvas.style.height=`${canvasHeight}px`;
    routeSvg.setAttribute("viewBox",`0 0 ${width} ${height}`);routeSvg.setAttribute("width",width);routeSvg.setAttribute("height",height);routeSvg.style.width=`${width}px`;routeSvg.style.height=`${height}px`;routeSvg.style.top=`${Math.max(0,(canvasHeight-height)/2)}px`;
    let out=`<rect width="${width}" height="${height}" fill="#fcfcfa"/>`;
    if($("#timePanel")?.classList.contains("open")){const start=Math.min(state.timeStart,state.timeEnd),end=Math.max(state.timeStart,state.timeEnd);out+=`<rect class="time-range-highlight" x="${x(start)}" y="22" width="${Math.max(2,(end-start)*state.zoom)}" height="${height-50}"/><line class="time-range-edge" x1="${x(start)}" y1="22" x2="${x(start)}" y2="${height-28}"/><line class="time-range-edge" x1="${x(end)}" y1="22" x2="${x(end)}" y2="${height-28}"/>`;}
    const step=state.zoom<16?5:state.zoom<55?1:.1;
    for(let km=0;km<=TOTAL+.0001;km+=step){const n=Math.round(km*10)/10,major=Math.abs(n%5)<.001;out+=`<line class="rail-grid${major?" major":""}" x1="${x(n)}" y1="22" x2="${x(n)}" y2="${height-28}"/>`;if(major||state.zoom>=42)out+=`<text class="km-label" x="${x(n)+3}" y="18">${state.zoom>=85?kmText(n):`${Number(n.toFixed(1))}k`}</text>`;}
    if(state.mode==="speed")for(const v of [40,80,120]){const yy=speedY(v,height);out+=`<line class="speed-overlay-guide" x1="${PAD}" y1="${yy}" x2="${width-PAD}" y2="${yy}"/>`;for(let km=0;km<=TOTAL;km+=10)out+=`<text class="speed-overlay-label" x="${x(km)+3}" y="${yy-3}">${v}</text>`;}
    if(visible("tunnels"))for(const t of D.tunnels){const start=Math.max(0,t.start),end=Math.min(TOTAL,t.end);if(end<=0||start>=TOTAL)continue;out+=`<g ${attrs("トンネル",`${t.name}トンネル`,start,`${kmText(start)} — ${kmText(end)}`,`延長 ${Math.round((end-start)*1000)}m`)}><path class="tunnel-line" d="${routePath(pointsBetween(start,end),height)}"/>`;const pixels=(end-start)*state.zoom;if(state.zoom>=19||pixels>=31){const mid=(start+end)/2;out+=`<text class="tunnel-name" x="${x(mid)}" y="${routeY(interpolateY(mid),height)-9}" text-anchor="middle">${escapeHtml(t.name)}</text>`;}out+=`</g>`;}
    out+=`<path class="route-line" d="${routePath(D.gradient.filter(p=>p.km>=0&&p.km<=TOTAL),height)}"/>`;
    if(state.mode==="speed"){const selected=new Set(state.speedDirections);for(const dir of ["up","down"])if(selected.has(dir)){const pts=speedPoints(),path=pts.map((p,i)=>`${i?"L":"M"}${x(p.km).toFixed(1)} ${speedY(p[dir],height).toFixed(1)}`).join(" ");out+=`<path class="speed-line-halo" d="${path}"/><path class="speed-line-${dir}" d="${path}"/>`;if(state.zoom>=70)for(const p of pts.filter(p=>Math.abs((p.km/2)-Math.round(p.km/2))<.001)){const yy=speedY(p[dir],height),dy=dir==="up"?-7:14;out+=`<text class="speed-value speed-value-${dir}" x="${x(p.km)+4}" y="${yy+dy}">${p[dir]}</text>`;}}}
    if(visible("gradient"))for(const p of D.gradient.filter(p=>p.km>=0&&p.km<=TOTAL)){const yy=routeY(p.y,height),label=`${p.permille>0?"+":""}${p.permille}‰`;out+=`<g ${attrs("勾配",label,p.km,`${kmText(p.km)}から`,"勾配変化点")}><circle cx="${x(p.km)}" cy="${yy}" r="3.4" fill="#315666"/><text class="gradient-label" x="${x(p.km)+5}" y="${yy-7}">${label}</text></g>`;}
    if(visible("curves")){const baseY=height-35;for(const c of curveSpans){out+=`<g ${attrs("曲線",c.radius?`R${c.radius}`:"曲線区間",c.start,`${kmText(c.start)} — ${kmText(c.end)}`,`延長 ${Math.round((c.end-c.start)*1000)}m`)}><path class="curve-mark" d="M${x(c.start)} ${baseY-8}V${baseY}H${x(c.end)}V${baseY-8}"/>`;if(state.zoom>=38&&c.radius)out+=`<text class="curve-label" x="${x((c.start+c.end)/2)}" y="${baseY-4}" text-anchor="middle">R${c.radius}</text>`;out+=`</g>`;}}
    if(visible("stations"))for(const s of D.stations){const yy=routeY(interpolateY(s.km),height);out+=`<g ${attrs("駅",`${s.name}駅`,s.km,kmText(s.km),"")}><line class="station-guide" x1="${x(s.km)}" y1="32" x2="${x(s.km)}" y2="${yy+18}"/><circle class="station-dot" cx="${x(s.km)}" cy="${yy}" r="5"/><text class="station-name" x="${x(s.km)+5}" y="45">${escapeHtml(s.name)}</text></g>`;}
    if(visible("signals"))for(const s of D.signals){const lineY=routeY(interpolateY(s.km),height),offset=s.direction==="上り"?-18:18,yy=lineY+offset,css=`${s.direction==="上り"?"signal-up":"signal-down"}${s.kind==="中継"?" signal-relay":""}`,title=`${s.direction} ${s.kind}信号機 ${s.code||""}`.trim(),labelY=s.direction==="上り"?yy-7:yy+14;out+=`<g ${attrs("信号機",title,s.km,kmText(s.km),`${s.direction}／${s.kind}`)}><line class="facility-stem" x1="${x(s.km)}" y1="${lineY}" x2="${x(s.km)}" y2="${yy}"/><circle class="${css}" cx="${x(s.km)}" cy="${yy}" r="5"/>`;if(state.zoom>=118||state.layers.signals==="show")out+=`<text class="facility-label" fill="${s.direction==="上り"?"#a72e2a":"#155f99"}" x="${x(s.km)+7}" y="${labelY}">${escapeHtml(s.code||s.kind)}</text>`;out+=`</g>`;}
    if(visible("balises")){for(const b of D.poweredBalises){const lineY=routeY(interpolateY(b.km),height),offset=b.direction==="上り"?-31:31,yy=lineY+offset,css=b.direction==="上り"?"balise-up":"balise-down",target=String(b.code||"").split("-")[0],relation=b.distance?`制御対象 ${target}／信号まで ${b.distance}m`:"有電源地上子",labelY=b.direction==="上り"?yy-7:yy+15;out+=`<g ${attrs("有電源地上子",`${b.direction} ${b.code||""}`,b.km,kmText(b.km),relation)}><line class="facility-stem" x1="${x(b.km)}" y1="${lineY}" x2="${x(b.km)}" y2="${yy}"/><rect class="${css}" x="${x(b.km)-4.5}" y="${yy-4.5}" width="9" height="9" transform="rotate(45 ${x(b.km)} ${yy})"/>`;if(state.zoom>=180||state.layers.balises==="show")out+=`<text class="facility-label" fill="${b.direction==="上り"?"#a72e2a":"#155f99"}" x="${x(b.km)+8}" y="${labelY}">${escapeHtml(b.code||"")}</text>`;out+=`</g>`;}for(const b of D.passiveBalises){const lineY=routeY(interpolateY(b.km),height),yy=lineY+43;out+=`<g ${attrs("無電源地上子",b.code||"無電源地上子",b.km,kmText(b.km),b.value?`設定 ${b.value}`:"")}><line class="facility-stem" x1="${x(b.km)}" y1="${lineY}" x2="${x(b.km)}" y2="${yy}"/><rect class="balise-passive" x="${x(b.km)-6}" y="${yy-2.5}" width="12" height="5" rx="1.5"/>`;if(state.zoom>=180||state.layers.balises==="show")out+=`<text class="facility-label" fill="#414b4f" x="${x(b.km)+8}" y="${yy+4}">${escapeHtml(b.code||"")}</text>`;out+=`</g>`;}}
    if(visible("points"))for(const p of D.points){const yy=routeY(interpolateY(p.km),height);out+=`<g ${attrs("分岐器",`${p.name} 分岐器`,p.km,kmText(p.km),p.direction||"")}><path class="point-mark" d="M${x(p.km)-5} ${yy+7}l5 -10 5 10z"/></g>`;}
    if(visible("exits"))for(const e of D.exits){const yy=routeY(interpolateY(e.km),height);out+=`<g ${attrs("避難口",e.name||"避難口",e.km,kmText(e.km),"")}><rect class="exit-mark" x="${x(e.km)-4}" y="${yy-4}" width="8" height="8"/></g>`;}
    if(state.selected)out+=`<line class="selected-guide" x1="${x(state.selected.km)}" y1="24" x2="${x(state.selected.km)}" y2="${height-24}"/>`;
    routeSvg.innerHTML=out;renderAssetStrip();updateStageLabel();
  }

  function renderSpeed(){
    const height=Math.max(300,speedViewport.clientHeight||430),width=Math.max(speedViewport.clientWidth,PAD*2+TOTAL*state.zoom),sy=v=>28+(150-v)/150*(height-72);
    speedSvg.setAttribute("viewBox",`0 0 ${width} ${height}`);speedSvg.setAttribute("width",width);speedSvg.setAttribute("height",height);
    let out=`<rect width="${width}" height="${height}" fill="#fcfcfa"/>`;
    for(const v of [0,25,50,75,100,125,150])out+=`<line class="speed-grid-line${v%50?" minor":""}" x1="${PAD}" y1="${sy(v)}" x2="${width-PAD}" y2="${sy(v)}"/><text class="km-label" x="4" y="${sy(v)-3}">${v}</text>`;
    for(let km=0;km<=TOTAL;km+=state.zoom<18?5:1)out+=`<line class="speed-grid-line minor" x1="${x(km)}" y1="20" x2="${x(km)}" y2="${height-32}"/><text class="km-label" x="${x(km)+3}" y="${height-12}">${km}k</text>`;
    for(const s of D.stations)out+=`<line x1="${x(s.km)}" y1="21" x2="${x(s.km)}" y2="${height-32}" stroke="#929083"/><text class="station-name" x="${x(s.km)+4}" y="42">${escapeHtml(s.name)}</text>`;
    const selected=new Set($$("[data-speed]:checked").map(i=>i.dataset.speed));for(const dir of ["up","down"])if(selected.has(dir)){const pts=speedPoints(),path=pts.map((p,i)=>`${i?"L":"M"}${x(p.km).toFixed(1)} ${sy(p[dir]).toFixed(1)}`).join(" ");out+=`<path class="speed-line-${dir}" d="${path}"/>`;}
    speedSvg.innerHTML=out;
  }

  function assetSummary(row){return [row.category,row.categoryName,row.attribute,row.supplementalB].filter(value=>value!==null&&value!==undefined&&value!=="").join("　");}
  function renderAssetTable(query=""){
    const words=query.trim().toLowerCase().split(/\s+/).filter(Boolean),filtered=words.length?ASSETS.filter(row=>{const hay=row.raw.map(assetText).join(" ").toLowerCase();return words.every(word=>hay.includes(word));}):ASSETS;
    $("#assetCount").textContent=filtered.length===ASSETS.length?`${ASSETS.length}件・距離順`:`${filtered.length}件／${ASSETS.length}件`;
    $("#assetRows").innerHTML=filtered.map(row=>`<tr data-asset-id="${row.id}" data-km="${row.distanceKm}" class="asset-category-${row.categoryCode} ${row.id===state.selectedAssetId?"selected":""}"><td>${assetKmText(row.distanceKm)}</td><td class="asset-num">${row.distanceOrder}</td><td class="asset-num asset-muted">${row.currentOrder}</td><td class="asset-num">${row.categoryCode}</td><td>${escapeHtml(assetText(row.type1))}</td><td>${escapeHtml(assetText(row.type2))}</td><td>${escapeHtml(assetText(row.type3))}</td></tr>`).join("");
  }
  function selectedAsset(){return ASSETS.find(row=>row.id===state.selectedAssetId)||null;}
  function updateAssetSelection(reveal=false){const row=selectedAsset(),bar=$("#assetSelection");bar.classList.toggle("hidden",!row);$("#backToListBtn").classList.toggle("hidden",!row||state.mode==="list");if(!row)return;$("#assetSelectionName").textContent=assetSummary(row);$("#assetSelectionKm").textContent=`${assetKmText(row.distanceKm)}　距離順 ${row.distanceOrder}`;$$('#assetRows tr').forEach(tr=>tr.classList.toggle('selected',Number(tr.dataset.assetId)===row.id));if(reveal)requestAnimationFrame(()=>$("#assetRows").querySelector(`[data-asset-id="${row.id}"]`)?.scrollIntoView({block:"center",behavior:"smooth"}));}
  function selectAsset(id,reveal=false){const row=ASSETS.find(item=>item.id===Number(id));if(!row)return;state.selectedAssetId=row.id;state.centerKm=Math.max(0,Math.min(TOTAL,row.distanceKm));updateAssetSelection(reveal);save();}
  function openAssetInList(row){if(!row)return false;const search=$("#assetSearch");if(search&&search.value){search.value="";renderAssetTable();}selectAsset(row.id);setMode("list",row.distanceKm);return true;}
  function nearestAsset(km){return ASSETS.reduce((best,row)=>Math.abs(row.distanceKm-km)<Math.abs(best.distanceKm-km)?row:best,ASSETS[0]);}
  function assetForType(type,km){const match={"駅":["駅"],"トンネル":["T始点","T終点"],"勾配":["勾配","‰"],"曲線":["曲線"],"信号機":["信号機"],"有電源地上子":["有電源地上子"],"無電源地上子":["無電源地上子"],"避難口":["避難口"]}[type];if(!match)return null;const rows=ASSETS.filter(row=>match.includes(row.category));if(!rows.length)return null;const row=rows.reduce((best,item)=>Math.abs(item.distanceKm-km)<Math.abs(best.distanceKm-km)?item:best,rows[0]);return Math.abs(row.distanceKm-km)<=.11?row:null;}
  function updateDetailDock(name,km){$("#dockDetailHint").textContent=`${km}　${name}`;$("#detailDockBtn").classList.add("has-data");}
  function setDetailPanel(open){const panel=$("#infoBar"),button=$("#detailDockBtn");if(open)setTimePanel(false);panel.classList.toggle("open",Boolean(open));panel.setAttribute("aria-hidden",String(!open));button.classList.toggle("active",Boolean(open));button.setAttribute("aria-expanded",String(Boolean(open)));}
  function showAssetDetails(row){const km=Math.max(0,Math.min(TOTAL,row.distanceKm)),extras=[row.supplementalA,row.supplementalB,row.supplementalC,row.supplementalD,row.supplementalE,row.supplementalF].filter(value=>value!==null&&value!==undefined&&value!=="");selectAsset(row.id);state.selected={km};$("#infoName").textContent=assetSummary(row);$("#infoKm").textContent=assetKmText(row.distanceKm);$("#infoType").textContent=`${row.category}　距離順 ${row.distanceOrder}`;$("#infoRelation").textContent=extras.length?extras.join(" ／ "):"設備帯で選択した位置";updateDetailDock(assetSummary(row),assetKmText(row.distanceKm));renderRoute();save();}
  function showStripHit(hit){if(hit.row){openAssetInList(hit.row);return;}const linked=assetForType(hit.type,hit.km);if(linked){openAssetInList(linked);return;}state.selected={km:Math.max(0,Math.min(TOTAL,hit.km))};$("#infoName").textContent=hit.name;$("#infoKm").textContent=assetKmText(hit.km);$("#infoType").textContent=`${hit.type}　${hit.detail}`;$("#infoRelation").textContent=hit.relation;updateDetailDock(hit.name,assetKmText(hit.km));renderRoute();}
  function queueStripRender(){if(stripFrame)return;stripFrame=requestAnimationFrame(()=>{stripFrame=0;renderAssetStrip();});}
  function setAssetStripOpen(open,persist=true){state.assetStripOpen=Boolean(open);if(state.assetStripOpen)setTimePanel(false);document.body.classList.toggle("asset-strip-open",state.assetStripOpen);const button=$("#assetStripToggle");button.classList.toggle("active",state.assetStripOpen);button.setAttribute("aria-expanded",String(state.assetStripOpen));$("#assetDockState").textContent=state.assetStripOpen?"表示中":"非表示";if(state.assetStripOpen)setTimeout(renderAssetStrip,190);else stripHits=[];if(persist)save();}

  function speedAt(km,direction){
    const value=Math.max(0,Math.min(TOTAL,Number(km)||0)),points=speedPoints();
    if(value<=points[0].km)return Number(points[0][direction])||0;
    for(let i=1;i<points.length;i+=1)if(value<=points[i].km){const a=points[i-1],b=points[i],ratio=(value-a.km)/(b.km-a.km||1);return (Number(a[direction])||0)+((Number(b[direction])||0)-(Number(a[direction])||0))*ratio;}
    return Number(points.at(-1)[direction])||0;
  }
  function travelTime(start,end,direction){
    const low=Math.min(start,end),high=Math.max(start,end),distance=high-low;
    if(distance<=0)return {seconds:0,average:0};
    const points=[low,...speedPoints().map(point=>point.km).filter(km=>km>low&&km<high),high];let seconds=0;
    for(let i=1;i<points.length;i+=1){const a=points[i-1],b=points[i],averageSpeed=(speedAt(a,direction)+speedAt(b,direction))/2;if(averageSpeed<=0)return null;seconds+=(b-a)*3600/averageSpeed;}
    return {seconds,average:distance*3600/seconds};
  }
  function formatTime(seconds){const total=Math.max(0,Math.round(seconds));if(total>=3600)return `${Math.floor(total/3600)}:${String(Math.floor(total%3600/60)).padStart(2,"0")}:${String(total%60).padStart(2,"0")}`;return `${Math.floor(total/60)}:${String(total%60).padStart(2,"0")}`;}
  function setTimeResult(id,result){$(id).textContent=result?formatTime(result.seconds):"計算不可";$(id.replace("Time","Average")).textContent=result?`平均 ${Math.round(result.average)} km/h`:"速度を確認";}
  function updateTimeCalculation(start=state.timeStart,end=state.timeEnd,label=null){
    state.timeStart=Math.max(0,Math.min(TOTAL,Number(start)||0));state.timeEnd=Math.max(0,Math.min(TOTAL,Number(end)||0));
    const low=Math.min(state.timeStart,state.timeEnd),high=Math.max(state.timeStart,state.timeEnd),rangeLabel=label||`${kmText(state.timeStart)} ― ${kmText(state.timeEnd)}`;
    $("#upTimeTrain").textContent=`${trainLabel()} 上り`;$("#downTimeTrain").textContent=`${trainLabel()} 下り`;
    $("#timeRangeLabel").textContent=`${rangeLabel}　${kmText(state.timeStart)} ― ${kmText(state.timeEnd)}`;$("#timeDistanceResult").textContent=`${(high-low).toFixed(3)} km`;
    setTimeResult("#upTimeResult",travelTime(low,high,"up"));setTimeResult("#downTimeResult",travelTime(low,high,"down"));
    $("#timeDockState").textContent=state.timeMethod==="all"?"全線を計算":rangeLabel;renderRoute();save();
  }
  function setTimeMethod(method,refresh=true){
    state.timeMethod=method;$$('[data-time-method]').forEach(button=>button.classList.toggle("active",button.dataset.timeMethod===method));$$('[data-time-control]').forEach(control=>control.classList.toggle("active",control.dataset.timeControl===method));
    if(!refresh)return;
    if(method==="all")updateTimeCalculation(0,TOTAL,"全線");else if(method==="station")updateStationTime();else if(method==="express")selectExpressPreset(0);else updateDistanceTime();
  }
  function updateStationTime(){const a=D.stations[Number($("#startStation").value)]||D.stations[0],b=D.stations[Number($("#endStation").value)]||D.stations.at(-1);updateTimeCalculation(a.km,b.km,`${a.name}駅 ― ${b.name}駅`);}
  function selectExpressPreset(index){const a=expressStops[index],b=expressStops[index+1];if(!a||!b)return;$$('[data-express-index]').forEach(button=>button.classList.toggle("active",Number(button.dataset.expressIndex)===index));updateTimeCalculation(a.km,b.km,`${a.name} ― ${b.name}`);}
  function distanceValue(prefix){const km=Math.max(0,Number($(`#${prefix}Km`).value)||0),m=Math.max(0,Number($(`#${prefix}M`).value)||0);return Math.min(TOTAL,km+m/1000);}
  function updateDistanceTime(){updateTimeCalculation(distanceValue("start"),distanceValue("end"));}
  function setTimePanel(open){const panel=$("#timePanel"),button=$("#timeDockBtn");if(!panel||!button)return;panel.classList.toggle("open",Boolean(open));panel.setAttribute("aria-hidden",String(!open));button.classList.toggle("active",Boolean(open));button.setAttribute("aria-expanded",String(Boolean(open)));if(open){setDetailPanel(false);if(state.assetStripOpen)setAssetStripOpen(false);renderRoute();}else renderRoute();}
  function buildTimeControls(){
    const options=D.stations.map((station,index)=>`<option value="${index}">${station.name}　${kmText(station.km)}</option>`).join("");$("#startStation").innerHTML=options;$("#endStation").innerHTML=options;$("#startStation").value="0";$("#endStation").value=String(D.stations.length-1);
    $("#expressPresets").innerHTML=expressStops.slice(0,-1).map((station,index)=>`<button data-express-index="${index}">${station.name} ― ${expressStops[index+1].name}</button>`).join("");
    $("#trainSelect").value=state.selectedTrain;
    setTimeMethod(state.timeMethod,false);updateTimeCalculation(state.timeStart,state.timeEnd,state.timeMethod==="all"?"全線":null);
  }

  function selectTrain(id){if(!SPEED_PROFILES[id])return;state.selectedTrain=id;$("#trainSelect").value=id;updateTimeCalculation(state.timeStart,state.timeEnd);updatePrintCalculationToggle();renderRoute();renderSpeed();save();toast(`${trainLabel()}の通常速度を表示します`);}

  let printLayout="full",printRangeMode="station",printShowCalculation=false;
  function printGradientPoints(start,end){return [{km:start,y:interpolateY(start)},...D.gradient.filter(point=>point.km>start&&point.km<end),{km:end,y:interpolateY(end)}];}
  function makePrintSvg(start,end,large=false,scaleEnd=end,calculation=null){
    const width=1000,height=large?430:210,left=34,right=30,range=Math.max(.001,scaleEnd-start),px=km=>left+(km-start)/range*(width-left-right),gradient=printGradientPoints(start,end),values=gradient.map(point=>point.y),low=Math.min(...values),high=Math.max(...values),routeTop=large?92:52,routeBottom=large?294:148,py=value=>high-low<.00001?(routeTop+routeBottom)/2:routeTop+(high-value)/(high-low)*(routeBottom-routeTop),routePathLocal=points=>points.map((point,index)=>`${index?"L":"M"}${px(point.km).toFixed(1)} ${py(point.y).toFixed(1)}`).join(" "),speedPy=value=>24+(150-Math.max(0,Math.min(150,value)))/150*(height-(large?76:55)),speedMode=state.mode==="speed"&&state.speedDirections.length;
    let out=`<rect width="${width}" height="${height}" fill="#fff"/>`;
    if(speedMode){for(const value of [0,50,100,150]){const yy=speedPy(value);out+=`<line x1="${left}" y1="${yy}" x2="${width-right}" y2="${yy}" stroke="#d8dee0" stroke-width=".65"/><text x="${width-3}" y="${yy+2.5}" text-anchor="end" fill="#667176" font-size="${large?8:6.5}">${value}</text>`;}out+=`<text x="${width-3}" y="12" text-anchor="end" fill="#667176" font-size="${large?7:5.5}">km/h</text>`;}
    const gridStep=range<=2?.1:range<=12?1:5,first=Math.ceil(start/gridStep-.000001)*gridStep;
    for(let km=first;km<=end+.00001;km+=gridStep){const value=Math.round(km*1000)/1000,major=Math.abs(value-Math.round(value))<.0001,endpoint=Math.abs(value-start)<.0001||Math.abs(value-end)<.0001;out+=`<line x1="${px(value)}" y1="8" x2="${px(value)}" y2="${height-8}" stroke="${major?"#b7b0a3":"#ded9ce"}" stroke-width="${major?1:.6}"/>${endpoint?"":`<text x="${px(value)+2}" y="10" fill="#646965" font-size="${large?9:7}">${range<=2?kmText(value):`${Number(value.toFixed(1))}k`}</text>`}`;}
    if(visible("tunnels"))for(const tunnel of D.tunnels.filter(item=>item.end>=start&&item.start<=end)){const a=Math.max(start,tunnel.start),b=Math.min(end,tunnel.end),points=printGradientPoints(a,b),mid=(a+b)/2;out+=`<path d="${routePathLocal(points)}" fill="none" stroke="#303638" stroke-width="${large?10:7}" opacity=".72" stroke-linecap="round"/><text x="${px(mid)}" y="${py(interpolateY(mid))-7}" text-anchor="middle" fill="#3f4748" font-size="${large?10:7}" font-weight="700">${escapeHtml(tunnel.name)}</text>`;}
    out+=`<path d="${routePathLocal(gradient)}" fill="none" stroke="#244b59" stroke-width="${large?4:3}" stroke-linejoin="round" stroke-linecap="round"/>`;
    if(state.mode==="speed")for(const direction of state.speedDirections){const points=[{km:start,value:speedAt(start,direction)},...speedPoints().filter(point=>point.km>start&&point.km<end).map(point=>({km:point.km,value:point[direction]})),{km:end,value:speedAt(end,direction)}],path=points.map((point,index)=>`${index?"L":"M"}${px(point.km).toFixed(1)} ${speedPy(point.value).toFixed(1)}`).join(" "),color=direction==="up"?"#c13c38":"#1d72b8";out+=`<path d="${path}" fill="none" stroke="#fff" stroke-width="6" opacity=".8"/><path d="${path}" fill="none" stroke="${color}" stroke-width="3" stroke-linejoin="round"/>`;}
    if(visible("gradient"))for(const point of D.gradient.filter(item=>item.km>=start&&item.km<=end)){const label=`${point.permille>0?"+":""}${point.permille}‰`;out+=`<circle cx="${px(point.km)}" cy="${py(point.y)}" r="2.4" fill="#315666"/><text x="${px(point.km)+3}" y="${py(point.y)-4}" fill="#315666" font-size="${large?9:7}" font-weight="700">${label}</text>`;}
    if(visible("curves")){const base=height-13;for(const curve of curveSpans.filter(item=>item.end>=start&&item.start<=end)){const a=Math.max(start,curve.start),b=Math.min(end,curve.end);out+=`<path d="M${px(a)} ${base-6}V${base}H${px(b)}V${base-6}" fill="none" stroke="#a36b16" stroke-width="2"/>`;if(curve.radius&&(large||range<=12))out+=`<text x="${px((a+b)/2)}" y="${base-3}" text-anchor="middle" fill="#895a16" font-size="${large?9:7}" font-weight="700">R${curve.radius}</text>`;}}
    if(visible("stations")){const stations=D.stations.filter(item=>item.km>=start-.0001&&item.km<=end+.0001);stations.forEach((station,index)=>{const yy=py(interpolateY(station.km)),labelY=large?22+(index%2)*15:22;out+=`<line x1="${px(station.km)}" y1="${labelY+3}" x2="${px(station.km)}" y2="${yy+10}" stroke="#777b75" stroke-width=".8"/><circle cx="${px(station.km)}" cy="${yy}" r="${large?5:4}" fill="#fff" stroke="#173b4c" stroke-width="2"/><text x="${px(station.km)+4}" y="${labelY}" fill="#183641" font-size="${large?11:8}" font-weight="800">${escapeHtml(station.name)}</text>`;});}
    if(visible("signals"))for(const signal of D.signals.filter(item=>item.km>=start&&item.km<=end)){const lineY=py(interpolateY(signal.km)),offset=signal.direction==="上り"?(large?-22:-15):(large?22:15),yy=lineY+offset,color=signal.direction==="上り"?"#b73431":"#176aa1",relay=signal.kind==="中継";out+=`<circle cx="${px(signal.km)}" cy="${yy}" r="${large?4:3}" fill="${relay?"#fff":color}" stroke="${color}" stroke-width="${relay?1.2:1}"/>`;if(large||state.zoom>=118||state.layers.signals==="show")out+=`<text x="${px(signal.km)+5}" y="${signal.direction==="上り"?yy-4:yy+8}" fill="${color}" font-size="${large?8:6}" font-weight="700">${escapeHtml(signal.code||signal.kind)}</text>`;}
    if(visible("balises")){for(const balise of D.poweredBalises.filter(item=>item.km>=start&&item.km<=end)){const lineY=py(interpolateY(balise.km)),offset=balise.direction==="上り"?(large?-42:-27):(large?42:27),yy=lineY+offset,color=balise.direction==="上り"?"#b73431":"#176aa1",size=large?4:3;out+=`<path d="M${px(balise.km)} ${yy-size}l${size} ${size} -${size} ${size} -${size} -${size}z" fill="${color}"/>`;if(large||state.zoom>=180||state.layers.balises==="show")out+=`<text x="${px(balise.km)+5}" y="${yy-4}" fill="${color}" font-size="${large?7:5.5}" font-weight="700">${escapeHtml(balise.code||"")}</text>`;}for(const balise of D.passiveBalises.filter(item=>item.km>=start&&item.km<=end)){const yy=py(interpolateY(balise.km))+(large?55:35);out+=`<rect x="${px(balise.km)-4}" y="${yy-2}" width="8" height="4" rx="1" fill="#414b4f"/>`;if(large||state.zoom>=180||state.layers.balises==="show")out+=`<text x="${px(balise.km)+5}" y="${yy+3}" fill="#414b4f" font-size="${large?7:5.5}">${escapeHtml(balise.code||"")}</text>`;}}
    if(visible("points"))for(const point of D.points.filter(item=>item.km>=start&&item.km<=end)){const yy=py(interpolateY(point.km));out+=`<path d="M${px(point.km)-4} ${yy+6}l4 -8 4 8z" fill="#6d5c8e"/>`;}
    if(visible("exits"))for(const exit of D.exits.filter(item=>item.km>=start&&item.km<=end)){const yy=py(interpolateY(exit.km));out+=`<rect x="${px(exit.km)-3}" y="${yy-3}" width="6" height="6" fill="#c38729"/>`;}
    if(calculation){const boxX=Math.min(width-335,px(end)+18),boxY=34,boxW=300,boxH=height-60,columns=calculation.rows.length>7?2:1,rowsPerColumn=Math.ceil(calculation.rows.length/columns),columnW=boxW/columns,rowStep=columns===1?24:(boxH-48)/rowsPerColumn;out+=`<g class="print-calculation"><rect x="${boxX}" y="${boxY}" width="${boxW}" height="${boxH}" rx="8" fill="#fff" stroke="#89969a" stroke-width="1"/><text x="${boxX+12}" y="${boxY+18}" fill="#173b4c" font-size="10" font-weight="800">計算値　${escapeHtml(calculation.train)}</text>`;calculation.rows.forEach((row,index)=>{const column=Math.floor(index/rowsPerColumn),line=index%rowsPerColumn,baseX=boxX+column*columnW,yy=boxY+38+line*rowStep;out+=`<text x="${baseX+8}" y="${yy}" fill="#3f4f54" font-size="${columns===1?8:5.8}" font-weight="700">${escapeHtml(row.label)}</text><text x="${baseX+columnW-8}" y="${yy}" text-anchor="end" fill="#173b4c" font-size="${columns===1?8.5:6.2}" font-weight="800">${escapeHtml(row.value)}</text>`;});out+=`<text x="${boxX+12}" y="${boxY+boxH-9}" fill="#777f81" font-size="6.5">停車時間を含まない参考計算</text></g>`;}
    return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${kmText(start)}から${kmText(end)}までの路線図">${out}</svg>`;
  }
  function printDirectionTitle(){return state.speedDirections.map(direction=>direction==="up"?"のぼり":"くだり").join("・");}
  function updatePrintCalculationToggle(){const button=$("#printTimeToggle"),available=state.mode==="speed"&&state.speedDirections.length>0;if(!available)printShowCalculation=false;button.disabled=!available;button.setAttribute("aria-pressed",String(printShowCalculation));button.querySelector("strong").textContent=printShowCalculation?"計算値を表示中":"計算値を表示";button.querySelector("small").textContent=available?(speedProfile().kind==="local"?"6段目右側へ全駅間の参考時間を表示":"6段目右側へ特急3区間の参考時間を表示"):"速度表示にすると使用できます";}
  function printCalculationData(){const labels={up:"上",down:"下"},stops=speedProfile().kind==="local"?localStops():expressStops;return {train:trainLabel(),rows:stops.slice(0,-1).map((station,index)=>{const next=stops[index+1],value=state.speedDirections.map(direction=>{const result=travelTime(station.km,next.km,direction);return `${labels[direction]} ${result?formatTime(result.seconds):"--:--"}`;}).join("　");return {label:`${station.name} - ${next.name}`,value};})};}
  function openPrintDialog(open){const dialog=$("#printDialog");dialog.classList.toggle("open",Boolean(open));dialog.setAttribute("aria-hidden",String(!open));$("#printScrim").classList.toggle("hidden",!open);if(open){openSettings(false);updatePrintCalculationToggle();}}
  function setPrintLayout(layout){printLayout=layout;$$('[data-print-layout]').forEach(button=>button.classList.toggle("active",button.dataset.printLayout===layout));$("#printSectionControls").classList.toggle("hidden",layout!=="section");}
  function setPrintRangeMode(mode){printRangeMode=mode;$$('[data-print-range]').forEach(button=>button.classList.toggle("active",button.dataset.printRange===mode));$$('[data-print-range-control]').forEach(control=>control.classList.toggle("active",control.dataset.printRangeControl===mode));}
  function printDistanceValue(prefix){const km=Math.max(0,Number($(`#print${prefix}Km`).value)||0),m=Math.max(0,Number($(`#print${prefix}M`).value)||0);return Math.min(TOTAL,km+m/1000);}
  function setPrintDistance(prefix,value){const meters=Math.max(0,Math.min(Math.round(value*1000),Math.round(TOTAL*1000)));$(`#print${prefix}Km`).value=Math.floor(meters/1000);$(`#print${prefix}M`).value=meters%1000;}
  function printRange(){if(printLayout==="full")return {start:0,end:TOTAL,label:"全線"};if(printRangeMode==="station"){const a=D.stations[Number($("#printStartStation").value)]||D.stations[0],b=D.stations[Number($("#printEndStation").value)]||D.stations.at(-1);return {start:Math.min(a.km,b.km),end:Math.max(a.km,b.km),label:`${a.name}駅 ― ${b.name}駅`};}const a=printDistanceValue("Start"),b=printDistanceValue("End");return {start:Math.min(a,b),end:Math.max(a,b),label:"指定区間"};}
  function buildPrintControls(){const options=D.stations.map((station,index)=>`<option value="${index}">${station.name}　${kmText(station.km)}</option>`).join("");$("#printStartStation").innerHTML=options;$("#printEndStation").innerHTML=options;$("#printStartStation").value="0";$("#printEndStation").value=String(Math.max(1,D.stations.findIndex(station=>station.name==="佐用")));}
  function renderPrintSheet(){
    const range=printRange();if(range.end-range.start<.001){toast("開始と終了を別の位置にしてください");return false;}
    const sheet=$("#printSheet"),full=printLayout==="full",speedMode=state.mode==="speed"&&state.speedDirections.length>0,segments=full?[[0,10],[10,20],[20,30],[30,40],[40,50],[50,TOTAL]]:[[range.start,range.end]];sheet.classList.toggle("section",!full);sheet.setAttribute("aria-hidden","false");
    const speedTitle=$("#printSpeedTitle");speedTitle.textContent=speedMode?`${trainLabel()} ${printDirectionTitle()}`:"";speedTitle.classList.toggle("hidden",!speedMode);
    const shortKm=value=>Math.abs(value-TOTAL)<.0001?"56.1k":`${Number(value.toFixed(1))}k`,calculation=full&&speedMode&&printShowCalculation?printCalculationData():null;
    const rows=segments.map(([start,end],index)=>{const title=full?`${shortKm(start)}　　${shortKm(end)}`:`${range.label}　${kmText(start)} - ${kmText(end)}`;return `<section class="print-row"><div class="print-row-title">${title}</div>${makePrintSvg(start,end,!full,full?start+10:end,index===5?calculation:null)}</section>`;});
    $("#printRows").innerHTML=full?[0,2,4].map(index=>`<section class="print-fold-section">${rows[index]}${rows[index+1]}</section>`).join(""):`<section class="print-fold-section">${rows[0]}</section>`;
    const footer=$("#printSheetFooter"),withSectionCalculation=!full&&speedMode&&printShowCalculation;footer.classList.toggle("hidden",!withSectionCalculation);if(withSectionCalculation){const values=state.speedDirections.map(direction=>{const result=travelTime(range.start,range.end,direction);return `${direction==="up"?"上り":"下り"} <strong>${result?formatTime(result.seconds):"計算不可"}</strong>　平均 ${result?Math.round(result.average):"--"}km/h`;}).join("　　");footer.innerHTML=`<span><strong>計算値</strong>　${trainLabel()}／${kmText(range.start)}～${kmText(range.end)}</span><span>${values}</span>`;}
    let pageStyle=$("#printPageStyle");if(!pageStyle){pageStyle=document.createElement("style");pageStyle.id="printPageStyle";document.head.append(pageStyle);}pageStyle.textContent=`@page{size:A4 ${full?"portrait":"landscape"};margin:8mm}`;return true;
  }
  function startPrint(){if(!renderPrintSheet())return;window.print();}

  function updateStageLabel(){const label=state.zoom<18?"全体":state.zoom<68?"線路":state.zoom<110?"設備":"詳細";$("#fitBtn").textContent=label==="全体"?"全体":`${label}・全体へ`;}
  function viewport(){return routeViewport;}
  function center(){const v=viewport();return Math.max(0,Math.min(TOTAL,(v.scrollLeft+v.clientWidth/2-PAD)/state.zoom));}
  function fitZoom(){return Math.max(4,((viewport().clientWidth||innerWidth)-PAD*2)/TOTAL);}
  function routeRatio(){if(!routeViewport.clientHeight)return state.routeYRatio;const max=routeViewport.scrollHeight-routeViewport.clientHeight;return max>0?routeViewport.scrollTop/max:.5;}
  function updateNavigator(km=center()){const value=Math.max(0,Math.min(TOTAL,km));positionSlider.value=value.toFixed(2);positionOutput.value=kmText(value);positionOutput.textContent=kmText(value);}
  function save(){state.routeYRatio=routeRatio();try{localStorage.setItem("chizu-line-v2-view",JSON.stringify({mode:state.mode,zoom:state.zoom,centerKm:center(),routeYRatio:state.routeYRatio,layers:state.layers,selectedTrain:state.selectedTrain,speedDirections:state.speedDirections,selectedAssetId:state.selectedAssetId,assetStripOpen:state.assetStripOpen,timeMethod:state.timeMethod,timeStart:state.timeStart,timeEnd:state.timeEnd}));}catch(_){}}
  function scrollCenter(km,instant=false){const v=viewport();v.scrollTo({left:Math.max(0,x(km)-v.clientWidth/2),behavior:instant?"auto":"smooth"});updateNavigator(km);}
  function restoreRouteY(ratio=state.routeYRatio){const max=routeViewport.scrollHeight-routeViewport.clientHeight;routeViewport.scrollTop=Math.max(0,Math.min(max,max*ratio));}
  function setZoom(next,km=center()){const yRatio=routeRatio();state.zoom=Math.max(fitZoom(),Math.min(600,next));renderRoute();renderSpeed();requestAnimationFrame(()=>{scrollCenter(km,true);restoreRouteY(yRatio);save();});}
  function fitAll(){state.routeYRatio=.5;setZoom(fitZoom(),TOTAL/2);requestAnimationFrame(()=>requestAnimationFrame(()=>{restoreRouteY(.5);save();}));}
  function showItem(target,event){const g=target.closest("[data-name]");if(g){const km=Number(g.dataset.km),linked=assetForType(g.dataset.type,km);if(linked){openAssetInList(linked);return;}state.selected={km};$("#infoName").textContent=g.dataset.name;$("#infoKm").textContent=kmText(km);$("#infoType").textContent=g.dataset.type+(g.dataset.detail?`　${g.dataset.detail}`:"");$("#infoRelation").textContent=g.dataset.relation||"一覧に対応する行がないため、位置情報を表示しています";updateDetailDock(g.dataset.name,kmText(km));}else{if(state.mode!=="speed"||!event)return;const rect=routeViewport.getBoundingClientRect(),km=Math.max(0,Math.min(TOTAL,(routeViewport.scrollLeft+event.clientX-rect.left-PAD)/state.zoom)),points=speedPoints(),p=points.reduce((best,item)=>Math.abs(item.km-km)<Math.abs(best.km-km)?item:best,points[0]);state.selected={km:p.km};$("#infoName").textContent=`${trainLabel()} 速度`;$("#infoKm").textContent=kmText(p.km);$("#infoType").textContent=`上り ${p.up} km/h　下り ${p.down} km/h`;$("#infoRelation").textContent="赤：上り　青：下り";updateDetailDock(`${trainLabel()} 速度`,kmText(p.km));}renderRoute();}
  function closeInfo(){state.selected=null;$("#infoName").textContent="詳細情報";$("#infoKm").textContent="速度線などを選択してください";$("#infoType").textContent="構造物はタップすると設備一覧へ移動";$("#infoRelation").textContent="一覧の黄色い行から路線図へ戻れます";$("#dockDetailHint").textContent="選択なし";$("#detailDockBtn").classList.remove("has-data");setDetailPanel(false);renderRoute();}
  function buildSettings(){$("#layerSettings").innerHTML=layerInfo.map(([key,label,desc])=>`<div class="layer-row"><div class="layer-label"><strong>${label}</strong><span>${desc}</span></div><div class="tri-state" data-layer="${key}">${[["auto","自動"],["show","表示"],["hide","非表示"]].map(([value,text])=>`<button data-value="${value}" class="${(state.layers[key]||"auto")===value?"active":""}">${text}</button>`).join("")}</div></div>`).join("");$$('.tri-state button').forEach(b=>b.addEventListener("click",()=>{const h=b.closest('.tri-state');state.layers[h.dataset.layer]=b.dataset.value;h.querySelectorAll('button').forEach(x=>x.classList.toggle('active',x===b));renderRoute();save();}));}
  function openSettings(open){$("#settings").classList.toggle("open",open);$("#settings").setAttribute("aria-hidden",String(!open));$("#scrim").classList.toggle("hidden",!open);}
  function setMode(mode,requestedKm=null){const previous=state.mode,old=requestedKm===null?(state.zoom?center():state.centerKm):requestedKm;state.mode=mode;$$('.mode-tab').forEach(b=>b.classList.toggle('active',b.dataset.mode===mode));document.body.classList.toggle("list-mode",mode==="list");$("#routeWorkspace").classList.toggle("hidden",mode==="list");$("#speedWorkspace").classList.add("hidden");$("#assetWorkspace").classList.toggle("hidden",mode!=="list");$("#speedOverlayTools").classList.toggle("hidden",mode!=="speed");$("#modeTitle").textContent=mode==="route"?"路線図":mode==="speed"?"路線＋速度":"設備一覧";if(mode==="list"){setTimePanel(false);if(!selectedAsset()&&ASSETS.length)selectAsset(nearestAsset(old).id);updateAssetSelection(true);}else{closeInfo();requestAnimationFrame(()=>{renderRoute();scrollCenter(old,true);restoreRouteY();});}const target=mode==="list"?$("#assetWorkspace"):$("#routeWorkspace");target.classList.remove("mode-enter-up","mode-enter-down");void target.offsetWidth;target.classList.add(previous==="list"?"mode-enter-down":"mode-enter-up");setTimeout(()=>target.classList.remove("mode-enter-up","mode-enter-down"),240);save();}
  function toast(message){const el=$("#toast");el.textContent=message;el.classList.add("show");clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.classList.remove("show"),2200);}
  async function toggleOrientation(){if(state.fallbackLandscape){document.body.classList.remove("fallback-landscape");state.fallbackLandscape=false;toast("通常表示に戻しました");setTimeout(()=>setZoom(state.zoom,state.centerKm),120);return;}if(state.orientationLocked){try{screen.orientation?.unlock();if(document.fullscreenElement)await document.exitFullscreen();}catch(_){}state.orientationLocked=false;toast("画面方向の固定を解除しました");return;}try{if(!document.fullscreenElement&&document.documentElement.requestFullscreen)await document.documentElement.requestFullscreen();if(!screen.orientation?.lock)throw new Error("unsupported");await screen.orientation.lock("landscape");state.orientationLocked=true;toast("横画面にしました");}catch(_){if(matchMedia("(pointer: coarse)").matches){state.centerKm=center();document.body.classList.add("fallback-landscape");state.fallbackLandscape=true;toast("端末を横向きにしてください");setTimeout(()=>setZoom(state.zoom,state.centerKm),120);}else toast("PCではウィンドウを横に広げてください");}}

  function gestures(v){
    const pointers=new Map();let gesture=null;
    const values=()=>[...pointers.values()];
    const beginPan=point=>{gesture={kind:"pan",startX:point.x,startY:point.y,scrollLeft:v.scrollLeft,scrollTop:v.scrollTop};};
    const beginPinch=()=>{const [a,b]=values(),rect=v.getBoundingClientRect(),midX=(a.x+b.x)/2-rect.left,midY=(a.y+b.y)/2-rect.top,distance=Math.hypot(a.x-b.x,a.y-b.y);gesture={kind:"pinch",distance:Math.max(1,distance),zoom:state.zoom,km:(v.scrollLeft+midX-PAD)/state.zoom,contentY:v.scrollTop+midY};};
    v.addEventListener("pointerdown",e=>{v.closest('.workspace').classList.add('used');v.setPointerCapture?.(e.pointerId);pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});if(pointers.size===1)beginPan(values()[0]);else if(pointers.size===2)beginPinch();});
    v.addEventListener("pointermove",e=>{if(!pointers.has(e.pointerId))return;pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});if(pointers.size>=2){if(gesture?.kind!=="pinch")beginPinch();const [a,b]=values(),distance=Math.hypot(a.x-b.x,a.y-b.y),next=Math.max(fitZoom(),Math.min(600,gesture.zoom*distance/gesture.distance));state.zoom=next;renderRoute();renderSpeed();const rect=v.getBoundingClientRect(),midX=(a.x+b.x)/2-rect.left,midY=(a.y+b.y)/2-rect.top;v.scrollLeft=Math.max(0,PAD+gesture.km*state.zoom-midX);if(v===routeViewport)v.scrollTop=Math.max(0,gesture.contentY-midY);updateNavigator();}else if(pointers.size===1){const point=values()[0];if(gesture?.kind!=="pan")beginPan(point);v.scrollLeft=Math.max(0,gesture.scrollLeft-(point.x-gesture.startX));v.scrollTop=Math.max(0,gesture.scrollTop-(point.y-gesture.startY));updateNavigator();}});
    const end=e=>{pointers.delete(e.pointerId);if(pointers.size===1)beginPan(values()[0]);else if(pointers.size===0){gesture=null;save();}};
    v.addEventListener("pointerup",end);v.addEventListener("pointercancel",end);v.addEventListener("lostpointercapture",e=>{if(pointers.has(e.pointerId))end(e);});
    v.addEventListener("scroll",()=>{if(v===viewport())updateNavigator();clearTimeout(v.saveTimer);v.saveTimer=setTimeout(save,160);},{passive:true});
    v.addEventListener("wheel",e=>{if(!e.ctrlKey)return;e.preventDefault();setZoom(state.zoom*(e.deltaY>0?.88:1.14),center());},{passive:false});
  }

  setAssetStripOpen(state.assetStripOpen,false);buildSettings();
  $("#menuBtn").addEventListener("click",()=>openSettings(true));$("#menuClose").addEventListener("click",()=>openSettings(false));$("#scrim").addEventListener("click",()=>openSettings(false));
  $("#resetLayers").addEventListener("click",()=>{state.layers=Object.fromEntries(layerInfo.map(([key])=>[key,"auto"]));buildSettings();renderRoute();save();toast("すべて自動に戻しました");});
  $("#printSettingsBtn").addEventListener("click",()=>openPrintDialog(true));$("#printDialogClose").addEventListener("click",()=>openPrintDialog(false));$("#printScrim").addEventListener("click",()=>openPrintDialog(false));
  $$('[data-print-layout]').forEach(button=>button.addEventListener("click",()=>setPrintLayout(button.dataset.printLayout)));$$('[data-print-range]').forEach(button=>button.addEventListener("click",()=>setPrintRangeMode(button.dataset.printRange)));
  $("#printTimeToggle").addEventListener("click",()=>{if($("#printTimeToggle").disabled)return;printShowCalculation=!printShowCalculation;updatePrintCalculationToggle();});
  $("#useTimeRangeBtn").addEventListener("click",()=>{setPrintLayout("section");setPrintRangeMode("distance");setPrintDistance("Start",state.timeStart);setPrintDistance("End",state.timeEnd);toast("時間計算の区間を入れました");});$("#startPrintBtn").addEventListener("click",startPrint);window.addEventListener("afterprint",()=>$("#printSheet").setAttribute("aria-hidden","true"));
  $("#fitBtn").addEventListener("click",fitAll);$("#zoomInBtn").addEventListener("click",()=>setZoom(state.zoom*1.55));$("#zoomOutBtn").addEventListener("click",()=>setZoom(state.zoom/1.55));$("#orientationBtn").addEventListener("click",toggleOrientation);$("#infoClose").addEventListener("click",closeInfo);
  positionSlider.addEventListener("input",()=>scrollCenter(Number(positionSlider.value),true));positionSlider.addEventListener("change",save);
  $("#assetSearch").addEventListener("input",event=>{renderAssetTable(event.target.value);updateAssetSelection();});
  $("#assetRows").addEventListener("click",event=>{const row=event.target.closest("tr[data-asset-id]");if(row)selectAsset(row.dataset.assetId);});
  $("#showOnRouteBtn").addEventListener("click",()=>{const row=selectedAsset();if(!row)return;const routeKm=Math.max(0,Math.min(TOTAL,row.distanceKm));state.zoom=Math.max(state.zoom,70);setMode("route",routeKm);requestAnimationFrame(()=>showAssetDetails(row));});
  $("#backToListBtn").addEventListener("click",()=>setMode("list"));
  $("#detailDockBtn").addEventListener("click",()=>{const open=!$("#infoBar").classList.contains("open");if(open&&state.assetStripOpen)setAssetStripOpen(false);setDetailPanel(open);});
  $("#assetStripToggle").addEventListener("click",()=>{const open=!state.assetStripOpen;if(open)setDetailPanel(false);setAssetStripOpen(open);});
  $("#timeDockBtn").addEventListener("click",()=>setTimePanel(!$("#timePanel").classList.contains("open")));$("#timeClose").addEventListener("click",()=>setTimePanel(false));
  $$('[data-time-method]').forEach(button=>button.addEventListener("click",()=>setTimeMethod(button.dataset.timeMethod)));$("#startStation").addEventListener("change",updateStationTime);$("#endStation").addEventListener("change",updateStationTime);
  $("#expressPresets").addEventListener("click",event=>{const button=event.target.closest("[data-express-index]");if(button)selectExpressPreset(Number(button.dataset.expressIndex));});
  for(const id of ["#startKm","#startM","#endKm","#endM"])$(id).addEventListener("change",updateDistanceTime);
  $("#trainSelect").addEventListener("change",event=>selectTrain(event.target.value));
  $$(".mode-tab").forEach(b=>b.addEventListener("click",()=>setMode(b.dataset.mode)));$$('[data-speed]').forEach(i=>{i.checked=state.speedDirections.includes(i.dataset.speed);i.addEventListener("change",()=>{state.speedDirections=$$('[data-speed]:checked').map(item=>item.dataset.speed);updatePrintCalculationToggle();renderRoute();renderSpeed();save();});});
  routeSvg.addEventListener("click",e=>showItem(e.target,e));routeSvg.addEventListener("keydown",e=>{if(["Enter"," "].includes(e.key))showItem(e.target,e);});
  assetStrip.addEventListener("pointerdown",event=>{if(!state.assetStripOpen||event.target.closest("button")||stripGesture)return;assetStrip.setPointerCapture?.(event.pointerId);stripGesture={id:event.pointerId,startX:event.clientX,startScroll:routeViewport.scrollLeft,moved:false};});
  assetStrip.addEventListener("pointermove",event=>{if(!stripGesture||stripGesture.id!==event.pointerId)return;const dx=event.clientX-stripGesture.startX;if(Math.abs(dx)>5)stripGesture.moved=true;routeViewport.scrollLeft=Math.max(0,stripGesture.startScroll-dx);});
  const finishStripGesture=event=>{if(!stripGesture||stripGesture.id!==event.pointerId)return;const gesture=stripGesture;stripGesture=null;if(gesture.moved)return;const rect=assetStrip.getBoundingClientRect(),px=event.clientX-rect.left,py=event.clientY-rect.top;let best=null,bestDistance=Infinity;for(const hit of stripHits){const distance=hit.kind==="span"&&px>=Math.min(hit.x1,hit.x2)-5&&px<=Math.max(hit.x1,hit.x2)+5?Math.abs(py-hit.y):hit.kind==="point"?Math.hypot(px-hit.x,py-hit.y):Infinity;if(distance<bestDistance){best=hit;bestDistance=distance;}}if(best&&bestDistance<=14)showStripHit(best);};
  assetStrip.addEventListener("pointerup",finishStripGesture);assetStrip.addEventListener("pointercancel",event=>{if(stripGesture?.id===event.pointerId)stripGesture=null;});
  routeViewport.addEventListener("scroll",queueStripRender,{passive:true});
  document.addEventListener("contextmenu",e=>{if(!e.target.matches("input,textarea"))e.preventDefault();});document.addEventListener("dragstart",e=>e.preventDefault());
  gestures(routeViewport);gestures(speedViewport);renderAssetTable();updateAssetSelection();
  window.addEventListener("resize",()=>{const km=center(),yRatio=routeRatio();renderRoute();renderSpeed();requestAnimationFrame(()=>{scrollCenter(km,true);restoreRouteY(yRatio);});});
  if("serviceWorker" in navigator)window.addEventListener("load",()=>navigator.serviceWorker.register("./sw.js"));
  requestAnimationFrame(()=>{state.zoom=state.zoom===null?fitZoom():Math.max(fitZoom(),Math.min(600,state.zoom));buildTimeControls();buildPrintControls();renderRoute();renderSpeed();setMode(state.mode);requestAnimationFrame(()=>{scrollCenter(saved?state.centerKm:TOTAL/2,true);restoreRouteY();});});
})();
