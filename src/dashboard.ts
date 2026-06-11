import { writeFileSync } from "node:fs";
import {
  counts,
  currentPositions,
  currentContradictions,
  currentSignals,
  allEntities,
  allEdges,
  currentFacts,
  allSources,
  listDecisions,
} from "./db/queries.js";

/**
 * Generate a single, self-contained dashboard.html from the live memory.
 * No server, no build, no external network — open it by double-clicking.
 * It visualizes everything: positions, contradictions, signals, the entity GRAPH, facts (with
 * provenance), sources, and the decision log — so you can SEE what the brain holds.
 */
async function main(): Promise<void> {
  const data = {
    counts: await counts(),
    positions: await currentPositions(),
    contradictions: await currentContradictions(),
    signals: await currentSignals(),
    entities: await allEntities(),
    edges: await allEdges(),
    facts: await currentFacts(),
    sources: await allSources(),
    decisions: await listDecisions(),
  };
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  writeFileSync("dashboard.html", HTML(json));
  console.log("✓ wrote dashboard.html — open it in a browser (double-click).");
  process.exit(0);
}

const HTML = (json: string) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Decision Brain · Memory Dashboard</title>
<style>
:root{
  --bg:#0a0e0d;--panel:#101614;--panel2:#0d1311;--line:rgba(255,255,255,.09);--line2:rgba(255,255,255,.16);
  --tp:#e9f0ea;--ts:#aebcb2;--tm:#7d8e83;--em:#34d399;--amber:#f5b049;--rose:#fb7185;--cyan:#5cc8d6;--violet:#a99cf6;
  --mono:ui-monospace,Menlo,Consolas,monospace;--sans:-apple-system,system-ui,Segoe UI,Roboto,sans-serif;
}
*{box-sizing:border-box}
body{margin:0;background:radial-gradient(1100px 600px at 85% -8%,rgba(16,185,129,.10),transparent 60%),var(--bg);
  color:var(--tp);font-family:var(--sans);font-size:14px;line-height:1.55;-webkit-font-smoothing:antialiased}
.wrap{max-width:1180px;margin:0 auto;padding:22px}
h1{font-size:22px;margin:0 0 2px;font-weight:700}
.sub{color:var(--tm);font-family:var(--mono);font-size:12px;margin-bottom:18px}
.tabs{display:flex;gap:6px;flex-wrap:wrap;border-bottom:1px solid var(--line);margin-bottom:20px;position:sticky;top:0;background:var(--bg);padding-top:8px;z-index:5}
.tab{padding:8px 13px;border:1px solid transparent;border-bottom:none;border-radius:8px 8px 0 0;color:var(--ts);cursor:pointer;font-size:13px}
.tab:hover{color:var(--tp)}
.tab.on{color:var(--em);border-color:var(--line);background:var(--panel)}
.sec{display:none}.sec.on{display:block}
.cards{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:18px}
.kpi{border:1px solid var(--line);border-radius:12px;background:var(--panel);padding:13px 16px;min-width:120px}
.kpi .n{font-size:24px;font-weight:700}.kpi .l{color:var(--tm);font-size:11px;font-family:var(--mono);text-transform:uppercase;letter-spacing:.08em}
.card{border:1px solid var(--line);border-radius:12px;background:linear-gradient(180deg,var(--panel),var(--panel2));padding:15px 17px;margin-bottom:12px}
.card h3{margin:0 0 6px;font-size:15px}
.badge{display:inline-block;font-family:var(--mono);font-size:10.5px;padding:2px 8px;border-radius:999px;border:1px solid var(--line2);letter-spacing:.04em}
.b-em{color:var(--em);border-color:rgba(52,211,153,.4);background:rgba(52,211,153,.08)}
.b-cyan{color:var(--cyan);border-color:rgba(92,200,214,.4)}
.b-amber{color:var(--amber);border-color:rgba(245,176,73,.4)}
.b-rose{color:var(--rose);border-color:rgba(251,113,133,.4)}
.b-violet{color:var(--violet);border-color:rgba(169,156,246,.4)}
.b-gray{color:var(--tm)}
.muted{color:var(--tm)}.mono{font-family:var(--mono)}
.quote{color:var(--ts);font-style:italic;border-left:2px solid var(--line2);padding-left:10px;margin:6px 0}
.gaps{margin:8px 0 0;padding-left:18px;color:var(--ts)}.gaps li{margin:3px 0;font-size:13px}
table{width:100%;border-collapse:collapse;font-size:12.5px}
th{text-align:left;color:var(--tm);font-family:var(--mono);font-size:10.5px;text-transform:uppercase;letter-spacing:.06em;padding:7px 9px;border-bottom:1px solid var(--line)}
td{padding:8px 9px;border-bottom:1px solid var(--line);vertical-align:top}
tr:hover td{background:rgba(255,255,255,.02)}
input.filter{background:var(--panel);border:1px solid var(--line2);color:var(--tp);border-radius:8px;padding:8px 11px;width:280px;font-size:13px;margin-bottom:12px}
.fbtn{font-family:var(--mono);font-size:11px;color:var(--ts);border:1px solid var(--line2);border-radius:7px;padding:5px 10px;cursor:pointer;background:transparent;margin-right:6px}
.fbtn.on{color:var(--em);border-color:var(--em)}
svg{width:100%;height:580px;border:1px solid var(--line);border-radius:12px;background:var(--panel2)}
.legend{display:flex;gap:16px;flex-wrap:wrap;margin:10px 0;font-family:var(--mono);font-size:11.5px;color:var(--ts)}
.dot{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:5px;vertical-align:middle}
.contra{border-left:3px solid var(--amber)}
details summary{cursor:pointer;color:var(--em);font-size:12px}
</style></head>
<body><div class="wrap">
  <h1>Decision Brain · Memory Dashboard</h1>
  <div class="sub">compiled brain · LLMs at the seams, algorithms in the path · all reads model-free</div>
  <div class="tabs" id="tabs"></div>
  <div id="app"></div>
