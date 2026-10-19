'use strict';
const $ = id => document.getElementById(id);
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const duration = hours => hours == null ? 'No sample' : hours < 1 / 60 ? `${Math.round(hours * 3600)}s` : hours < 1 ? `${Math.round(hours * 60)}m` : hours < 24 ? `${Number(hours.toFixed(1))}h` : `${Number((hours / 24).toFixed(1))}d`;
function actualDuration(hours) {
  if(hours==null)return 'Not taken';
  let seconds=Math.max(0,Math.round(hours*3600));
  const parts=[];
  for(const [size,unit] of [[86400,'d'],[3600,'h'],[60,'m'],[1,'s']]) {
    const amount=Math.floor(seconds/size);seconds%=size;
    if(amount)parts.push(`${amount}${unit}`);
  }
  return parts.join(' ')||'0s';
}
function arrowLabel(edge) {
  if(!edge.onDeal)return 'Not taken';
  return edge.dealHours.length<=2?edge.dealHours.map(actualDuration).join(' / '):`${edge.dealHours.length} passes · click`;
}
const dateLabel = value => String(value).replace('T', ' ').slice(0, 19);
const percentage = value => `${Math.round(value * 100)}%`;
const trafficColor = hours => hours > 24 ? '#dd6269' : hours >= 1 ? '#d49324' : '#1d9977';
// Product IDs verified against the QA PRODUCT_DTCAN lookup.
const productNames = {0:'Not applicable',1:'Lease',2:'Loan',3:'Balloon',4:'No asset',5:'Removed',6:'Prequalification'};
const productName = id => productNames[id] || `Product ${id}`;
let data, catalog = [], zoom = 1, selectedCode, selectedEdge, controller, requestNumber = 0, catalogVisible = false;

async function api(url, signal) {
  const response = await fetch(url, {signal});
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status}).`);
  return body;
}
function showError(message) { $('error').textContent = message; $('error').classList.remove('hidden'); }
function clearError() { $('error').classList.add('hidden'); }

async function loadDeal(id, stream = '') {
  if (!/^[0-9]{1,18}$/.test(id)) { showError('Enter a numeric deal ID or application ID.'); return; }
  if (controller) controller.abort();
  controller = new AbortController();
  const sequence = ++requestNumber;
  catalogVisible = false;
  $('catalogPanel').classList.add('hidden');
  $('catalogNav').classList.remove('active'); $('mapNav').classList.add('active');
  $('welcome').classList.add('hidden'); $('explorer').classList.add('hidden');
  $('loading').classList.remove('hidden'); $('searchButton').disabled = true; clearError();
  try {
    const result = await api(`/api/deals/${encodeURIComponent(id)}?days=${$('days').value}&stream=${encodeURIComponent(stream)}`, controller.signal);
    if (sequence !== requestNumber) return;
    data = result;
    $('dealId').value = data.dealId;
    selectedCode = data.flow.currentCode; selectedEdge = null; zoom = 1;
    render();
    $('explorer').classList.remove('hidden');
    const query = new URLSearchParams({deal: data.dealId, days: data.days, stream: data.stream});
    history.replaceState(null, '', `/?${query}`);
    document.querySelectorAll('.recent-deal').forEach(b => b.classList.toggle('selected', b.dataset.id === data.dealId));
  } catch (error) {
    if (error.name !== 'AbortError' && sequence === requestNumber) { showError(error.message); $('welcome').classList.remove('hidden'); }
  } finally {
    if (sequence === requestNumber) { $('loading').classList.add('hidden'); $('searchButton').disabled = false; }
  }
}

async function loadRecent() {
  $('recent').innerHTML = '<p class="side-muted">Reading recent QA activity…</p>';
  try {
    const recent = await api('/api/recent');
    $('recent').innerHTML = recent.length ? recent.map(r => `<button class="recent-deal" data-id="${escapeHtml(r.dealId)}" data-stream="${escapeHtml(r.lender + '|' + r.product)}"><span class="recent-icon">◇</span><span><strong>#${escapeHtml(r.dealId)}</strong><small>${escapeHtml(r.lender)} · ${escapeHtml(productName(r.product))}</small></span><span class="recent-status">${escapeHtml(r.status)}</span></button>`).join('') : '<p class="side-muted">No auto deals with activity in the last 30 days.</p>';
    $('recent').querySelectorAll('button').forEach(b => b.addEventListener('click', () => loadDeal(b.dataset.id, b.dataset.stream)));
  } catch (error) { $('recent').textContent = error.message; $('recent').classList.add('side-muted'); }
}

