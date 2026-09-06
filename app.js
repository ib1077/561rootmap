(() => {
  "use strict";
  const D = window.RAIL_DATA;
  const TOTAL = D.meta.totalKm;
  const PAD = 34;
  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];
  const routeViewport = $("#railViewport");
  const speedViewport = $("#speedViewport");
  const routeSvg = $("#railSvg");
  const speedSvg = $("#speedSvg");
  const positionSlider = $("#positionSlider");
  const positionOutput = $("#positionOutput");
  const saved = JSON.parse(localStorage.getItem("chizu-line-v2-view") || "null");
  const layerInfo = [
    ["stations", "駅", "全体から表示"], ["tunnels", "トンネル", "全体から表示"],
    ["gradient", "勾配", "少し拡大すると表示"], ["curves", "曲線", "少し拡大すると表示"],
    ["signals", "信号機", "詳しく拡大すると表示"], ["balises", "地上子", "さらに拡大すると表示"],
    ["points", "分岐器", "詳しく拡大すると表示"], ["exits", "避難口", "詳しく拡大すると表示"]
  ];
  const state = {
    mode: saved?.mode === "speed" ? "speed" : "route",
    zoom: Number.isFinite(saved?.zoom) ? saved.zoom : null,
    centerKm: Number.isFinite(saved?.centerKm) ? saved.centerKm : TOTAL / 2,
    layers: saved?.layers || Object.fromEntries(layerInfo.map(([key]) => [key, "auto"])),
    routeYRatio: Number.isFinite(saved?.routeYRatio) ? saved.routeYRatio : .5,
    selected: null, fallbackLandscape: false, orientationLocked: false
  };
  const minY = Math.min(...D.gradient.map(point => point.y));
  const maxY = Math.max(...D.gradient.map(point => point.y));
  const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[char]));
  const kmText = km => { const m = Math.max(0, Math.round(Number(km) * 1000)); return `${Math.floor(m / 1000)}k${String(m % 1000).padStart(3, "0")}m`; };
  const curveSpans = (() => { const spans=[]; let active=null; for(const item of D.curves){ if(["BC","BTC","BIT"].includes(item.mark)) active={start:item.km,radius:item.radius}; if(active&&["EC","ETC","EIT"].includes(item.mark)){spans.push({...active,end:item.km});active=null;} } return spans.filter(item=>item.end>item.start); })();

  function interpolateY(km) {
    if (km <= D.gradient[0].km) return D.gradient[0].y;
    for (let i=1;i<D.gradient.length;i+=1) if(km<=D.gradient[i].km){const a=D.gradient[i-1],b=D.gradient[i],r=(km-a.km)/(b.km-a.km||1);return a.y+(b.y-a.y)*r;}
    return D.gradient.at(-1).y;
  }
  function x(km){return PAD+km*state.zoom;}
  function routeContentHeight(){return Math.max(480,Math.round((routeViewport.clientHeight||400)*1.5));}
  function routeY(value,height){const visible=Math.max(260,routeViewport.clientHeight||height/1.5),span=Math.min(height-120,visible*.78),top=(height-span)/2;return top+(maxY-value)/(maxY-minY||1)*span;}
  function routePath(points,height){return points.map((p,i)=>`${i?"L":"M"}${x(p.km).toFixed(1)} ${routeY(p.y,height).toFixed(1)}`).join(" ");}
  function pointsBetween(start,end){return [{km:start,y:interpolateY(start)},...D.gradient.filter(p=>p.km>start&&p.km<end),{km:end,y:interpolateY(end)}];}
  function autoVisible(layer){if(["stations","tunnels"].includes(layer))return true;if(["gradient","curves"].includes(layer))return state.zoom>=24;if(["signals","points","exits"].includes(layer))return state.zoom>=68;if(layer==="balises")return state.zoom>=110;return false;}
  function visible(layer){const value=state.layers[layer]||"auto";return value==="show"||(value==="auto"&&autoVisible(layer));}
  function attrs(type,name,km,detail="",relation=""){return `class="clickable" tabindex="0" role="button" data-type="${escapeHtml(type)}" data-name="${escapeHtml(name)}" data-km="${km}" data-detail="${escapeHtml(detail)}" data-relation="${escapeHtml(relation)}"`;}

  function renderRoute(){
    const height=routeContentHeight(),width=Math.max(routeViewport.clientWidth,PAD*2+TOTAL*state.zoom);
    routeSvg.setAttribute("viewBox",`0 0 ${width} ${height}`);routeSvg.setAttribute("width",width);routeSvg.setAttribute("height",height);routeSvg.style.height=`${height}px`;
    let out=`<rect width="${width}" height="${height}" fill="#f2efe4" opacity=".96"/>`;
    const step=state.zoom<16?5:state.zoom<55?1:.1;
    for(let km=0;km<=TOTAL+.0001;km+=step){const n=Math.round(km*10)/10,major=Math.abs(n%5)<.001;out+=`<line class="rail-grid${major?" major":""}" x1="${x(n)}" y1="22" x2="${x(n)}" y2="${height-28}"/>`;if(major||state.zoom>=42)out+=`<text class="km-label" x="${x(n)+3}" y="18">${state.zoom>=85?kmText(n):`${Number(n.toFixed(1))}k`}</text>`;}
    if(visible("tunnels"))for(const t of D.tunnels){const start=Math.max(0,t.start),end=Math.min(TOTAL,t.end);if(end<=0||start>=TOTAL)continue;out+=`<g ${attrs("トンネル",`${t.name}トンネル`,start,`${kmText(start)} — ${kmText(end)}`,`延長 ${Math.round((end-start)*1000)}m`)}><path class="tunnel-line" d="${routePath(pointsBetween(start,end),height)}"/>`;const pixels=(end-start)*state.zoom;if(state.zoom>=19||pixels>=31){const mid=(start+end)/2;out+=`<text class="tunnel-name" x="${x(mid)}" y="${routeY(interpolateY(mid),height)-9}" text-anchor="middle">${escapeHtml(t.name)}</text>`;}out+=`</g>`;}
    out+=`<path class="route-line" d="${routePath(D.gradient.filter(p=>p.km>=0&&p.km<=TOTAL),height)}"/>`;
    if(visible("gradient"))for(const p of D.gradient.filter(p=>p.km>=0&&p.km<=TOTAL)){const yy=routeY(p.y,height),label=`${p.permille>0?"+":""}${p.permille}‰`;out+=`<g ${attrs("勾配",label,p.km,`${kmText(p.km)}から`,"勾配変化点")}><circle cx="${x(p.km)}" cy="${yy}" r="3.4" fill="#315666"/><text class="gradient-label" x="${x(p.km)+5}" y="${yy-7}">${label}</text></g>`;}
    if(visible("curves")){const baseY=height-35;for(const c of curveSpans){out+=`<g ${attrs("曲線",c.radius?`R${c.radius}`:"曲線区間",c.start,`${kmText(c.start)} — ${kmText(c.end)}`,`延長 ${Math.round((c.end-c.start)*1000)}m`)}><path class="curve-mark" d="M${x(c.start)} ${baseY-8}V${baseY}H${x(c.end)}V${baseY-8}"/>`;if(state.zoom>=38&&c.radius)out+=`<text class="curve-label" x="${x((c.start+c.end)/2)}" y="${baseY-4}" text-anchor="middle">R${c.radius}</text>`;out+=`</g>`;}}
    if(visible("stations"))for(const s of D.stations){const yy=routeY(interpolateY(s.km),height);out+=`<g ${attrs("駅",`${s.name}駅`,s.km,kmText(s.km),"")}><line class="station-guide" x1="${x(s.km)}" y1="32" x2="${x(s.km)}" y2="${yy+18}"/><circle class="station-dot" cx="${x(s.km)}" cy="${yy}" r="5"/><text class="station-name" x="${x(s.km)+5}" y="45">${escapeHtml(s.name)}</text></g>`;}
    if(visible("signals"))for(const s of D.signals){const yy=routeY(interpolateY(s.km),height)+(s.direction==="上り"?-17:17),css=s.direction==="上り"?"signal-up":"signal-down",title=`${s.direction} ${s.kind}信号機 ${s.code||""}`.trim();out+=`<g ${attrs("信号機",title,s.km,kmText(s.km),`${s.direction}／${s.kind}`)}><circle class="${css}" cx="${x(s.km)}" cy="${yy}" r="5"/>`;if(state.zoom>=118||state.layers.signals==="show")out+=`<text class="facility-label" fill="${s.direction==="上り"?"#a72e2a":"#155f99"}" x="${x(s.km)+6}" y="${yy-6}">${escapeHtml(s.code||s.kind)}</text>`;out+=`</g>`;}
    if(visible("balises")){const upY=height-70,downY=height-55,passiveY=height-42;for(const b of D.poweredBalises){const yy=b.direction==="上り"?upY:downY,css=b.direction==="上り"?"balise-up":"balise-down",target=String(b.code||"").split("-")[0],relation=b.distance?`制御対象 ${target}／信号まで ${b.distance}m`:"有電源地上子";out+=`<g ${attrs("有電源地上子",`${b.direction} ${b.code||""}`,b.km,kmText(b.km),relation)}><rect class="${css}" x="${x(b.km)-4}" y="${yy-4}" width="8" height="8" transform="rotate(45 ${x(b.km)} ${yy})"/>`;if(state.zoom>=180||state.layers.balises==="show")out+=`<text class="facility-label" fill="${b.direction==="上り"?"#a72e2a":"#155f99"}" x="${x(b.km)+6}" y="${yy-5}">${escapeHtml(b.code||"")}</text>`;out+=`</g>`;}for(const b of D.passiveBalises)out+=`<g ${attrs("無電源地上子",b.code||"無電源地上子",b.km,kmText(b.km),b.value?`設定 ${b.value}`:"")}><circle class="balise-passive" cx="${x(b.km)}" cy="${passiveY}" r="3.5"/></g>`;}
    if(visible("points"))for(const p of D.points){const yy=routeY(interpolateY(p.km),height);out+=`<g ${attrs("分岐器",`${p.name} 分岐器`,p.km,kmText(p.km),p.direction||"")}><path class="point-mark" d="M${x(p.km)-5} ${yy+7}l5 -10 5 10z"/></g>`;}
    if(visible("exits"))for(const e of D.exits){const yy=routeY(interpolateY(e.km),height);out+=`<g ${attrs("避難口",e.name||"避難口",e.km,kmText(e.km),"")}><rect class="exit-mark" x="${x(e.km)-4}" y="${yy-4}" width="8" height="8"/></g>`;}
    if(state.selected)out+=`<line class="selected-guide" x1="${x(state.selected.km)}" y1="24" x2="${x(state.selected.km)}" y2="${height-24}"/>`;
    routeSvg.innerHTML=out;updateStageLabel();
  }

  function renderSpeed(){
    const height=Math.max(300,speedViewport.clientHeight||430),width=Math.max(speedViewport.clientWidth,PAD*2+TOTAL*state.zoom),sy=v=>28+(140-v)/140*(height-72);
    speedSvg.setAttribute("viewBox",`0 0 ${width} ${height}`);speedSvg.setAttribute("width",width);speedSvg.setAttribute("height",height);
    let out=`<rect width="${width}" height="${height}" fill="#f2efe4" opacity=".96"/>`;
    for(const v of [0,20,40,60,80,100,120,140])out+=`<line class="speed-grid-line${v%40?" minor":""}" x1="${PAD}" y1="${sy(v)}" x2="${width-PAD}" y2="${sy(v)}"/><text class="km-label" x="4" y="${sy(v)-3}">${v}</text>`;
    for(let km=0;km<=TOTAL;km+=state.zoom<18?5:1)out+=`<line class="speed-grid-line minor" x1="${x(km)}" y1="20" x2="${x(km)}" y2="${height-32}"/><text class="km-label" x="${x(km)+3}" y="${height-12}">${km}k</text>`;
    for(const s of D.stations)out+=`<line x1="${x(s.km)}" y1="21" x2="${x(s.km)}" y2="${height-32}" stroke="#929083"/><text class="station-name" x="${x(s.km)+4}" y="42">${escapeHtml(s.name)}</text>`;
    const selected=new Set($$("[data-speed]:checked").map(i=>i.dataset.speed));for(const dir of ["up","down"])if(selected.has(dir)){const pts=D.speeds.filter(p=>p[dir]>0),path=pts.map((p,i)=>`${i?"L":"M"}${x(p.km).toFixed(1)} ${sy(p[dir]).toFixed(1)}`).join(" ");out+=`<path class="speed-line-${dir}" d="${path}"/>`;}
    speedSvg.innerHTML=out;
  }

  function updateStageLabel(){const label=state.zoom<18?"全体":state.zoom<68?"線路":state.zoom<110?"設備":"詳細";$("#fitBtn").textContent=label==="全体"?"全体":`${label}・全体へ`;}
  function viewport(){return state.mode==="route"?routeViewport:speedViewport;}
  function center(){const v=viewport();return Math.max(0,Math.min(TOTAL,(v.scrollLeft+v.clientWidth/2-PAD)/state.zoom));}
  function fitZoom(){return Math.max(4,((viewport().clientWidth||innerWidth)-PAD*2)/TOTAL);}
  function routeRatio(){if(!routeViewport.clientHeight)return state.routeYRatio;const max=routeViewport.scrollHeight-routeViewport.clientHeight;return max>0?routeViewport.scrollTop/max:.5;}
  function updateNavigator(km=center()){const value=Math.max(0,Math.min(TOTAL,km));positionSlider.value=value.toFixed(2);positionOutput.value=kmText(value);positionOutput.textContent=kmText(value);}
  function save(){state.routeYRatio=routeRatio();localStorage.setItem("chizu-line-v2-view",JSON.stringify({mode:state.mode,zoom:state.zoom,centerKm:center(),routeYRatio:state.routeYRatio,layers:state.layers}));}
  function scrollCenter(km,instant=false){const v=viewport();v.scrollTo({left:Math.max(0,x(km)-v.clientWidth/2),behavior:instant?"auto":"smooth"});updateNavigator(km);}
  function restoreRouteY(ratio=state.routeYRatio){const max=routeViewport.scrollHeight-routeViewport.clientHeight;routeViewport.scrollTop=Math.max(0,Math.min(max,max*ratio));}
  function setZoom(next,km=center()){const yRatio=routeRatio();state.zoom=Math.max(fitZoom(),Math.min(600,next));renderRoute();renderSpeed();requestAnimationFrame(()=>{scrollCenter(km,true);restoreRouteY(yRatio);save();});}
  function fitAll(){state.routeYRatio=.5;setZoom(fitZoom(),TOTAL/2);requestAnimationFrame(()=>requestAnimationFrame(()=>{restoreRouteY(.5);save();}));}
  function showItem(target){const g=target.closest("[data-name]");if(!g)return;state.selected={km:Number(g.dataset.km)};$("#infoName").textContent=g.dataset.name;$("#infoKm").textContent=kmText(g.dataset.km);$("#infoType").textContent=g.dataset.type+(g.dataset.detail?`　${g.dataset.detail}`:"");$("#infoRelation").textContent=g.dataset.relation||"位置を表示しています";$("#infoBar").classList.add("expanded");$("#infoClose").classList.remove("hidden");renderRoute();}
  function closeInfo(){state.selected=null;$("#infoName").textContent=state.mode==="route"?"全線表示":"速度モード";$("#infoKm").textContent="0k000m — 56k100m";$("#infoType").textContent=state.mode==="route"?"駅・トンネルを表示中":"7000 速度カーブ";$("#infoRelation").textContent=state.mode==="route"?"設備をタップすると詳しく表示します":"赤：上り　青：下り";$("#infoBar").classList.remove("expanded");$("#infoClose").classList.add("hidden");renderRoute();}
  function buildSettings(){$("#layerSettings").innerHTML=layerInfo.map(([key,label,desc])=>`<div class="layer-row"><div class="layer-label"><strong>${label}</strong><span>${desc}</span></div><div class="tri-state" data-layer="${key}">${[["auto","自動"],["show","表示"],["hide","非表示"]].map(([value,text])=>`<button data-value="${value}" class="${(state.layers[key]||"auto")===value?"active":""}">${text}</button>`).join("")}</div></div>`).join("");$$('.tri-state button').forEach(b=>b.addEventListener("click",()=>{const h=b.closest('.tri-state');state.layers[h.dataset.layer]=b.dataset.value;h.querySelectorAll('button').forEach(x=>x.classList.toggle('active',x===b));renderRoute();save();}));}
  function openSettings(open){$("#settings").classList.toggle("open",open);$("#settings").setAttribute("aria-hidden",String(!open));$("#scrim").classList.toggle("hidden",!open);}
  function setMode(mode){const old=state.zoom?center():state.centerKm;state.mode=mode;$$('.mode-tab').forEach(b=>b.classList.toggle('active',b.dataset.mode===mode));$("#routeWorkspace").classList.toggle("hidden",mode!=="route");$("#speedWorkspace").classList.toggle("hidden",mode!=="speed");$("#modeTitle").textContent=mode==="route"?"路線図":"速度";closeInfo();requestAnimationFrame(()=>{renderRoute();renderSpeed();scrollCenter(old,true);restoreRouteY();save();});}
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

  buildSettings();
  $("#menuBtn").addEventListener("click",()=>openSettings(true));$("#menuClose").addEventListener("click",()=>openSettings(false));$("#scrim").addEventListener("click",()=>openSettings(false));
  $("#resetLayers").addEventListener("click",()=>{state.layers=Object.fromEntries(layerInfo.map(([key])=>[key,"auto"]));buildSettings();renderRoute();save();toast("すべて自動に戻しました");});
  $("#fitBtn").addEventListener("click",fitAll);$("#zoomInBtn").addEventListener("click",()=>setZoom(state.zoom*1.55));$("#zoomOutBtn").addEventListener("click",()=>setZoom(state.zoom/1.55));$("#orientationBtn").addEventListener("click",toggleOrientation);$("#infoClose").addEventListener("click",closeInfo);
  positionSlider.addEventListener("input",()=>scrollCenter(Number(positionSlider.value),true));positionSlider.addEventListener("change",save);
  $$(".mode-tab").forEach(b=>b.addEventListener("click",()=>setMode(b.dataset.mode)));$$('[data-speed]').forEach(i=>i.addEventListener("change",renderSpeed));
  routeSvg.addEventListener("click",e=>showItem(e.target));routeSvg.addEventListener("keydown",e=>{if(["Enter"," "].includes(e.key))showItem(e.target);});
  document.addEventListener("contextmenu",e=>{if(!e.target.matches("input,textarea"))e.preventDefault();});document.addEventListener("dragstart",e=>e.preventDefault());
  gestures(routeViewport);gestures(speedViewport);
  window.addEventListener("resize",()=>{const km=center(),yRatio=routeRatio();renderRoute();renderSpeed();requestAnimationFrame(()=>{scrollCenter(km,true);restoreRouteY(yRatio);});});
  if("serviceWorker" in navigator)window.addEventListener("load",()=>navigator.serviceWorker.register("./sw.js"));
  requestAnimationFrame(()=>{state.zoom=state.zoom===null?fitZoom():Math.max(fitZoom(),Math.min(600,state.zoom));renderRoute();renderSpeed();setMode(state.mode);requestAnimationFrame(()=>{scrollCenter(saved?state.centerKm:TOTAL/2,true);restoreRouteY();});});
})();