</div>
<script>const DATA=${json};</script>
<script>
const D=DATA, $=(h)=>{const t=document.createElement('template');t.innerHTML=h.trim();return t.content.firstChild;};
const esc=(s)=>String(s==null?'':s).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
const factById={}; (D.facts||[]).forEach(f=>factById[f.id]=f);
const entById={}; (D.entities||[]).forEach(e=>entById[e.id]=e);
const promoBadge={decision_grade:'b-em',validated:'b-cyan',emerging:'b-amber',candidate:'b-gray'};
const kindBadge={conditional:'b-amber',drift:'b-violet',direct:'b-rose',superseded:'b-gray'};
const typeColor={person:'var(--cyan)',company:'var(--em)',investor:'var(--violet)',competitor:'var(--rose)'};
const tierBadge={E5:'b-em',E4:'b-cyan',E3:'b-amber',E2:'b-gray',E1:'b-gray'};
// fact→signal membership similarity, grouped by signal id
const memberSim={}; (D.edges||[]).forEach(e=>{ if(e.predicate==='member_of'){ (memberSim[e.to_id]=memberSim[e.to_id]||{})[e.from_id]=e.similarity; } });
// the trace: from any conclusion back to the exact facts/quotes/sources/scores behind it
function traceTable(factIds, sims){
  const rows=(factIds||[]).map(id=>factById[id]).filter(Boolean).map(f=>{
    const simCell=sims&&sims[f.id]!=null?'<td class="mono">'+Number(sims[f.id]).toFixed(2)+'</td>':'<td class="muted">—</td>';
    return '<tr><td class="quote" style="border:none;padding-left:0">'+esc(f.quote)+(f.qualifier?' <span class="muted mono">«'+esc(f.qualifier)+'»</span>':'')+'</td>'+
      '<td class="mono muted">'+esc(f.source_id)+(f.speaker?'<br>'+esc(f.speaker):'')+'</td>'+
      '<td><span class="badge '+(tierBadge[f.evidence_tier]||'b-gray')+'">'+esc(f.evidence_tier)+'</span></td>'+
      '<td class="mono">'+(f.confidence!=null?Number(f.confidence).toFixed(2):'')+'</td>'+simCell+'</tr>';
  }).join('');
  return '<table style="margin-top:8px"><thead><tr><th>verbatim quote</th><th>source · speaker</th><th>tier</th><th>conf</th><th>sim</th></tr></thead><tbody>'+rows+'</tbody></table>';
}