async function loadCatalog() {
  try {
    catalog = await api('/api/statuses');
    $('catalogCount').textContent = catalog.length;
    $('catalogRows').innerHTML = catalog.map(s => `<tr><td>${escapeHtml(s.id)}</td><td><strong>${escapeHtml(s.code)}</strong></td><td>${escapeHtml(s.name)}</td><td>${escapeHtml(s.french)}</td><td>${s.active ? 'Yes' : 'No'}</td></tr>`).join('');
  } catch (error) { $('catalogRows').innerHTML = `<tr><td colspan="5">${escapeHtml(error.message)}</td></tr>`; }
}

function metric(label, value, note, icon, word = false, attention = false) {
  return `<div class="metric"><span class="metric-icon">${icon}</span><div class="metric-label">${escapeHtml(label)}</div><div class="metric-value ${word ? 'word' : ''}">${escapeHtml(value)}</div><div class="metric-note ${attention ? 'attention' : ''}">${escapeHtml(note)}</div></div>`;
}
function nodeName(code) { return data.flow.nodes.find(n => n.code === code)?.name || code; }
function render() {
  const f = data.flow, current = f.nodes.find(n => n.current);
  $('dealTitle').textContent = `#${data.dealId}`;
  $('statusBadge').textContent = current.name;
  $('dealSubtitle').textContent = `Auto application · ${data.lender} · ${productName(data.product)} · ${f.timeline.length - 1} status transitions · ${(data.notes || []).length} messages`;
  $('stream').innerHTML = data.streams.map(s => `<option value="${escapeHtml(s.key)}">${escapeHtml(s.lender)} / ${escapeHtml(productName(s.product))}</option>`).join('');
  $('stream').value = data.stream;
  const slow = !f.closed && current.p90Hours != null && f.currentHours > current.p90Hours;
  $('metrics').innerHTML = metric('CURRENT POSITION', current.name, f.closed ? 'Outcome recorded' : `Entered ${dateLabel(f.timeline.at(-1).at)}`, '◎', true)
    + metric(f.closed ? 'TIME TO OUTCOME' : 'TOTAL JOURNEY TIME', duration(f.elapsedHours), 'Since first observed status', '◷')
    + metric(f.closed ? 'OUTCOME' : 'TIME IN CURRENT STATE', f.closed ? current.code : duration(f.currentHours), f.closed ? dateLabel(f.timeline.at(-1).at) : slow ? `Above historical p90 (${duration(current.p90Hours)})` : `Historical median ${duration(current.medianHours)}`, '↻', false, slow)
    + metric('COMPARISON DEALS', f.cohortDeals.toLocaleString(), `${data.lender} · ${productName(data.product)} · ${data.days} days`, '▥');
  const warnings = [...f.warnings];
  if (data.sampled) warnings.push(`Comparison capped at the ${data.sampleLimit} most recently active deals; this is a sample of the selected period.`);
  $('warnings').textContent = warnings.join(' ');
  $('stateCount').textContent = `${f.nodes.length} observed states`;
  renderMap(); renderDetail(); renderTimeline(); renderTraffic();
  const unassigned=(data.notes||[]).filter(note=>!note.stateCode);
  $('unassignedNotes').classList.toggle('hidden',!unassigned.length);
  $('unassignedNotes').innerHTML=unassigned.length?`<h3>Messages outside the recorded journey (${unassigned.length})</h3><p>These messages have no timestamp or precede the first recorded state, so no state is assigned.</p>${renderMessages(unassigned)}`:'';
  $('provenance').textContent = `Source: DTCN.APPLICATION_DTCAN + DTCN.APPLICATIONSTATUS. Selected deal excluded from the baseline. Comparison: complete histories of up to ${data.sampleLimit} recently active auto deals for the same lender/product in the last ${data.days} days. Deal read: ${dateLabel(data.observedAt)}; comparison read: ${dateLabel(data.cohortObservedAt)} (cached up to 5 minutes). Timestamps use the QA database clock; no timezone conversion. Status entry times are inferred from version creation dates. Open waits are excluded from historical dwell statistics. Messages are loaded only for the selected deal/lender/product.`;
}

