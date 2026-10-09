// Photography: archive-driven gallery (responsive images, theme filters) and an accessible lightbox.
// Data: photographie/data/archive.json — schema and image workflow in photographie/_outils/LISEZMOI.md.
(()=>{"use strict";
const ARCHIVE="photographie/data/archive.json";
const TYPES={avif:"image/avif",webp:"image/webp",jpg:"image/jpeg",jpeg:"image/jpeg",png:"image/png"};
// Rendered widths, matching css/photographie.css (3 columns above 900px, one below).
const SIZES={single:"(max-width: 900px) calc(100vw - 32px), 410px",cover:"(max-width: 900px) calc(100vw - 32px), 680px",seq:"(max-width: 900px) 22vw, 120px",full:"100vw"};
const canDialog=typeof HTMLDialogElement==="function"&&"showModal" in HTMLDialogElement.prototype;
const qs=(s,p=document)=>p.querySelector(s);
const qsa=(s,p=document)=>[...p.querySelectorAll(s)];
const plural=(n,one,many)=>n+" "+(n>1?many:one);
const list=v=>Array.isArray(v)?v:[];
// Theme names are set in the serif, in sentence case like every name on the site (« Ville », not « VILLE »);
// a label the archive already writes in mixed case is kept as written.
const sentence=v=>{const s=String(v||"");return s&&s===s.toLocaleUpperCase("fr")?s.charAt(0)+s.slice(1).toLocaleLowerCase("fr"):s;};

/** DOM builder: text goes through textContent, never through innerHTML. */
function h(tag,attrs,...kids){
  const n=document.createElement(tag);
  for(const[k,v] of Object.entries(attrs||{})){
    if(v==null||v===false)continue;
    if(k==="text")n.textContent=v;
    else n.setAttribute(k,v===true?"":String(v));
  }
  for(const kid of kids)if(kid!=null&&kid!==false)n.append(kid);
  return n;
}

/** Resolves photo references; an entry without image or without alt text is not published. */
function normalise(data){
  const pool=data&&typeof data.photos==="object"&&data.photos?data.photos:{};
  const skipped=new Set();
  const resolve=ref=>{
    const raw=typeof ref==="string"?{...pool[ref],id:ref}:ref;
    if(!raw||typeof raw!=="object")return null;
    const id=String(raw.id||"").trim();
    const img=raw.image||{};
    const hasImage=(img.base&&Array.isArray(img.widths)&&img.widths.length)||raw.src;
    if(!id||!hasImage||!String(raw.alt||"").trim()){skipped.add(id||"?");return null;}
    return{...raw,id};
  };
  const singles=list(data.singles).map(resolve).filter(Boolean);
  const series=list(data.series).map(s=>{
    const photos=list(s&&s.photos).map(resolve).filter(Boolean);
    if(!photos.length)return null;
    return{...s,id:String(s.id||s.slug||""),photos,cover:photos.find(p=>p.id===s.cover)||photos[0]};
  }).filter(s=>s&&s.id);
  if(skipped.size)console.warn("[photographie] non publiées (image ou texte alternatif manquant) :",[...skipped].join(", "));
  const themes=list(data.themes).filter(t=>t&&typeof t==="object").map(t=>({...t,label:sentence(t.label)}));
  return{themes,singles,series};
}

const variants=p=>{
  const img=p.image||{};
  const widths=list(img.widths).map(Number).filter(w=>w>0).sort((a,b)=>a-b);
  const formats=list(img.formats).length?list(img.formats).map(String):["jpg"];
  const fallback=formats.includes("jpg")?"jpg":formats.includes("jpeg")?"jpeg":formats[formats.length-1];
  return{img,widths,formats,fallback,ok:!!(img.base&&widths.length)};
};
const srcset=(v,f)=>v.widths.map(w=>v.img.base+"-"+w+"."+f+" "+w+"w").join(", ");
const largest=p=>{const v=variants(p);return v.ok?v.img.base+"-"+v.widths[v.widths.length-1]+"."+v.fallback:p.src;};

/** <picture> with modern formats first; dimensions are reserved so nothing shifts while loading. */
function picture(p,sizes,{eager=false,className=null}={}){
  const v=variants(p);
  const pic=h("picture",{class:className});
  if(v.ok)v.formats.filter(f=>f!==v.fallback).forEach(f=>pic.append(h("source",{type:TYPES[f]||"image/"+f,srcset:srcset(v,f),sizes})));
  const img=h("img",{loading:eager?"eager":"lazy",decoding:"async",fetchpriority:eager?"high":null,alt:p.alt,width:v.img.width||p.width,height:v.img.height||p.height});
  if(p.focus)img.style.objectPosition=p.focus;
  if(p.color)pic.style.backgroundColor=p.color;
  // Sources are attached before the image picks one, so only one candidate is ever fetched.
  pic.append(img);
  if(v.ok){img.sizes=sizes;img.srcset=srcset(v,v.fallback);img.src=v.img.base+"-"+v.widths[Math.min(1,v.widths.length-1)]+"."+v.fallback;}
  else img.src=p.src;
  return pic;
}
const meta=p=>[p.date,p.place].filter(Boolean).join(" · ");

/** A thumbnail is a real link (#photo-id, shareable); with a dialog it opens the lightbox. */
function opener(p,collection,sizes,className){
  const a=h("a",{class:"photo-open"+(className?" "+className:""),href:canDialog?"#photo-"+encodeURIComponent(p.id):largest(p)},picture(p,sizes));
  if(canDialog)a.addEventListener("click",e=>{
    if(e.button!==0||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;
    e.preventDefault();
    const c=collection();
    open(c,Math.max(0,c.items.indexOf(p)),a);
  });
  return a;
}

let themes=[],singles=[],series=[],activeTheme="";
const themeLabel=id=>(themes.find(t=>t.id===id)||{}).label||id;
const singlesCollection=()=>({label:activeTheme?"Thème "+themeLabel(activeTheme):"Photos seules",items:singles.filter(p=>!activeTheme||p.theme===activeTheme)});

function renderThemes(){
  const grid=qs(".photo-theme-grid");if(!grid)return;
  // Nothing to filter yet: the static theme labels stay, without dead buttons.
  if(!singles.length)return;
  const head=qs("#themes .photo-section-head");
  if(head)head.after(h("p",{class:"photo-filter-hint",text:"Choisir un thème filtre les photos seules ci-dessous."}));
  const counts=new Map();
  singles.forEach(p=>counts.set(p.theme,(counts.get(p.theme)||0)+1));
  grid.setAttribute("role","group");
  grid.setAttribute("aria-label","Filtrer les photos seules par thème");
  grid.replaceChildren(...[{id:"",label:"Tout",note:"toutes les images autonomes"},...themes].map((t,i)=>{
    const n=t.id?counts.get(t.id)||0:singles.length;
    // A filter is a glass tile that lights like a link (.a1, css/motifs.css); the chosen one stays lit.
    const b=h("button",{type:"button",class:"photo-theme a1","data-theme":t.id,"aria-pressed":String(t.id===activeTheme),"aria-controls":"photos-seules-galerie"},
      h("span",{text:String(i).padStart(2,"0")}),h("b",{text:t.label}),h("i",{text:t.note}),h("em",{class:"photo-theme-count",text:plural(n,"IMAGE","IMAGES")}));
    b.addEventListener("click",()=>filter(t.id));
    return b;
  }));
}

function filter(id){
  activeTheme=id;
  qsa(".photo-theme[data-theme]").forEach(b=>b.setAttribute("aria-pressed",String(b.dataset.theme===id)));
  let shown=0;
  qsa(".photo-single-grid>li").forEach(li=>{const ok=!id||li.dataset.theme===id;li.hidden=!ok;if(ok)shown++;});
  const status=qs("[data-filter-status]");
  if(!status)return;
  const where=id?" dans le thème "+themeLabel(id):"";
  status.textContent=shown?plural(shown,"photographie","photographies")+where+".":"Aucune photographie publiée"+where+" pour l’instant.";
}

function renderSeries(){
  const host=qs("#series .photo-empty-series");
  if(!host||!series.length)return;
  const wrap=h("div",{class:"photo-series-list"});
  series.forEach(s=>{
    const title=s.title||"Sans titre";
    const collection=()=>({label:"Série «\u00a0"+title+"\u00a0»",items:s.photos});
    const seq=h("ol",{class:"photo-sequence","aria-label":"Ordre de lecture de la série «\u00a0"+title+"\u00a0»"});
    s.photos.forEach(p=>seq.append(h("li",{},opener(p,collection,SIZES.seq))));
    wrap.append(h("article",{class:"photo-series-entry",id:"serie-"+s.id,"aria-labelledby":"serie-"+s.id+"-titre"},
      opener(s.cover,collection,SIZES.cover,"photo-series-cover"),
      h("div",{class:"photo-series-copy"},
        h("small",{text:[s.date,plural(s.photos.length,"IMAGE","IMAGES")].filter(Boolean).join(" · ")}),
        h("h3",{id:"serie-"+s.id+"-titre",text:title}),
        s.description?h("p",{text:s.description}):null,
        seq)));
  });
  host.replaceWith(wrap);
}

function renderSingles(){
  const stage=qs(".photo-single-stage");
  if(!stage||!singles.length)return;
  const grid=h("ul",{class:"photo-single-grid","aria-label":"Photographies autonomes"});
  singles.forEach(p=>grid.append(h("li",{class:"photo-single-item","data-theme":p.theme||""},
    h("figure",{},opener(p,singlesCollection,SIZES.single),h("figcaption",{},h("b",{text:p.title||"Sans titre"}),h("span",{text:meta(p)}))))));
  stage.classList.add("has-photos");
  stage.replaceChildren(grid);
}

/** Section readout: the figure in the page's hue, then its words (« 0 SÉRIE PUBLIÉE », « 2 PHOTOS PUBLIÉES »). */
function setCount(selector,n,one,many){const el=qs(selector);if(el)el.replaceChildren(h("b",{text:String(n)})," "+(n>1?many:one)+" "+(n>1?"PUBLIÉES":"PUBLIÉE"));}
/** A drawn arrow from the sprite (the site's fonts have no arrow glyph), decorative. */
function arrow(id){
  const NS="http://www.w3.org/2000/svg",svg=document.createElementNS(NS,"svg"),use=document.createElementNS(NS,"use");
  svg.setAttribute("class","arrow");svg.setAttribute("viewBox","0 0 16 16");svg.setAttribute("aria-hidden","true");svg.setAttribute("focusable","false");
  use.setAttribute("href","motifs.svg#"+id);svg.append(use);
  return svg;
}

/* ---------- Lightbox: native modal <dialog> (focus trap, Escape, inert page) ---------- */
let lb=null,current={label:"",items:[]},index=0,returnFocus=null,hashBefore="";

function lightbox(){
  if(lb)return lb;
  const dialog=h("dialog",{class:"photo-lightbox","aria-labelledby":"lb-title","aria-describedby":"lb-caption"});
  const counter=h("p",{class:"lb-counter"});
  const close=h("button",{type:"button",class:"lb-close","aria-keyshortcuts":"Escape"},"FERMER");
  const frame=h("div",{class:"lb-frame"});
  const prev=h("button",{type:"button",class:"lb-nav lb-prev","aria-label":"Photographie précédente","aria-keyshortcuts":"ArrowLeft"},arrow("arrow-w"));
  const next=h("button",{type:"button",class:"lb-nav lb-next","aria-label":"Photographie suivante","aria-keyshortcuts":"ArrowRight"},arrow("arrow-e"));
  const title=h("h2",{id:"lb-title",class:"lb-title"});
  const where=h("p",{class:"lb-meta"});
  const caption=h("p",{id:"lb-caption",class:"lb-caption"});
  const live=h("p",{class:"photo-sr","aria-live":"polite"});
  dialog.append(h("div",{class:"lb-bar"},counter,close),frame,prev,next,h("div",{class:"lb-info"},title,where,caption),live);
  document.body.append(dialog);

  close.addEventListener("click",()=>dialog.close());
  prev.addEventListener("click",()=>step(-1));
  next.addEventListener("click",()=>step(1));
  dialog.addEventListener("keydown",e=>{
    const go={ArrowLeft:()=>step(-1),ArrowRight:()=>step(1),Home:()=>show(0),End:()=>show(current.items.length-1)}[e.key];
    if(go){e.preventDefault();go();}
  });
  // Swipe on touch; a tap outside the photo closes.
  let x0=null,swiped=false;
  frame.addEventListener("pointerdown",e=>{x0=e.isPrimary?e.clientX:null;swiped=false;});
  frame.addEventListener("pointerup",e=>{
    if(x0==null)return;
    const dx=e.clientX-x0;x0=null;
    if(Math.abs(dx)>48){swiped=true;step(dx<0?1:-1);}
  });
  dialog.addEventListener("click",e=>{
    if(swiped){swiped=false;return;}
    if(e.target===dialog||e.target===frame)dialog.close();
  });
  dialog.addEventListener("close",()=>{
    document.documentElement.classList.remove("photo-lightbox-open");
    frame.replaceChildren();
    history.replaceState(history.state,"",location.pathname+location.search+hashBefore);
    if(returnFocus&&returnFocus.isConnected)returnFocus.focus();
  });
  lb={dialog,counter,frame,prev,next,title,where,caption,live};
  return lb;
}

function show(i,announce){
  const n=current.items.length;if(!n)return;
  index=(i+n)%n;
  const p=current.items[index];
  const L=lightbox();
  L.frame.replaceChildren(picture(p,SIZES.full,{eager:true,className:"lb-picture"}));
  L.title.textContent=p.title||"Sans titre";
  L.where.textContent=[meta(p),current.label].filter(Boolean).join(" · ");
  L.caption.textContent=p.caption||"";
  L.caption.hidden=!p.caption;
  L.counter.textContent=String(index+1).padStart(2,"0")+" / "+String(n).padStart(2,"0");
  L.prev.hidden=L.next.hidden=n<2;
  L.live.textContent=announce?"Image "+(index+1)+" sur "+n+" : "+(p.title||p.alt):"";
  history.replaceState(history.state,"","#photo-"+encodeURIComponent(p.id));
}
const step=d=>show(index+d,true);

function open(collection,i,from){
  const L=lightbox();
  current=collection;
  returnFocus=from||null;
  if(!L.dialog.open){
    hashBefore=location.hash.startsWith("#photo-")?"":location.hash;
    document.documentElement.classList.add("photo-lightbox-open");
    L.dialog.showModal();
  }
  show(i,false);
}

function openFromHash(){
  const m=/^#photo-(.+)$/.exec(location.hash);
  if(!m||!canDialog)return;
  const id=decodeURIComponent(m[1]);
  const all=[{label:"Photos seules",items:singles},...series.map(s=>({label:"Série «\u00a0"+(s.title||"Sans titre")+"\u00a0»",items:s.photos}))];
  for(const c of all){
    const i=c.items.findIndex(p=>p.id===id);
    if(i<0)continue;
    if(c.items===singles&&activeTheme)filter("");
    open(c,i,qs('a.photo-open[href="#photo-'+CSS.escape(m[1])+'"]'));
    return;
  }
}

(async()=>{
  let data;
  try{
    const res=await fetch(ARCHIVE,{cache:"no-cache"});
    if(!res.ok)throw new Error("archive "+res.status);
    data=await res.json();
  }catch(err){document.body.classList.add("photo-archive-fallback");return;}
  ({themes,singles,series}=normalise(data));
  renderThemes();
  renderSeries();
  renderSingles();
  setCount("#series .photo-count",series.length,"SÉRIE","SÉRIES");
  setCount("#photos-seules .photo-count",singles.length,"PHOTO","PHOTOS");
  // Hero state: distinct photographs, whether single, in a series, or both.
  const total=new Set([...singles,...series.flatMap(s=>s.photos)].map(p=>p.id)).size;
  const t=qs("[data-photo-total]");
  if(t)t.textContent=String(total);
  document.body.classList.add("photo-archive-ready");
  openFromHash();
  addEventListener("hashchange",openFromHash);
})();
})();