const TABS=['Overview','Schema','Positions','Contradictions','Signals','Graph','Facts','Sources','Decisions'];
const tabsEl=document.getElementById('tabs'), app=document.getElementById('app');
TABS.forEach((t,i)=>{const b=$('<div class="tab">'+t+'</div>');b.onclick=()=>show(i);tabsEl.appendChild(b);});
function show(i){[...tabsEl.children].forEach((c,j)=>c.classList.toggle('on',j===i));render(TABS[i]);}

function render(tab){
  app.innerHTML='';
  if(tab==='Overview')return overview();
  if(tab==='Schema')return schema();
  if(tab==='Positions')return positions();
  if(tab==='Contradictions')return contradictions();
  if(tab==='Signals')return signals();
  if(tab==='Graph')return graph();
  if(tab==='Facts')return facts();
  if(tab==='Sources')return sources();
  if(tab==='Decisions')return decisions();
}

function overview(){
  const c=D.counts||{}; const order=['sources','facts','entities','edges','signals','contradictions','positions','decisions'];
  const cards=$('<div class="cards"></div>');
  order.forEach(k=>cards.appendChild($('<div class="kpi"><div class="n">'+(c[k]??0)+'</div><div class="l">'+k+'</div></div>')));
  app.appendChild(cards);
  app.appendChild($('<div class="card"><h3>How to read this</h3><div class="muted">'+
   'Two LLM seams (extract → typed facts · compose → positions). Everything else — clustering, the promotion ladder, '+
   'contradiction detection, the entity graph, all reads — is deterministic. Each section below is one layer of the compiled memory.</div></div>'));
}