function layout(visibleNodes, edges) {
  // Display buckets supplied by the business. These positions do not imply
  // transitions: arrows still come exclusively from observed deal history.
  const ranks = {QT:0,AS:0,SU:1,AD:2,AP:3,CA:3,CP:3,DE:3,EX:3,EA:3,DI:4,DR:5,RF:6,PP:7,BK:8,FN:9};
  const order = {QT:0,AS:1,AP:0,CA:1,CP:2,DE:3,EX:4,EA:5};
  const declineCodes = ['DE','EX','EA'];
  const nodes = visibleNodes.filter(n=>n.code!=='WD').sort((a,b) => (ranks[a.code] ?? 10) - (ranks[b.code] ?? 10) || (order[a.code] ?? 0) - (order[b.code] ?? 0) || a.code.localeCompare(b.code));
  const columns = [...new Set(nodes.map(n => ranks[n.code] ?? 10))];
  const positions = {}, counts = {};
  const columnStep=$('statistics').checked?330:215;
  const returnCount = edges.filter(e=>(ranks[e.to]??10)<=(ranks[e.from]??10)).length;
  const skipCount = edges.filter(e=>(ranks[e.to]??10)-(ranks[e.from]??10)>1).length;
  const topMargin = 175 + Math.max(returnCount*14,skipCount*12);
  nodes.forEach(n => {
    const rank = ranks[n.code] ?? 10;
    const row = counts[rank] || 0;
    counts[rank] = row+1;
    positions[n.code] = {x:110+columns.indexOf(rank)*columnStep,y:topMargin+row*140+(declineCodes.includes(n.code)?45:0)};
  });
  const width=Math.max(720,columns.length*columnStep+25);
  if(visibleNodes.some(n=>n.code==='WD')) {
    // Withdrawal is an outcome possible at any point, not a step between
    // approval and funding. Keep it on its own lane below the other buckets.
    positions.WD={x:width/2,y:Math.max(topMargin,...Object.values(positions).map(p=>p.y))+170};
  }
  const buckets=[];
  const addBucket=(label,codes,separate=false)=>{
    const points=codes.filter(code=>positions[code]).map(code=>positions[code]);
    if(!points.length)return;
    const left=Math.min(...points.map(p=>p.x))-83,right=Math.max(...points.map(p=>p.x))+83;
    buckets.push({label,x:left,width:right-left,y:separate?Math.min(...points.map(p=>p.y))-76:65});
  };
  addBucket('Submission',['QT','AS','SU','AD']);
  addBucket('Decision (good)',['AP','CA','CP']);
  addBucket('Funding',['DI','DR','RF','PP','BK','FN']);
  addBucket('Decision (decline)',declineCodes,true);
  addBucket('Withdrawn · can happen anytime',['WD'],true);
  addBucket('Other observed states',nodes.filter(n=>ranks[n.code]==null).map(n=>n.code));
  return {positions,buckets,columnStep,width,height:Math.max(430,Math.max(...Object.values(positions).map(p=>p.y))+125)};
}
function svgText(x,y,text,cls,extra='') { return `<text x="${x}" y="${y}" class="${cls}" ${extra}>${escapeHtml(text)}</text>`; }
function splitTitle(text) {
  if (text.length < 22) return [text];
  const words = text.split(' '); let first = '', rest = '';
  words.forEach(w => { if (!rest && (first + ' ' + w).trim().length <= 21) first += (first ? ' ' : '') + w; else rest += (rest ? ' ' : '') + w; });
  return [first, rest];
}
function renderMap() {
  const f = data.flow, svg = $('map'), traffic = $('traffic').checked, happy = $('happy').checked, statistics = $('statistics').checked;
  const next = f.edges.filter(e => e.from === f.currentCode && e.count).sort((a,b) => b.count-a.count).slice(0,2);
  const edges = f.edges.filter(e => $('allRoutes').checked || e.onDeal || (happy && e.happy) || next.includes(e)).sort((a,b) => Number(a.onDeal)-Number(b.onDeal));
  const visibleNodes = f.nodes.filter(n => n.visited || edges.some(e => e.from === n.code || e.to === n.code));
  const {positions,buckets,columnStep,width,height} = layout(visibleNodes,edges);
  $('stateCount').textContent = `${visibleNodes.length} of ${f.nodes.length} observed states`;
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.style.width = `${zoom * 100}%`; svg.style.height = `${Math.max(460, height / width * $('mapViewport').clientWidth) * zoom}px`;
  svg.style.minWidth=statistics?`${width*zoom}px`:'720px';
  svg.setAttribute('preserveAspectRatio','xMidYMid meet');
  let markup = '<defs><marker id="arrow-blue" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#3569ef"/></marker><marker id="arrow-gray" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#aebccf"/></marker></defs>';
  markup += svgText(30,35,'OBSERVED STATUS TRANSITIONS','map-caption');
  buckets.forEach(bucket=>{
    markup += svgText(bucket.x,bucket.y,bucket.label,'bucket-label');
    markup += `<line x1="${bucket.x}" y1="${bucket.y+12}" x2="${bucket.x+bucket.width}" y2="${bucket.y+12}" class="bucket-rule"/>`;
  });
  let returnLane = 0, forwardLane = 0;
  edges.forEach((edge,index) => {
    const a = positions[edge.from], b = positions[edge.to];
    const backwards = b.x <= a.x;
    let path, labelX, labelY;
    if (b.x===a.x) {
      // Alternative decisions share a column. Route around their cards,
      // rather than vertically through another decision in that bucket.
      const side=b.y>a.y?1:-1,port=a.x+side*83,bend=a.x+side*130;
      path=`M ${port} ${a.y} C ${bend} ${a.y}, ${bend} ${b.y}, ${port} ${b.y}`;
      labelX=a.x+side*118;labelY=(a.y+b.y)/2+24;
    } else if (backwards) {
      const top = Math.min(...Object.values(positions).map(p=>p.y)) - 80 - returnLane++*14;
      const x1 = a.x+20, x2 = b.x-20;
      path = `M ${x1} ${a.y-36} C ${x1} ${top}, ${x2} ${top}, ${x2} ${b.y-36}`;
      labelX = (x1+x2)/2; labelY = top+14;
    } else if (b.x-a.x > columnStep+5) {
      // Route skipped columns above the nodes so an edge cannot imply a visit
      // to an unrelated state that happens to occupy the intervening row.
      const top = Math.min(...Object.values(positions).map(p=>p.y)) - 55 - forwardLane++*12;
      path = `M ${a.x+45} ${a.y-36} C ${a.x+45} ${top}, ${b.x-45} ${top}, ${b.x-45} ${b.y-36}`;
      labelX=(a.x+b.x)/2;labelY=top+10;
    } else {
      const x1=a.x+83,x2=b.x-83;
      path = `M ${x1} ${a.y} C ${x1+(x2-x1)*.5} ${a.y}, ${x2-(x2-x1)*.5} ${b.y}, ${x2} ${b.y}`;
      labelX=(x1+x2)/2;labelY=(a.y+b.y)/2-9;
    }
    const isSelected = selectedEdge && selectedEdge.from === edge.from && selectedEdge.to === edge.to;
    const stroke = edge.onDeal ? '#3569ef' : traffic && edge.count ? trafficColor(edge.meanHours) : '#c3cedd';
    if (happy && edge.happy) markup += `<path class="edge" d="${path}" stroke="#b6decf" stroke-width="10" stroke-dasharray="7 6" opacity=".8"/>`;
    markup += `<path class="edge" d="${path}" stroke="${stroke}" stroke-width="${isSelected ? 4.5 : edge.onDeal ? 3 : 1.8}" opacity="${edge.onDeal ? 1 : .7}" marker-end="url(#arrow-${edge.onDeal ? 'blue' : 'gray'})"/>`;
    const actualLabel=statistics?`Deal: ${arrowLabel(edge)}`:arrowLabel(edge);
    markup += svgText(labelX,labelY-(statistics&&edge.count?5:0),actualLabel,'edge-label');
    if(statistics) {
      const historyLabel=edge.count?`History: avg ${duration(edge.meanHours)} · ${percentage(edge.probability)} of exits`:'History: no sample';
      markup += svgText(labelX,labelY+10,historyLabel,'edge-label edge-history-label');
    }
    markup += `<path class="edge-hit" d="${path}" data-edge="${index}" tabindex="0" role="button" aria-label="${escapeHtml(nodeName(edge.from)+' to '+nodeName(edge.to))}"><title>${escapeHtml(nodeName(edge.from)+' → '+nodeName(edge.to))} | This deal: ${escapeHtml(edge.onDeal?edge.dealHours.map(actualDuration).join(' / '):'Not taken')} | Click for historical comparison</title></path>`;
  });
  visibleNodes.forEach(node => {
    const p=positions[node.code], classes=['node',node.current?'node-current':node.visited?'node-visited':'',selectedCode===node.code?'node-selected':''].join(' ');
    const notes=stateNotes(node.code);
    markup += `<g class="${classes}" data-code="${escapeHtml(node.code)}" tabindex="0" role="button" aria-label="${escapeHtml(node.name)}${node.current?', current position':''}, ${notes.length} messages">`;
    if(node.current) markup += `<rect class="node-halo" x="${p.x-90}" y="${p.y-43}" width="180" height="86" rx="14"/>`;
    markup += `<rect class="node-card" x="${p.x-83}" y="${p.y-36}" width="166" height="72" rx="9"/>`;
    const title=splitTitle(node.name);
    markup += svgText(p.x-69,p.y-(title.length===2?12:5),title[0],'node-title');
    if(title.length===2) markup += svgText(p.x-69,p.y+3,title[1],'node-title');
    const visits=f.timeline.filter(v=>v.code===node.code);
    const totalHours=visits.reduce((sum,visit)=>sum+visit.hours,0);
    const dealSubtitle=visits.length>1?`Total ${actualDuration(totalHours)} · ${visits.length} visits`:node.current?(f.closed?'Outcome recorded':`Here for ${actualDuration(f.currentHours)}`):visits.length?`This deal: ${actualDuration(totalHours)}`:'Not visited by this deal';
    const historicalSubtitle=node.meanHours!=null?`Hist avg ${duration(node.meanHours)} · ${node.completedVisits} exits`:`${node.historicalVisits} historical visits`;
    markup += svgText(p.x-69,p.y+22,dealSubtitle,'node-subtitle node-deal-duration');
    if(statistics)markup += svgText(p.x-69,p.y+34,historicalSubtitle,'node-subtitle node-history-summary');
    markup += svgText(p.x+69,p.y+22,node.code,'node-code','text-anchor="end"');
    if(node.current) markup += svgText(p.x,p.y+61,'● CURRENT POSITION','node-current-label','text-anchor="middle"');
    if(node.visited&&!node.current) markup += `<circle cx="${p.x+76}" cy="${p.y-29}" r="7" fill="#6b91e9"/><text x="${p.x+76}" y="${p.y-26}" text-anchor="middle" font-size="9" fill="white">✓</text>`;
    if(notes.length) {
      markup += `<rect class="message-badge" x="${p.x+28}" y="${p.y-53}" width="55" height="20" rx="9"/>`;
      markup += svgText(p.x+55,p.y-39,`${notes.length} msg`,'message-badge-label','text-anchor="middle"');
    }
    markup += '</g>';
  });
  markup += svgText(30,height-25,statistics?'Deal: actual elapsed time. History: average wait and share of recorded exits.':'Arrow times are for this deal. Enable Statistics or click a route for historical comparisons.','map-caption');
  svg.innerHTML=markup;
  svg.querySelectorAll('[data-code]').forEach(element => {
    const select=()=>{ selectedCode=element.dataset.code; selectedEdge=null;renderMap();renderDetail(); };
    element.addEventListener('click',select);element.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();select();}});
  });
  svg.querySelectorAll('[data-edge]').forEach(element => {
    const select=()=>{selectedEdge=edges[Number(element.dataset.edge)];selectedCode=null;renderMap();renderDetail();};
    element.addEventListener('click',select);element.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();select();}});
  });
}

