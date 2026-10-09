// Aether dossier: relation map (hover, keyboard, detail panel) and progressive reveal.
// The SVG map runs without per-frame JS: its ambient motion is CSS, paused while the map is off-screen.
// In FULL 3D with motion allowed, js/world/constellation.js draws the map in WebGL and moves these
// SVG nodes onto its stars: focus, keyboard, pointer, panel and screen readers stay on the SVG.
(()=>{"use strict";
const root=document.querySelector(".aether-grand");
if(!root)return;
const reduced=matchMedia("(prefers-reduced-motion: reduce)");
const hasIO="IntersectionObserver" in window;
const forced=matchMedia("(forced-colors: active)");
let sky=null; // the WebGL constellation, once it runs (below)

// Sections are only dimmed once this script runs, and stay visible once seen:
// without JS (or with reduced motion) nothing is ever hidden.
const sections=[...document.querySelectorAll(".aether-section")];
if(hasIO&&!reduced.matches){
  root.classList.add("aether-reveal");
  const io=new IntersectionObserver(entries=>entries.forEach(e=>{
    if(!e.isIntersecting)return;
    e.target.classList.add("is-visible");
    io.unobserve(e.target);
  }),{rootMargin:"0px 0px -8% 0px"});
  sections.forEach(s=>io.observe(s));
}

// Rest follows the site's shared idle levels (js/core/idle.js: html.is-idle after 12 s without
// input, html.is-deep-idle later or when the window loses focus; event "yosuljin:idle"). At level 1
// the page's ambient CSS motion settles — what would look frozen, the drifting petals, fades out
// first — then pauses, and the constellation drops to 30 images a second; at level 2 it slows to a
// stop. Waking resumes everything where it stopped, with a fade.
const html=document.documentElement,SETTLE=1200;
let idle=html.classList.contains("is-deep-idle")?2:html.classList.contains("is-idle")?1:0,settle=0;
function rest(level){
  idle=level;
  sky?.idle(level);
  clearTimeout(settle);
  if(!level){root.classList.remove("is-settling","is-resting");return;}
  root.classList.add("is-settling");
  settle=setTimeout(()=>root.classList.add("is-resting"),SETTLE);
}
addEventListener("yosuljin:idle",e=>rest(e.detail?.level|0));
if(idle)rest(idle);

// The page's only CSS motion below the map: the final colophon is written once while its block is on
// screen, and the salves (the first divider's and the footer's) are swept once, the first time each is seen
// (.is-seen).
if(hasIO){
  const ambient=new IntersectionObserver(entries=>entries.forEach(e=>e.target.classList.toggle("is-offscreen",!e.isIntersecting)));
  document.querySelectorAll(".aether-final").forEach(el=>ambient.observe(el));
  const seen=new IntersectionObserver(entries=>entries.forEach(e=>{if(e.isIntersecting){e.target.classList.add("is-seen");seen.unobserve(e.target);}}),{threshold:1});
  document.querySelectorAll(".aether-grand .divider .sweep").forEach(s=>seen.observe(s.closest(".divider")));
}

// Relations between sheets: pointing at or focusing a "Relié à" link lights the edge of the sheet it
// leads to (and only that one), so the relations read across the park as they do on the map.
const park=document.querySelector(".park-section");
let related=null;
function relate(a){
  const id=a?.getAttribute("href")||"",t=id.startsWith("#projet-")?document.getElementById(id.slice(1)):null;
  if(t===related)return;
  related?.classList.remove("is-related");
  related=t;
  t?.classList.add("is-related");
}
park?.addEventListener("pointerover",e=>relate(e.target.closest?.(".project-rel a")),{passive:true});
park?.addEventListener("pointerout",e=>{if(!e.relatedTarget?.closest?.(".project-rel a"))relate(null);},{passive:true});
park?.addEventListener("focusin",e=>relate(e.target.closest?.(".project-rel a")));
park?.addEventListener("focusout",()=>relate(null));

const graph=document.querySelector(".aether-graph");
const stage=document.querySelector(".aether-orbit-stage");
if(!graph)return;
// The 10 px floor on the map (css/aether.css): --u is the number of map units in one CSS pixel at the
// map's real scale (the SVG fits its 1000 x 660 view box into the stage; on a phone the map steps back
// to .965, in SVG as in the constellation).
const narrow=matchMedia("(max-width: 700px)");
const unit=()=>{const w=graph.clientWidth,h=graph.clientHeight;if(w&&h)graph.style.setProperty("--u",(1/(Math.min(w/1000,h/660)*(narrow.matches?.965:1))).toFixed(3));};
unit();
if("ResizeObserver" in window)new ResizeObserver(unit).observe(graph);
const nodes=[...graph.querySelectorAll(".a-node[data-node]")];
const links=[...graph.querySelectorAll(".aether-links [data-link]")];
const adj=new Map(nodes.map(n=>[n.dataset.node,new Set()]));
const ends=l=>l.dataset.link.split(" ");
links.forEach(l=>{const[a,b]=ends(l);adj.get(a)?.add(b);adj.get(b)?.add(a);});
// Work from other hands (data-owner="inscrit") is drawn apart, its relations too (css/aether.css).
const inscrit=new Set(nodes.filter(n=>n.dataset.owner==="inscrit").map(n=>n.dataset.node));
links.forEach(l=>{if(ends(l).some(k=>inscrit.has(k)))l.classList.add("is-inscrit");});
// Lumina is drawn inside TheHive (D88) rather than joined by a line.
adj.get("thehive")?.add("lumina");adj.get("lumina")?.add("thehive");

// Counts are read from the page, never typed by hand (Aether rule: what is counted is generated).
// What is only inscribed (other hands' work the park uses) is counted apart from the projects.
const setCount=(key,value)=>{const el=document.querySelector('[data-count="'+key+'"]');if(el)el.textContent=String(value);};
setCount("projects",document.querySelectorAll(".aether-project:not(.is-inscrit)").length);
setCount("inscrits",document.querySelectorAll(".aether-project.is-inscrit").length);
setCount("relations",links.length+1);

const panel=document.querySelector("[data-node-panel]");
const field=key=>panel?.querySelector("[data-panel-"+key+"]");
const card=id=>document.getElementById("projet-"+id);
const text=(el,sel)=>el?.querySelector(sel)?.textContent.trim()||"";
const nameOf=id=>text(card(id),"h4")||id;
let current=null;

function show(id){
  if(id===current)return;
  current=id;
  sky?.focus(id);
  const near=id?adj.get(id):null;
  graph.classList.toggle("has-focus",!!id);
  nodes.forEach(n=>{
    const key=n.dataset.node;
    n.classList.toggle("is-focus",key===id);
    n.classList.toggle("is-near",!!near&&near.has(key));
  });
  links.forEach(l=>{const[a,b]=ends(l);l.classList.toggle("is-lit",!!id&&(a===id||b===id));});
  if(!panel)return;
  // The panel takes the colour the project has on the map and on its sheet (css/aether.css).
  const hue=id&&card(id)?getComputedStyle(card(id)).getPropertyValue("--hue").trim():"";
  if(hue)panel.style.setProperty("--panel-hue",hue);else panel.style.removeProperty("--panel-hue");
  field("hint").hidden=!!id;
  field("body").hidden=!id;
  if(!id)return;
  const c=card(id);
  field("state").textContent=text(c,".project-state");
  field("name").textContent=nameOf(id);
  field("line").textContent=text(c,".project-line");
  const related=[...(near||[])].map(k=>nameOf(k)+(card(k)?.classList.contains("is-inscrit")?" (inscrit)":""));
  field("links").textContent=related.length?"Relié à\u00a0: "+related.join(" · "):"Pas encore de relation de code.";
}
const focusedNode=()=>document.activeElement?.closest?.(".a-node[data-node]");

// Nodes are role="link" groups, not SVG <a>: the shared page scripts read a.href as a string,
// which an SVG link does not provide. Activation goes to the project sheet.
const open=n=>{if(n.dataset.target)location.hash=n.dataset.target;};
// One Tab stop for the whole map (roving tabindex): the node focused last keeps tabindex 0,
// so Tab leaves the map at once and Shift+Tab comes back to where the reader was.
const rove=n=>nodes.forEach(m=>m.setAttribute("tabindex",m===n?"0":"-1"));
rove(nodes.find(n=>n.getAttribute("tabindex")==="0")||nodes[0]);
// A node that drifts (constellation) under a mouse that has not moved gets a synthesized
// pointerenter at the mouse's last position: it must not select itself and make the panel speak.
let lastX=NaN,lastY=NaN;
addEventListener("pointermove",e=>{lastX=e.clientX;lastY=e.clientY;},{capture:true,passive:true});
nodes.forEach(n=>{
  n.addEventListener("pointerenter",e=>{if(e.pointerType!=="touch"&&e.clientX===lastX&&e.clientY===lastY)return;show(n.dataset.node);});
  n.addEventListener("pointerleave",()=>show(graph.contains(focusedNode())?focusedNode().dataset.node:null));
  n.addEventListener("focus",()=>{rove(n);show(n.dataset.node);});
  n.addEventListener("click",()=>open(n));
  n.addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();open(n);}});
});
// On the map's container, not on the <svg>: Chromium makes an SVG element with focus listeners a Tab stop.
graph.parentElement.addEventListener("focusout",e=>{if(!graph.contains(e.relatedTarget))show(null);});