function schema(){
  const links=[
    ['facts','source_id','sources','each fact belongs to the source it came from'],
    ['contradictions','fact_a / fact_b','facts','a conflict points to the two clashing facts'],
    ['signals','member_of (edge)','facts','a signal is built from the facts that mean the same'],
    ['positions','composed_from (edge)','signals','a position is compiled from its signals (with a similarity score)'],
    ['positions','addresses (edge)','contradictions','a position flags the contradictions it must reconcile'],
    ['positions','fields.fact_ids','facts','each position claim cites the facts behind it'],
    ['entities','relationships (edge)','entities','people / companies wired to each other'],
    ['decisions','evidence.fact_id','facts','a logged decision cites the facts it leaned on'],
  ];
  let html='<div class="card"><h3>How the 8 tables connect</h3>'+
    '<table><thead><tr><th>from table</th><th>linked by</th><th>to table</th><th>meaning</th></tr></thead><tbody>'+
    links.map(l=>'<tr><td class="mono">'+l[0]+'</td><td class="mono muted">'+l[1]+'</td><td class="mono">'+l[2]+'</td><td>'+l[3]+'</td></tr>').join('')+
    '</tbody></table><div class="muted mono" style="margin-top:8px">Links marked "(edge)" are stored as rows in the <b>edges</b> table — the glue that wires everything together.</div></div>';
  html+='<div class="card"><h3>The data model (how rows point at each other)</h3>'+schemaSVG()+'</div>';
  html+='<div class="card"><h3>Worked example — follow one chain across the tables</h3>'+exampleChain()+'</div>';
  const wrap=$('<div></div>');wrap.innerHTML=html;app.appendChild(wrap);
}
// one ER table box: title bar + a row per field (pk/fk highlighted); returns anchors per field
function erTable(x,y,name,fields,c){
  const W=210,rh=18,hh=26,H=hh+fields.length*rh;
  let svg='<rect x="'+x+'" y="'+y+'" width="'+W+'" height="'+H+'" rx="7" fill="#0d1311" stroke="'+c+'" stroke-width="1.4"/>'+
    '<rect x="'+x+'" y="'+y+'" width="'+W+'" height="'+hh+'" fill="'+c+'" opacity="0.16"/>'+
    '<text x="'+(x+11)+'" y="'+(y+18)+'" fill="'+c+'" font-size="12.5" font-weight="700" font-family="monospace">'+name+'</text>';
  const anchor={};
  fields.forEach((fd,i)=>{const cy=y+hh+i*rh+13,col=fd.pk?'#e9f0ea':fd.fk?'#5cc8d6':'#aebcb2',tag=fd.pk?'  · pk':fd.fk?'  · fk':'';
    svg+='<text x="'+(x+12)+'" y="'+cy+'" fill="'+col+'" font-size="10.5" font-family="monospace">'+fd.f+'<tspan fill="#586a5f">'+tag+'</tspan></text>';
    anchor[fd.f]={L:[x,cy-4],R:[x+W,cy-4]};});
  return {svg,anchor,x};
}
function link(p1,p2,same){
  let d;
  if(same){const b=Math.max(p1[0],p2[0])+46;d='M'+p1[0]+' '+p1[1]+' C'+b+' '+p1[1]+' '+b+' '+p2[1]+' '+p2[0]+' '+p2[1];}
  else{const mx=(p1[0]+p2[0])/2;d='M'+p1[0]+' '+p1[1]+' C'+mx+' '+p1[1]+' '+mx+' '+p2[1]+' '+p2[0]+' '+p2[1];}
  return '<path d="'+d+'" fill="none" stroke="#5cc8d6" stroke-width="1.3" opacity="0.7" marker-end="url(#arr)"/>';
}
function conn(a,af,b,bf){
  const same=Math.abs(a.x-b.x)<5;
  if(same)return link(a.anchor[af].R,b.anchor[bf].R,true);
  const aLeft=a.x<b.x;
  return link(aLeft?a.anchor[af].R:a.anchor[af].L,aLeft?b.anchor[bf].L:b.anchor[bf].R,false);
}
function schemaSVG(){
  const T={};
  T.entities=erTable(40,40,'entities',[{f:'id',pk:1},{f:'name'},{f:'type'},{f:'aliases'}],'#5cc8d6');
  T.edges=erTable(40,210,'edges',[{f:'id',pk:1},{f:'from_id',fk:1},{f:'predicate'},{f:'to_id',fk:1},{f:'similarity'}],'#a99cf6');
  T.sources=erTable(40,400,'sources',[{f:'id',pk:1},{f:'type'},{f:'date'},{f:'body'},{f:'hash'}],'#7d8e83');
  T.facts=erTable(395,150,'facts',[{f:'id',pk:1},{f:'source_id',fk:1},{f:'type'},{f:'value'},{f:'quote'},{f:'comparable'},{f:'embedding'}],'#34d399');
  T.decisions=erTable(395,480,'decisions',[{f:'id',pk:1},{f:'question'},{f:'evidence',fk:1},{f:'status'}],'#7d8e83');
  T.positions=erTable(745,40,'positions',[{f:'id',pk:1},{f:'name'},{f:'summary'},{f:'signal_ids',fk:1},{f:'contradiction_ids',fk:1},{f:'gaps'}],'#34d399');
  T.signals=erTable(745,300,'signals',[{f:'id',pk:1},{f:'label'},{f:'count'},{f:'promotion'},{f:'fact_ids',fk:1}],'#f5b049');
  T.contradictions=erTable(745,480,'contradictions',[{f:'id',pk:1},{f:'fact_a',fk:1},{f:'fact_b',fk:1},{f:'kind'}],'#a99cf6');
  let s='<svg viewBox="0 0 1010 660"><defs><marker id="arr" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0 0 L7 3 L0 6 Z" fill="#5cc8d6"/></marker></defs>';
  s+=conn(T.facts,'source_id',T.sources,'id');
  s+=conn(T.contradictions,'fact_a',T.facts,'id');
  s+=conn(T.contradictions,'fact_b',T.facts,'id');
  s+=conn(T.signals,'fact_ids',T.facts,'id');
  s+=conn(T.positions,'signal_ids',T.signals,'id');
  s+=conn(T.positions,'contradiction_ids',T.contradictions,'id');
  s+=conn(T.decisions,'evidence',T.facts,'id');
  s+=conn(T.edges,'from_id',T.facts,'id');
  s+=conn(T.edges,'to_id',T.signals,'id');
  Object.values(T).forEach(t=>s+=t.svg);
  s+='</svg>';
  s+='<div class="muted mono" style="margin-top:8px">Each row is a column. <b style="color:#e9f0ea">pk</b> = primary key · <b style="color:#5cc8d6">fk</b> = foreign key (the field that points at another table). Lines run from an <b>fk</b> field to the <b>id</b> it references. The <b>edges</b> table is polymorphic — from_id/to_id point at a fact, entity, signal, or position (it stores every typed link).</div>';
  return s;
}
function exampleChain(){
  const c=(D.contradictions||[]).find(x=>x.dimension==='runway')||(D.contradictions||[])[0];
  if(!c)return '<div class="muted">no example available — seed first</div>';
  const fa=factById[c.fact_a],fb=factById[c.fact_b];
  const pos=(D.positions||[]).find(p=>p.name==='runway')||(D.positions||[])[0];
  const step=(t,b)=>'<div style="margin:5px 0"><span class="badge b-gray">'+t+'</span> '+b+'</div>';
  const lk=(s)=>'<div class="muted mono" style="margin-left:10px">↓ '+s+'</div>';
  return step('sources',esc((fa&&fa.source_id)||''))+
    lk('facts.source_id')+
    step('facts',esc(fa?fa.value:'')+' <span class="muted mono">['+esc(c.fact_a)+']</span>')+
    lk('contradictions.fact_a / fact_b')+
    step('contradictions',esc(c.dimension)+': "'+esc(fa?fa.comparable:'')+'" vs "'+esc(fb?fb.comparable:'')+'" — '+esc(c.kind))+
    lk('position —addresses→ contradiction (edge)')+
    step('positions',esc(pos?pos.name:'')+' — '+esc(pos?pos.summary.slice(0,170)+'…':''));
}