function stat(label,value) { return `<div class="detail-stat"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`; }
function stateNotes(code) { return (data.notes||[]).filter(note=>note.stateCode===code); }
function renderMessages(notes, repeatedState=false) {
  return [...notes].sort((a,b)=>String(b.at||'').localeCompare(String(a.at||''))).map(note=>`<article class="deal-note" data-note-id="${escapeHtml(note.id)}"><div class="note-sender"><strong>${escapeHtml(note.sender||note.actor)}</strong><span class="note-actor ${note.actor==='Dealer'?'dealer':'lender'}">${escapeHtml(note.actor)}</span></div><time>${escapeHtml(note.at?dateLabel(note.at):'No timestamp')}</time>${repeatedState&&note.visitAt?`<div class="note-visit">Visit started ${escapeHtml(dateLabel(note.visitAt))}</div>`:''}${note.subject?`<h4>${escapeHtml(note.subject)}</h4>`:''}<div class="note-text">${escapeHtml((note.text||'').trim())}</div></article>`).join('');
}
function renderTransitionDetails(edge) {
  const f=data.flow,from=nodeName(edge.from),to=nodeName(edge.to);
  const passes=f.timeline.slice(0,-1).filter((visit,index)=>visit.code===edge.from&&f.timeline[index+1].code===edge.to);
  const exits=f.edges.filter(e=>e.from===edge.from).reduce((sum,e)=>sum+e.count,0);
  const actual=passes.length?passes.map((visit,index)=>`<article class="transition-pass"><h4>${passes.length>1?`Pass ${index+1} · `:''}${actualDuration(visit.hours)}</h4><p>Entered ${escapeHtml(from)}<br><strong>${escapeHtml(dateLabel(visit.at))}</strong></p><p>Reached ${escapeHtml(to)}<br><strong>${escapeHtml(dateLabel(visit.until))}</strong></p></article>`).join(''):'<p>This deal has not taken this transition.</p>';
  const historical=edge.count?`${stat('Recorded transitions',edge.count)}${stat('Distinct deals',edge.deals)}${stat('Average duration',duration(edge.meanHours))}${stat('Median duration',duration(edge.medianHours))}${stat('90th percentile duration',duration(edge.p90Hours))}<p class="detail-hint"><strong>${edge.count} of ${exits} recorded exits from ${escapeHtml(from)}</strong> went directly to ${escapeHtml(to)} (${percentage(edge.probability)}).</p><p>Average duration means time spent in ${escapeHtml(from)} before moving directly to ${escapeHtml(to)}. It is calculated from these ${edge.count} completed transitions.</p><p>The median is the midpoint of those durations. The 90th percentile is the duration that 90% of those waits did not exceed.</p><p>Repeat visits count separately. Deals still waiting contribute no exit. This percentage describes past transitions; it is not an approval probability.</p>`:'<p>No completed transitions of this type were found in the comparison sample.</p>';
  return `<div class="eyebrow">TRANSITION DETAILS</div><h3>${escapeHtml(from)}<br>→ ${escapeHtml(to)}</h3><span class="detail-code">${escapeHtml(edge.from)} → ${escapeHtml(edge.to)}</span><h4 class="transition-heading">This deal · #${escapeHtml(data.dealId)}</h4>${actual}<h4 class="transition-heading">Historical comparison</h4><p>${f.cohortDeals} other ${escapeHtml(data.lender)} / ${escapeHtml(productName(data.product))} deals · ${data.days}-day activity window. This deal is excluded.</p>${historical}`;
}
function renderDetail() {
  const f=data.flow;
  $('detail').scrollTop=0;
  if(selectedEdge) {
    const e=selectedEdge;
    $('detail').innerHTML=renderTransitionDetails(e);
    return;
  }
  const n=f.nodes.find(n=>n.code===selectedCode)||f.nodes.find(n=>n.current);
  const visits=f.timeline.filter(v=>v.code===n.code);
  const next=f.edges.filter(e=>e.from===n.code&&e.count).sort((a,b)=>b.count-a.count);
  $('detail').innerHTML=`<div class="eyebrow">${n.current?'YOU ARE HERE':'STATE DETAILS'}</div><h3>${escapeHtml(n.name)}</h3><span class="detail-code">${escapeHtml(n.code)}</span>${stat('Visits by this deal',n.dealVisits)}${n.current?stat(f.closed?'Outcome at':'Current wait',f.closed?dateLabel(f.timeline.at(-1).at):duration(f.currentHours)):''}${stat('Historical visits',n.historicalVisits)}${stat('Observed exits / open waits',`${n.completedVisits} / ${n.openVisits}`)}${stat('Mean completed dwell',duration(n.meanHours))}${stat('Median / p90',n.medianHours==null?'No sample':`${duration(n.medianHours)} / ${duration(n.p90Hours)}`)}${visits.length?`<div class="detail-subhead">THIS DEAL’S VISITS</div>${visits.map(v=>`<p>${escapeHtml(dateLabel(v.at))}<br>${escapeHtml(v.until?actualDuration(v.hours)+' before next state':n.terminal?'Outcome recorded':'Still here')} · ${v.snapshots} snapshot${v.snapshots===1?'':'s'}</p>`).join('')}`:''}<div class="detail-subhead">OBSERVED NEXT STATES</div>${next.length?next.slice(0,6).map(e=>`<div class="next-row"><span>${escapeHtml(nodeName(e.to))}</span><b>${percentage(e.probability)}</b></div><div class="prob-bar"><i style="width:${e.probability*100}%"></i></div>`).join(''):'<p>No outgoing transitions in this cohort.</p>'}<p class="detail-hint">${n.terminal?'The journey clock stops at this outcome. Later observed changes remain visible.':'Open waits are shown separately and excluded from completed dwell averages.'}</p>`;
  const notes=stateNotes(n.code);
  $('detail').querySelector('.detail-code').insertAdjacentHTML('afterend',`<section class="state-messages"><h4>Messages (${notes.length})</h4>${notes.length?renderMessages(notes,visits.length>1):`<p>${n.visited?'No messages recorded during this state.':'This deal has not visited this state.'}</p>`}${notes.length?'<p class="note-association">Placed by message timestamp within this deal’s state history.</p>':''}</section>`);
}

