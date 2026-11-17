/* Builds report/map.csv and report/cards.csv, which the parent's progress tracker (a private Google Sheet) reads.
   Run after adding a deck, a guide section or a card:  node report/build.js
   map.csv   = every guide section, Swipe deck and Obby stage, newest material first.
   cards.csv = every question id with its deck, question and correct answer (already public in the pages). */
const fs=require("fs"),path=require("path");
const R=path.join(__dirname,"..");
const read=f=>fs.readFileSync(path.join(R,f),"utf8");
const csv=rows=>rows.map(r=>r.map(v=>{v=String(v==null?"":v);return /[",\n]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v}).join(",")).join("\n")+"\n";
const strip=s=>String(s).replace(/<[^>]+>/g," ").replace(/&amp;/g,"&").replace(/&nbsp;/g," ").replace(/\s+/g," ").trim();

/* Swipe */
const sw=read("swipe/index.html");
const swSrc=sw.slice(sw.indexOf("const DECKS="),sw.indexOf("CARDS.forEach"));
const {DECKS,CARDS}=new Function(swSrc+";return {DECKS,CARDS}")();
CARDS.forEach((c,i)=>c.id=c.deck+"-"+i);

/* Fiction Obby */
const ob=read("fiction-obby/index.html");
const obSrc=ob.slice(ob.indexOf("const STAGES"),ob.indexOf("];",ob.indexOf("const STAGES"))+2);
const STAGES=new Function(obSrc+";return STAGES")();

/* Guides, newest first */
const GUIDES=[["essay","Essay Kit"],["macbeth","Macbeth guide"],["tpcastt","Break a Poem"],["poetry","Poetry Starter"],["study-guide","Unit 1 Survival Guide"]];
const map=[["kind","app","key","group","label"]];
const guideRows=g=>{
  const h=read(g[0]+"/index.html");
  const keys=JSON.parse(h.match(/keys\s*=\s*(\[[^\]]*\])/)[1]);
  keys.forEach(k=>{const m=h.match(new RegExp('<a href="#'+k+'" data-k="'+k+'">([^<]*)</a>'));let lab=m?strip(m[1]):k;if(lab===lab.toUpperCase())lab=lab.replace(/^\d+\s*/,"").toLowerCase().replace(/(^|\s)\S/g,x=>x.toUpperCase());map.push(["guide",g[0],k,g[1],lab])});
};
/* Interleave: each unit's guides, then that unit's decks. */
const deckRow=k=>map.push(["deck","swipe",k,"Swipe decks",DECKS[k].name]);
guideRows(GUIDES[0]);guideRows(GUIDES[1]);
Object.keys(DECKS).forEach(deckRow);   /* DECKS is already newest first */
guideRows(GUIDES[2]);guideRows(GUIDES[3]);guideRows(GUIDES[4]);
STAGES.forEach(s=>map.push(["stage","fiction-obby",s.id,"Fiction Obby",s.name]));
fs.writeFileSync(path.join(__dirname,"map.csv"),csv(map));

const cards=[["id","deck","question","answer"]];
CARDS.filter(c=>c.t==="check").forEach(c=>cards.push([c.id,DECKS[c.deck].name,c.q,c.opts[c.a]]));
STAGES.forEach(s=>(s.qs||s.questions||[]).forEach(q=>cards.push([q.id,"Fiction Obby: "+s.name,strip((q.sc?q.sc+" ":"")+q.q),strip(q.a)])));
fs.writeFileSync(path.join(__dirname,"cards.csv"),csv(cards));
console.log("map rows",map.length-1,"cards",cards.length-1);