function positions(){
  (D.positions||[]).forEach(p=>{
    const cls=p.confidence==='high'?'b-em':p.confidence==='medium'?'b-amber':'b-rose';
    const gaps=(p.gaps||[]).map(g=>'<li>'+esc(g)+'</li>').join('');
    const citedIds=[...new Set((p.fields||[]).flatMap(f=>f.fact_ids||[]))];
    const sigEdges=(D.edges||[]).filter(e=>e.from_id===p.id&&e.predicate==='composed_from');
    const sigList=sigEdges.map(e=>{const s=(D.signals||[]).find(x=>x.id===e.to_id);return s?'<li>'+esc(s.label)+' <span class="muted mono">(sim '+(e.similarity!=null?Number(e.similarity).toFixed(2):'—')+')</span></li>':'';}).join('');
    app.appendChild($('<div class="card"><h3>'+esc(p.name)+' <span class="badge '+cls+'">confidence: '+esc(p.confidence)+'</span></h3>'+
      '<div>'+esc(p.summary)+'</div>'+
      (sigList?'<div class="muted mono" style="margin-top:8px">COMPOSED FROM SIGNALS (P1 stored edges):</div><ul class="gaps">'+sigList+'</ul>':'')+
      (gaps?'<div class="muted mono" style="margin-top:8px">GAPS (trigger research):</div><ul class="gaps">'+gaps+'</ul>':'')+
      '<details style="margin-top:8px" open><summary>trace · '+citedIds.length+' cited facts · '+(p.contradiction_ids||[]).length+' contradiction(s)</summary>'+traceTable(citedIds)+'</details></div>'));
  });
  if(!(D.positions||[]).length)app.appendChild($('<div class="muted">No positions yet.</div>'));
}