function renderTimeline() {
  const f=data.flow;
  $('activityCount').textContent=`${f.timeline.length} states · ${f.snapshots} snapshots`;
  $('timeline').innerHTML=f.timeline.map((v,i)=>`<div class="activity ${i===f.timeline.length-1?'current':''}"><span class="activity-marker"></span><div><div class="activity-title">${escapeHtml(v.name)}${i===f.timeline.length-1?'<small>Current</small>':''}</div><p>${escapeHtml(v.actor)} · Application ${v.applicationId} · ${v.snapshots} snapshot${v.snapshots===1?'':'s'}</p></div><div class="activity-time">${escapeHtml(dateLabel(v.at))}<span>${escapeHtml(v.until?duration(v.hours)+' until next state':f.closed?'Outcome recorded':duration(v.hours)+' and counting')}</span></div></div>`).join('');
  $('timeline').querySelectorAll('.activity-title').forEach((title,index)=>{
    const visit=f.timeline[index],count=(data.notes||[]).filter(note=>note.visitAt===visit.at).length;
    if(!count)return;
    const button=document.createElement('button');button.className='activity-messages';button.textContent=`${count} message${count===1?'':'s'}`;
    button.addEventListener('click',()=>{selectedCode=visit.code;selectedEdge=null;renderMap();renderDetail();$('detail').scrollIntoView({block:'nearest'});});
    title.appendChild(button);
  });
}
function renderTraffic() {
  const f=data.flow, nodes=f.nodes.filter(n=>n.meanHours!=null).sort((a,b)=>b.meanHours-a.meanHours).slice(0,4), max=nodes[0]?.meanHours||1;
  let report=nodes.length?nodes.map(n=>`<div class="traffic-item"><h4><i class="dot" style="background:${trafficColor(n.meanHours)}"></i>${escapeHtml(n.name)}<strong>${duration(n.meanHours)}</strong></h4><div class="traffic-track"><i style="width:${Math.max(3,n.meanHours/max*100)}%;background:${trafficColor(n.meanHours)}"></i></div><p>Mean dwell · ${n.completedVisits} observed exits · p90 ${duration(n.p90Hours)}</p></div>`).join(''):'<p class="empty-note">No completed transitions to compare in this period.</p>';
  report += `<div class="detail-subhead">COMMON COMPLETED FUNDING ROUTE</div>`;
  report += f.happyPath.length?`<p style="font-size:11px;color:#527c6e">${f.happyPath.map(escapeHtml).join(' → ')}</p><p class="cohort-note">Observed in ${f.happyPathDeals} of ${f.successfulDeals} deals currently Booked or Finalized. Median time from first recorded state to Booked/Finalized across those deals: ${duration(f.medianSuccessHours)}. The green overlay uses only these completed histories; it is not a funding ETA.</p>`:'<p class="cohort-note">No deal currently Booked or Finalized in this cohort. No completed funding route is drawn.</p>';
  report += `<div class="detail-subhead">APPROVAL MILESTONE · CURRENTLY APPROVED</div>`;
  report += f.approvalPath?.length?`<p style="font-size:11px;color:#6c7c96">${f.approvalPath.map(escapeHtml).join(' → ')}</p><p class="cohort-note">Observed in ${f.approvalPathDeals} of ${f.approvalOnlyDeals} deals currently Approved. Median time to approval across this group: ${duration(f.medianApprovalHours)}. These histories end at the approval milestone and are excluded from the green funding route.</p>`:'<p class="cohort-note">No approval-only histories in this cohort.</p>';
  report += '<p class="cohort-note">Colors use fixed mean-dwell bands (&lt; 1h, 1–24h, &gt; 24h), not an SLA. QA test data can include artificial delays. Repeated saves in the same status count as one visit.</p>';
  $('trafficReport').innerHTML=report;
}

