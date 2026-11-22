/* Progress sync: sends right/wrong results to a private Google Sheet so reviews can target what gets missed.

   Sends ONLY: a random device id, card/question/section ids, right/wrong, scores, timestamps. No name, no answers typed, nothing else.
   Never changes or removes the games' own saved progress. If anything here fails, the games carry on as normal.
   ENDPOINT is an add-only Google Apps Script URL (sync/Code.gs). It cannot be used to read the Sheet.
   Results wait on the device and are sent later if there's no connection.
   Parent mode (switch on the Swipe "Progress (for parents)" screen): while on, this browser logs under a separate
   parent device id, so a parent's browsing on a shared phone isn't counted as his. It ends after 30 minutes idle,
   when turned off, or as soon as a question is answered or an Obby stage is run (that's him, so it counts as his). */
(function(){
"use strict";
var ENDPOINT="https://script.google.com/macros/s/AKfycbwJvnAwPuw_DF35k5DqDlWMkwIec07y3MU2fDwsLTch-OaU7Yman_DqSL_cB_T-yB-z/exec";   /* the Apps Script web app URL. Empty = sync is off and this file does nothing. */
var P="englishSync.",K_DEV=P+"device",K_Q=P+"queue",K_BF=P+"backfilled",K_NOTE=P+"noteSeen",K_PDEV=P+"parentDevice",K_PUNTIL=P+"parentUntil";
var PARENT_IDLE_MS=30*60000,PARENT_ENDS_ON={answer:1,run:1};
var BATCH=200,MAX_QUEUE=3000,RETRY_MS=60000;
var NOTE="Your right and wrong answers now go to a private sheet your dad can see, with no name attached, so your reviews get built around what you miss.";

var API={on:false,note:NOTE,log:function(){},flush:function(){},parent:{on:false,start:function(){},stop:function(){}}};
window.Sync=API;
if(!ENDPOINT)return;

var mem=[],memOnly=false,busy=false,nextTry=0,timer=null,seq=0;
function get(k){try{return localStorage.getItem(k)}catch(e){return null}}
function put(k,v){try{localStorage.setItem(k,v);return true}catch(e){return false}}
function parse(k){try{return JSON.parse(get(k))}catch(e){return null}}
function readQ(){if(memOnly)return mem;var q=parse(K_Q);return Array.isArray(q)?q:[]}
function writeQ(q){if(q.length>MAX_QUEUE)q=q.slice(q.length-MAX_QUEUE);if(!memOnly&&!put(K_Q,JSON.stringify(q))){memOnly=true}mem=q}

function randomId(){
  try{var b=new Uint8Array(6);crypto.getRandomValues(b);return Array.prototype.map.call(b,function(x){return("0"+x.toString(16)).slice(-2)}).join("")}
  catch(e){return(Math.random().toString(16).slice(2)+"000000000000").slice(0,12)}
}
var dev=get(K_DEV);if(!/^[0-9a-f]{12}$/.test(dev||"")){dev=randomId();put(K_DEV,dev)}

/* ---------- Parent mode ---------- */
function parentDev(){var p=get(K_PDEV);if(!/^[0-9a-f]{12}$/.test(p||"")||p===dev){p=randomId();if(p===dev)p=randomId();put(K_PDEV,p)}return p}
function parentOn(){var u=Number(get(K_PUNTIL)||0);if(u&&u>Date.now())return true;if(u){try{localStorage.removeItem(K_PUNTIL)}catch(e){}}return false}
function activeDev(){return parentOn()?parentDev():dev}
var badge=null,lastBump=0;
function bump(){if(!parentOn())return;var n=Date.now();if(n-lastBump<20000)return;lastBump=n;put(K_PUNTIL,String(n+PARENT_IDLE_MS))}
function drawBadge(){
  var on=parentOn();
  if(!on){if(badge){badge.remove();badge=null}return}
  if(badge||!document.body)return;
  badge=document.createElement("div");
  badge.setAttribute("role","status");
  badge.style.cssText="position:fixed;right:10px;bottom:calc(10px + env(safe-area-inset-bottom,0px));z-index:10000;display:flex;align-items:center;gap:8px;background:#2a2412;color:#f3e3b0;border:1px solid #6b5a22;border-radius:999px;padding:6px 6px 6px 12px;font:600 13px/1 system-ui,-apple-system,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.4)";
  var t=document.createElement("span");t.textContent="Parent mode";
  var b=document.createElement("button");b.type="button";b.textContent="Turn off";
  b.style.cssText="min-height:30px;padding:0 10px;background:#f3e3b0;color:#2a2412;border:0;border-radius:999px;font:600 13px system-ui,-apple-system,sans-serif;cursor:pointer";
  b.onclick=function(){stopParent()};
  badge.appendChild(t);badge.appendChild(b);document.body.appendChild(badge);
}
function startParent(){flush();parentDev();put(K_PUNTIL,String(Date.now()+PARENT_IDLE_MS));lastBump=Date.now();drawBadge();log("parent","on")}
function stopParent(){if(parentOn())log("parent","off");try{localStorage.removeItem(K_PUNTIL)}catch(e){}drawBadge();try{window.dispatchEvent(new Event("parentmode"))}catch(e){}}

var path=location.pathname.match(/\/(swipe|poetry|tpcastt|macbeth|essay|study-guide|fiction-obby)(\/|$)/);
var APP=path?path[1]:"home";

function slug(s){return String(s).replace(/[^A-Za-z0-9]+/g,"-").replace(/^-+|-+$/g,"").slice(0,60)}
function make(id,at,app,kind,item,result,value,dv){
  var e={id:id,at:at,app:app,kind:kind,item:item==null?"":String(item),result:result==null?"":String(result),value:value==null?"":String(value)};
  if(dv&&dv!==dev)e.dv=dv; /* which id to send it under; absent = this browser's own id */
  return e;
}

function log(kind,item,result,value){
  try{
    if(PARENT_ENDS_ON[kind]&&parentOn())stopParent(); /* a parent doesn't answer questions, so this is him: count it as his */
    else bump();
    var now=new Date(),q=readQ(),d=activeDev();
    q.push(make(d+"-"+now.getTime().toString(36)+"-"+(seq++),now.toISOString(),APP,kind,item,result,value,d));
    writeQ(q);
    clearTimeout(timer);timer=setTimeout(flush,4000);
  }catch(e){}
}

/* First run on a device: copy what's already saved there, so history isn't lost. Ids are fixed, so it can't double-count. */
function backfill(){
  if(get(K_BF))return;
  var out=[],now=new Date().toISOString();
  function add(at,app,kind,item,result,value,idTail){
    out.push(make("bf-"+dev+"-"+kind+"-"+(idTail||item||"x"),at||now,app,kind,item,result,value));
  }
  var w=parse("englishSwipe.v1");
  if(w&&typeof w==="object"){
    var wAt=w.last||now;
    if(w.sessions)add(wAt,"swipe","past_sessions","","",w.sessions,"swipe");
    Object.keys(w.miss||{}).forEach(function(id){add(wAt,"swipe","past_miss",id,"",w.miss[id])});
    Object.keys(w.topics||{}).forEach(function(t){var v=w.topics[t]||{};add(wAt,"swipe","past_topic",slug(t),"","r"+(v.r||0)+"w"+(v.w||0))});
    Object.keys(w.decks||{}).forEach(function(d){var v=w.decks[d]||{};add(wAt,"swipe","past_deck",d,"","best"+(v.best||0)+"runs"+(v.runs||0))});
  }
  var o=parse("fictionObby.v1");
  if(o&&typeof o==="object"){
    Object.keys(o.missed||{}).forEach(function(id){add(o.log&&o.log[0]&&o.log[0].at,"fiction-obby","past_miss",id,"",o.missed[id],"obby-"+id)});
    (o.log||[]).forEach(function(r){
      if(r&&r.at)add(r.at,"fiction-obby","run",r.stage,r.cleared?"cleared":"fell",r.correct+"of"+r.total,r.stage+"-"+slug(r.at));
    });
  }
  [["unit1Guide.v1","study-guide"],["unit2Guide.v1","poetry"],["unit2Guide2.v1","tpcastt"],["unit3Guide.v1","macbeth"],["unit3Essay.v1","essay"]].forEach(function(g){
    var d=parse(g[0]);if(!d||typeof d!=="object")return;
    Object.keys(d).forEach(function(k){if(d[k])add(now,g[1],"past_read",k,"done","",g[1]+"-"+k)});
  });
  writeQ(readQ().concat(out));
  put(K_BF,now);
}

function flush(leaving){
  try{
    if(busy&&!leaving)return;
    if(!leaving&&Date.now()<nextTry)return;
    var all=readQ();
    if(!all.length)return;
    var to=all[0].dv||dev; /* one device id per request */
    var batch=all.filter(function(e){return(e.dv||dev)===to}).slice(0,BATCH);
    var send=batch.map(function(e){return{id:e.id,at:e.at,app:e.app,kind:e.kind,item:e.item,result:e.result,value:e.value}});
    var opts={method:"POST",headers:{"Content-Type":"text/plain;charset=utf-8"},credentials:"omit",cache:"no-store",redirect:"follow",body:JSON.stringify({d:to,e:send})};
    if(leaving){opts.keepalive=true;fetch(ENDPOINT,opts).catch(function(){});return} /* kept in the queue; the Sheet ignores repeats */
    busy=true;
    fetch(ENDPOINT,opts).then(function(r){return r.json()}).then(function(j){
      busy=false;
      if(!j||j.ok!==true)throw 0;
      var sent={};batch.forEach(function(e){sent[e.id]=1});
      var left=readQ().filter(function(e){return !sent[e.id]});
      writeQ(left);
      nextTry=0;
      if(left.length)flush();
    }).catch(function(){busy=false;nextTry=Date.now()+RETRY_MS});
  }catch(e){busy=false}
}

/* A one-time heads-up on whichever page he opens first. */
function showNote(){
  drawBadge();
  if(get(K_NOTE)||parentOn())return;
  var d=document.createElement("div");
  d.setAttribute("role","status");
  d.style.cssText="position:fixed;left:12px;right:12px;bottom:calc(12px + env(safe-area-inset-bottom,0px));z-index:9999;max-width:480px;margin:0 auto;background:#17191f;color:#f1f2f4;border:1px solid #3a3e48;border-radius:12px;padding:14px;font:500 15px/1.4 system-ui,-apple-system,sans-serif;box-shadow:0 8px 28px rgba(0,0,0,.45)";
  var p=document.createElement("div");p.textContent=NOTE;
  var b=document.createElement("button");b.type="button";b.textContent="Got it";
  b.style.cssText="display:block;margin:10px 0 0 auto;min-height:40px;padding:0 16px;background:#f1f2f4;color:#17191f;border:0;border-radius:8px;font:600 15px system-ui,-apple-system,sans-serif;cursor:pointer";
  b.onclick=function(){put(K_NOTE,new Date().toISOString());d.remove()};
  d.appendChild(p);d.appendChild(b);document.body.appendChild(d);
}

API.on=true;API.log=log;API.flush=flush;
API.parent={get on(){return parentOn()},start:startParent,stop:stopParent};
["pointerdown","keydown","scroll","touchstart"].forEach(function(t){window.addEventListener(t,bump,{passive:true,capture:true})});
setInterval(function(){if(badge&&!parentOn()){drawBadge();try{window.dispatchEvent(new Event("parentmode"))}catch(e){}}},30000);
try{backfill()}catch(e){}
log("open");
document.addEventListener("visibilitychange",function(){if(document.visibilityState==="hidden")flush(true)});
window.addEventListener("pagehide",function(){flush(true)});
window.addEventListener("online",function(){nextTry=0;flush()});
if(document.body)showNote();else document.addEventListener("DOMContentLoaded",showNote);
})();