function contradictions(){
  (D.contradictions||[]).forEach(c=>{
    app.appendChild($('<div class="card contra"><h3>'+esc(c.dimension)+' <span class="badge '+(kindBadge[c.kind]||'b-gray')+'">'+esc(c.kind)+'</span></h3>'+
      '<div class="muted" style="margin-bottom:4px">'+esc(c.note)+'</div>'+
      traceTable([c.fact_a,c.fact_b])+'</div>'));
  });
  if(!(D.contradictions||[]).length)app.appendChild($('<div class="muted">No contradictions detected.</div>'));
}

function signals(){
  const tiers=['decision_grade','validated','emerging','candidate'];
  let active='all';
  const bar=$('<div></div>');
  ['all',...tiers].forEach(t=>{const b=$('<button class="fbtn'+(t==='all'?' on':'')+'">'+t+'</button>');b.onclick=()=>{active=t;[...bar.children].forEach(x=>x.classList.toggle('on',x.textContent===t));draw();};bar.appendChild(b);});
  app.appendChild(bar);
  const wrap=$('<div></div>');app.appendChild(wrap);
  function draw(){
    const rows=(D.signals||[]).filter(s=>active==='all'||s.promotion===active)
      .sort((a,b)=>tiers.indexOf(a.promotion)-tiers.indexOf(b.promotion)||b.count-a.count);
    wrap.innerHTML=rows.map(s=>'<div class="card"><h3>'+
      '<span class="badge '+(promoBadge[s.promotion]||'b-gray')+'">'+s.promotion+'</span> '+
      '<span class="mono muted">'+esc(s.type)+'</span> '+esc(s.label)+'</h3>'+
      '<div class="muted mono">count '+s.count+' · '+(s.companies||[]).length+' companies ('+esc((s.companies||[]).join(', '))+') · last confirmed '+esc(s.last_confirmed)+'</div>'+
      '<details style="margin-top:8px"><summary>trace · '+(s.fact_ids||[]).length+' facts behind it</summary>'+traceTable(s.fact_ids, memberSim[s.id])+'</details></div>').join('') ||
      '<div class="muted">No signals.</div>';
  }
  draw();
}

function graph(){
  const nodes=(D.entities||[]).map(e=>({...e}));
  const idx={};nodes.forEach((n,i)=>idx[n.id]=i);
  const eedges=(D.edges||[]).filter(e=>idx[e.from_id]!=null&&idx[e.to_id]!=null); // entity↔entity only
  app.appendChild($('<div class="legend">'+Object.entries(typeColor).map(([k,v])=>'<span><span class="dot" style="background:'+v+'"></span>'+k+'</span>').join('')+
    '<span class="muted">· '+nodes.length+' entities · '+eedges.length+' relationships · drag-free force layout</span></div>'));
  const W=1140,H=560;
  nodes.forEach((n,i)=>{const a=2*Math.PI*i/Math.max(nodes.length,1);n.x=W/2+Math.cos(a)*230;n.y=H/2+Math.sin(a)*200;n.vx=0;n.vy=0;});
  for(let it=0;it<400;it++){
    for(let i=0;i<nodes.length;i++)for(let j=i+1;j<nodes.length;j++){
      let dx=nodes[i].x-nodes[j].x,dy=nodes[i].y-nodes[j].y,d2=dx*dx+dy*dy+0.01,f=9000/d2,d=Math.sqrt(d2);
      dx/=d;dy/=d;nodes[i].vx+=dx*f;nodes[i].vy+=dy*f;nodes[j].vx-=dx*f;nodes[j].vy-=dy*f;
    }
    eedges.forEach(e=>{const a=nodes[idx[e.from_id]],b=nodes[idx[e.to_id]];let dx=b.x-a.x,dy=b.y-a.y,d=Math.sqrt(dx*dx+dy*dy)||1,f=(d-150)*0.02;dx/=d;dy/=d;a.vx+=dx*f;a.vy+=dy*f;b.vx-=dx*f;b.vy-=dy*f;});
    nodes.forEach(n=>{n.vx+=(W/2-n.x)*0.002;n.vy+=(H/2-n.y)*0.002;n.x+=Math.max(-12,Math.min(12,n.vx));n.y+=Math.max(-12,Math.min(12,n.vy));n.vx*=0.85;n.vy*=0.85;n.x=Math.max(40,Math.min(W-40,n.x));n.y=Math.max(30,Math.min(H-30,n.y));});
  }
  let svg='<svg viewBox="0 0 '+W+' '+H+'">';
  eedges.forEach(e=>{const a=nodes[idx[e.from_id]],b=nodes[idx[e.to_id]];
    svg+='<line x1="'+a.x+'" y1="'+a.y+'" x2="'+b.x+'" y2="'+b.y+'" stroke="rgba(255,255,255,.14)" stroke-width="1"/>';
    svg+='<text x="'+((a.x+b.x)/2)+'" y="'+((a.y+b.y)/2)+'" fill="#7d8e83" font-size="9" font-family="monospace" text-anchor="middle">'+esc(e.predicate)+'</text>';});
  nodes.forEach(n=>{const c=typeColor[n.type]||'#888';
    svg+='<circle cx="'+n.x+'" cy="'+n.y+'" r="7" fill="'+c+'"/>';
    svg+='<text x="'+(n.x+10)+'" y="'+(n.y+4)+'" fill="#e9f0ea" font-size="12">'+esc(n.name)+'</text>';});
  svg+='</svg>';
  app.appendChild($('<div>'+svg+'</div>'));
}