// Arrow keys move to the nearest node in that direction (spatial navigation on the map);
// Home and End go to the first and last node. Positions are the map's own layout, read once here
// before the constellation moves anything, so a key always leads to the same neighbour whatever the
// motion. data-nav-offset shifts a node's navigation point: TheHive navigates from its label, below
// the disc, so Lumina at the centre stays reachable.
const place=new Map(nodes.map(n=>{
  const m=/translate\(([-\d.]+)[ ,]+([-\d.]+)\)/.exec(n.getAttribute("transform")||"");
  const o=/([-\d.]+)[ ,]+([-\d.]+)/.exec(n.dataset.navOffset||"");
  return[n,m?[+m[1]+(o?+o[1]:0),+m[2]+(o?+o[2]:0)]:[0,0]];
}));
const at=n=>place.get(n);
const DIRS={ArrowRight:[1,0],ArrowLeft:[-1,0],ArrowDown:[0,1],ArrowUp:[0,-1]};
graph.addEventListener("keydown",e=>{
  const from=e.target.closest?.(".a-node[data-node]");
  if(!from)return;
  if(e.key==="Home"||e.key==="End"){e.preventDefault();nodes[e.key==="Home"?0:nodes.length-1].focus();return;}
  const dir=DIRS[e.key];
  if(!dir)return;
  const[x,y]=at(from);
  // Prefer nodes within ±45° of the arrow; only if there are none, take the best one in that half-plane.
  let best=null,score=Infinity,wide=null,wideScore=Infinity;
  nodes.forEach(n=>{
    if(n===from)return;
    const[nx,ny]=at(n);
    const along=(nx-x)*dir[0]+(ny-y)*dir[1];
    if(along<=0)return;
    const across=Math.abs((nx-x)*dir[1]-(ny-y)*dir[0]);
    const s=along+across*2;
    if(across<=along){if(s<score){score=s;best=n;}}
    else if(s<wideScore){wideScore=s;wide=n;}
  });
  best=best||wide;
  if(best){e.preventDefault();best.focus();}
});

// WebGL constellation, fetched only when it can be shown: FULL 3D (the mode classes on <html>,
// kept by js/core/prefs.js), motion allowed and no forced colours (high contrast keeps the SVG,
// which takes the system colours). Switching to LITE or reducing motion brings the SVG map back
// at once; without WebGL it simply stays.
if(!stage)return;
let loading=null;
const wanted=()=>html.classList.contains("mode-full")&&!reduced.matches&&!forced.matches;
function syncSky(){
  if(!wanted()){sky?.stop();return;}
  if(sky){sky.start();return;}
  loading??=import("./js/world/constellation.js?v=20261009-r2").then(m=>{
    if(!wanted()){loading=null;return;} // switched to LITE meanwhile: no context for nothing
    sky=m.createConstellation(stage,graph,adj);
    if(!sky)return;
    sky.focus(current);
    sky.idle(idle);
    syncSky();
  },()=>{});
}
syncSky();
new MutationObserver(syncSky).observe(html,{attributes:true,attributeFilter:["class"]});
reduced.addEventListener?.("change",syncSky);
forced.addEventListener?.("change",syncSky);
})();