function showCatalog(show) {
  catalogVisible=show; $('catalogPanel').classList.toggle('hidden',!show);$('explorer').classList.toggle('hidden',show||!data);$('welcome').classList.toggle('hidden',show||!!data);
  $('catalogNav').classList.toggle('active',show);$('mapNav').classList.toggle('active',!show);
  if(show) loadCatalog();
}
$('searchForm').addEventListener('submit',event=>{event.preventDefault();loadDeal($('dealId').value.trim());});
$('days').addEventListener('change',()=>{if(data)loadDeal(data.dealId,data.stream);});
$('stream').addEventListener('change',()=>loadDeal(data.dealId,$('stream').value));
$('reloadRecent').addEventListener('click',loadRecent);
$('traffic').addEventListener('change',()=>{if(data)renderMap();});
$('statistics').addEventListener('change',()=>{if(data)renderMap();});
$('happy').addEventListener('change',()=>{if(data)renderMap();});
$('allRoutes').addEventListener('change',()=>{if(data)renderMap();});
$('zoomIn').addEventListener('click',()=>{zoom=Math.min(3,zoom+.25);renderMap();});
$('zoomOut').addEventListener('click',()=>{zoom=Math.max(.75,zoom-.25);renderMap();});
$('fit').addEventListener('click',()=>{zoom=1;renderMap();});
$('catalogNav').addEventListener('click',()=>showCatalog(true));
$('mapNav').addEventListener('click',()=>showCatalog(false));
$('closeCatalog').addEventListener('click',()=>showCatalog(false));
window.addEventListener('resize',()=>{if(data&&!catalogVisible)renderMap();});
loadRecent();loadCatalog();
const initial=new URLSearchParams(location.search);
if(initial.has('days')&&[...$('days').options].some(o=>o.value===initial.get('days'))) $('days').value=initial.get('days');
if(initial.has('deal')) loadDeal(initial.get('deal'),initial.get('stream')||'');