function facts(){
  const inp=$('<input class="filter" placeholder="filter facts (type, dimension, text, source)…"/>');
  app.appendChild(inp);
  const wrap=$('<div></div>');app.appendChild(wrap);
  function draw(){
    const q=(inp.value||'').toLowerCase();
    const rows=(D.facts||[]).filter(f=>!q||[f.type,f.dimension,f.value,f.quote,f.source_id,f.speaker].join(' ').toLowerCase().includes(q));
    wrap.innerHTML='<table><thead><tr><th>type</th><th>dim</th><th>value</th><th>quote</th><th>source</th><th>tier</th><th>conf</th></tr></thead><tbody>'+
      rows.map(f=>'<tr><td class="mono">'+esc(f.type)+'</td><td class="mono muted">'+esc(f.dimension||'—')+'</td>'+
        '<td>'+esc(f.value)+(f.qualifier?' <span class="muted mono">«'+esc(f.qualifier)+'»</span>':'')+'</td>'+
        '<td class="quote" style="border:none;padding-left:0">'+esc(f.quote)+'</td>'+
        '<td class="mono muted">'+esc(f.source_id)+(f.speaker?'<br>'+esc(f.speaker):'')+'</td>'+
        '<td class="mono">'+esc(f.evidence_tier)+'</td><td class="mono">'+(f.confidence!=null?f.confidence.toFixed(2):'')+'</td></tr>').join('')+
      '</tbody></table>';
  }
  inp.oninput=draw;draw();
}

function sources(){
  (D.sources||[]).forEach(s=>{
    app.appendChild($('<div class="card"><h3>'+esc(s.id)+' <span class="badge b-gray">'+esc(s.type)+'</span></h3>'+
      '<div class="muted mono">'+esc(s.date)+(s.author?' · '+esc(s.author):'')+'</div>'+
      '<details style="margin-top:6px"><summary>show raw body</summary><div class="quote" style="white-space:pre-wrap;margin-top:8px">'+esc(s.body)+'</div></details></div>'));
  });
}

function decisions(){
  if(!(D.decisions||[]).length){app.appendChild($('<div class="muted">No decisions logged yet. Run <span class="mono">npm run ask "…"</span> to create one.</div>'));return;}
  (D.decisions||[]).forEach(d=>{
    const cls=d.status==='approved'?'b-em':d.status==='rejected'?'b-rose':'b-amber';
    app.appendChild($('<div class="card"><h3>'+esc(d.question)+' <span class="badge '+cls+'">'+esc(d.status)+'</span></h3>'+
      '<div>'+esc(d.answer)+'</div><div class="muted mono" style="margin-top:8px">→ '+esc(d.recommendation)+'</div>'+
      '<div class="muted mono">confidence '+esc(d.confidence)+' · '+(d.evidence||[]).length+' citations</div></div>'));
  });
}

show(0);
</script>
</body></html>`;

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
