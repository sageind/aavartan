(async function(){
  'use strict';

  const secure = window.AAVARTAN_SECURE;
  if(!secure) return;

  const STORE_KEY = 'aavartan_visits_v2';
  const DEPS_SEEN = 'aavartan_deps_seen_v1';

  const tbody = document.getElementById('visitsTbody');
  const qName = document.getElementById('qName');
  const qFrom = document.getElementById('qFrom');
  const qTo   = document.getElementById('qTo');
  const qSort = document.getElementById('qSort');
  const applyBtn = document.getElementById('applyFilterBtn');
  const resetBtn = document.getElementById('resetFilterBtn');

  const exportTxtBtn = document.getElementById('exportTxtBtn');
  const importTxtFile = document.getElementById('importTxtFile');
  const todayBadge = document.getElementById('todayBadge');
  const countBadge = document.getElementById('visitCountBadge') || document.getElementById('visitsCountBadge');

  // Deps modal (first-run checklist)
  const depsModalEl = document.getElementById('depsModal');
  const depsBody = document.getElementById('depsBody');

  const EXTERNAL_DEPS = [
    { name: 'Bootstrap CSS', url: 'https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css' },
    { name: 'Bootstrap JS Bundle', url: 'https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/js/bootstrap.bundle.min.js' },
    { name: 'Flatpickr CSS', url: 'https://cdn.jsdelivr.net/npm/flatpickr/dist/flatpickr.min.css' },
    { name: 'Flatpickr JS', url: 'https://cdn.jsdelivr.net/npm/flatpickr' },
    { name: 'jsPDF', url: 'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js' },
    { name: 'jsPDF AutoTable', url: 'https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.3/dist/jspdf.plugin.autotable.min.js' }
  ];

  const detailSection = document.getElementById('visitDetailSection');
  const detailFrame = document.getElementById('detailFrame');
  const openInFullBtn = document.getElementById('openInFullBtn');
  const closeDetailBtn = document.getElementById('closeDetailBtn');

  function escapeHtml(s){
    return String(s || '')
      .replaceAll('&','&amp;')
      .replaceAll('<','&lt;')
      .replaceAll('>','&gt;')
      .replaceAll('"','&quot;')
      .replaceAll("'",'&#39;');
  }

  function showDepsChecklist(auto = false){
    if(!depsModalEl || !depsBody || !window.bootstrap) return;
    const html = `
      <div class="small text-muted mb-2">
        Download these ⚡ files for full offline use. Replace the CDN links in <code>index.html</code> with local paths.
      </div>
      <ol class="mb-0">
        ${EXTERNAL_DEPS.map(d => `<li><b>${escapeHtml(d.name)}</b><br><a class="deps-link" href="${d.url}" target="_blank" rel="noopener">${escapeHtml(d.url)}</a> ⚡</li>`).join('')}
      </ol>
      <div class="small text-muted mt-3">
        Optional: for strict Arial in PDF, embed <code>arial.ttf</code> in jsPDF.
      </div>
    `;
    depsBody.innerHTML = html;
    const modal = new bootstrap.Modal(depsModalEl);
    modal.show();
    if(auto) secure.set(DEPS_SEEN, '1').catch(()=>{});
  }

  function pad2(n){ return String(n).padStart(2, '0'); }

  function toDMSShort(dateStr){
    if(!dateStr) return '';
    const d = new Date(dateStr + 'T00:00:00');
    const dd = pad2(d.getDate());
    const mon = d.toLocaleString('en-US', { month: 'short' }).toUpperCase();
    const yy = pad2(d.getFullYear() % 100);
    return `${dd} ${mon} ${yy}`;
  }

  function formatToday(){
    const d = new Date();
    const dd = pad2(d.getDate());
    const mon = d.toLocaleString('en-US', { month: 'short' }).toUpperCase();
    const yyyy = d.getFullYear();
    return `${dd} ${mon} ${yyyy}`;
  }

  async function loadAll(){
    try { return JSON.parse((await secure.get(STORE_KEY)) || '[]'); }
    catch { return []; }
  }

  function saveAll(all){
    secure.set(STORE_KEY, JSON.stringify(all)).catch(()=>{});
  }

  function normalizeList(list){
    return (Array.isArray(list) ? list : []).filter(v => v && v.id);
  }

  function getHeader(v){
    if(v && v.header) return v.header;
    return {
      eventName: v.eventName || '',
      vipTitle: '',
      vipFirst: '',
      vipLast: '',
      vipAwards: '',
      vipDesig: '',
      stationName: '',
      visitFrom: v.visitFrom || '',
      visitTo: v.visitTo || ''
    };
  }

  function vipDisplay(h){
    const name = [h.vipTitle, h.vipFirst, h.vipLast].filter(Boolean).join(' ').trim() || '(Unnamed)';
    const awards = (h.vipAwards || '').trim();
    return (awards ? `${name}, ${awards}` : name).toUpperCase();
  }

  function createdDisplay(v){
    const c = v.createdAt || '';
    if(!c) return '—';
    try{
      const d = new Date(c);
      if(Number.isNaN(d.getTime())) return escapeHtml(c);
      return d.toLocaleString(undefined, { year:'2-digit', month:'short', day:'2-digit', hour:'2-digit', minute:'2-digit' }).toUpperCase();
    }catch{
      return escapeHtml(c);
    }
  }

  function inRange(dateStr, fromStr, toStr){
    if(!dateStr) return true;
    const d = new Date(dateStr + 'T00:00:00');
    if(fromStr){
      const f = new Date(fromStr + 'T00:00:00');
      if(d < f) return false;
    }
    if(toStr){
      const t = new Date(toStr + 'T00:00:00');
      if(d > t) return false;
    }
    return true;
  }

  function isPastVisit(v){
    const h = (v && v.header) ? v.header : {};
    const endStr = (h.visitTo || h.visitFrom || '').trim();
    if(!endStr) return false;
    const end = new Date(endStr + 'T23:59:59');
    if(Number.isNaN(end.getTime())) return false;
    return end.getTime() < Date.now();
  }

  async function openVisit(id){
    if(!id) return;

    // Pull the full visit object so we can hand it to the embedded view (important for file:// origins).
    const all = normalizeList(await loadAll());
    const visit = all.find(x => x.id === id) || null;

    // If inline details area exists, load inside the page
    if(detailSection && detailFrame){
      detailSection.classList.remove('d-none');

            const target = (visit && isPastVisit(visit)) ? 'vispgme_view.html' : 'vispgme.html';
      const src = `${target}?embedded=1#load=${encodeURIComponent(id)}`;
      detailFrame.src = src;

      // Fallback: push the visit data into the iframe via postMessage so it can render even if localStorage is not shared.
      detailFrame.onload = () => {
        try{
          if(!detailFrame.contentWindow) return;
          detailFrame.contentWindow.postMessage({ type: 'aavartan:openVisit', visitId: id, visit }, '*');
        }catch(e){}
      };
      if(openInFullBtn){
        const past = (visit && isPastVisit(visit));
        // For past visits, keep inline preview only; do not offer fullscreen navigation.
        openInFullBtn.style.display = past ? 'none' : '';
        if(!past) openInFullBtn.href = `${target}#load=${encodeURIComponent(id)}`;
      }
      try{ history.replaceState(null, document.title, `${location.pathname}${location.search}#open=${encodeURIComponent(id)}`); }catch(e){}
      // Scroll into view
      setTimeout(() => detailSection.scrollIntoView({ behavior:'smooth', block:'start' }), 60);
      return;
    }

    // Fallback: navigate
        const target = (visit && isPastVisit(visit)) ? 'vispgme_view.html' : 'vispgme.html';
    location.href = `${target}#load=${encodeURIComponent(id)}`;
  }

  async function closeInline(){
    if(!detailSection || !detailFrame) return;
    detailSection.classList.add('d-none');
    detailFrame.src = 'about:blank';
    try{ history.replaceState(null, document.title, `${location.pathname}${location.search}`); }catch(e){}
  }

  function render(list){
    if(!tbody) return;
    tbody.innerHTML = '';
    if(countBadge) countBadge.textContent = String(list.length);

    list.forEach((v, i) => {
      const h = getHeader(v);
      const dates = (h.visitFrom || h.visitTo)
        ? `${toDMSShort(h.visitFrom)} - ${toDMSShort(h.visitTo)}`.replace(/\s-\s$/, '').replace(/^\s-\s/, '')
        : '—';

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td style="text-align:center;">${i+1}</td>
        <td>${escapeHtml(vipDisplay(h))}</td>
        <td>${escapeHtml((h.eventName || '—').toUpperCase())}</td>
        <td style="text-align:center; white-space:nowrap;">${escapeHtml(dates)}</td>
        <td style="text-align:center; white-space:nowrap;">${escapeHtml(createdDisplay(v))}</td>
        <td class="no-print" style="text-align:center;">
          <div class="d-flex gap-2 justify-content-center flex-wrap">
            <button class="btn btn-sm btn-primary fw-bold" type="button" data-open="${escapeHtml(v.id)}">Open</button>
            <button class="btn btn-sm btn-outline-danger fw-bold" type="button" data-del="${escapeHtml(v.id)}">Delete</button>
          </div>
        </td>
      `;
      tbody.appendChild(tr);
    });

    tbody.querySelectorAll('[data-del]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-del');
        if(!id) return;
        if(!confirm('Delete this visit?')) return;
        const all = normalizeList(await loadAll()).filter(x => x.id !== id);
        saveAll(all);
        applyFilters();
      });
    });

    tbody.querySelectorAll('[data-open]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-open');
        openVisit(id);
      });
    });
  }

  async function applyFilters(){
    let all = normalizeList(await loadAll());

    const nameQ = (qName && qName.value ? qName.value : '').trim().toLowerCase();
    const fromQ = (qFrom && qFrom.value) ? qFrom.value : '';
    const toQ = (qTo && qTo.value) ? qTo.value : '';
    const sort = (qSort && qSort.value) ? qSort.value : 'dateDesc';

    if(nameQ){
      all = all.filter(v => {
        const h = getHeader(v);
        const combined = [h.vipTitle, h.vipFirst, h.vipLast, h.vipAwards, h.vipDesig]
          .filter(Boolean).join(' ').toLowerCase();
        return combined.includes(nameQ);
      });
    }

    if(fromQ || toQ){
      all = all.filter(v => inRange(getHeader(v).visitFrom, fromQ, toQ));
    }

    if(sort === 'dateDesc'){
      all.sort((a,b) => (getHeader(b).visitFrom || '').localeCompare(getHeader(a).visitFrom || ''));
    }else if(sort === 'dateAsc'){
      all.sort((a,b) => (getHeader(a).visitFrom || '').localeCompare(getHeader(b).visitFrom || ''));
    }else if(sort === 'nameAsc'){
      all.sort((a,b) => vipDisplay(getHeader(a)).localeCompare(vipDisplay(getHeader(b))));
    }else if(sort === 'nameDesc'){
      all.sort((a,b) => vipDisplay(getHeader(b)).localeCompare(vipDisplay(getHeader(a))));
    }

    render(all);
  }

  async function reset(){
    if(qName) qName.value = '';
    if(qFrom) qFrom.value = '';
    if(qTo) qTo.value = '';
    if(qSort) qSort.value = 'dateDesc';
    applyFilters();
  }

  function buildTxtExport(visits){
    const out = [];
    out.push('AAVARTAN_TXT_V1');
    out.push('');
    (visits || []).forEach(v => {
      const h = v.header || {};
      out.push('BEGIN_VISIT');
      out.push(`id=${v.id || ''}`);
      out.push(`createdAt=${v.createdAt || ''}`);
      out.push(`eventName=${(h.eventName || '').replace(/\n/g,' ')}`);
      out.push(`vipTitle=${(h.vipTitle || '').replace(/\n/g,' ')}`);
      out.push(`vipFirst=${(h.vipFirst || '').replace(/\n/g,' ')}`);
      out.push(`vipLast=${(h.vipLast || '').replace(/\n/g,' ')}`);
      out.push(`vipAwards=${(h.vipAwards || '').replace(/\n/g,' ')}`);
      out.push(`vipDesig=${(h.vipDesig || '').replace(/\n/g,' ')}`);
      out.push(`stationName=${(h.stationName || '').replace(/\n/g,' ')}`);
      out.push(`visitFrom=${h.visitFrom || ''}`);
      out.push(`visitTo=${h.visitTo || ''}`);

      out.push('BEGIN_ROWS');
      (v.rows || []).forEach(r => {
        out.push('BEGIN_ROW');
        out.push(`id=${r.id || ''}`);
        out.push(`createdAt=${r.createdAt || ''}`);
        out.push(`date=${r.date || ''}`);
        out.push(`start=${r.start || ''}`);
        out.push(`style=${r.style || ''}`);
        out.push(`minutes=${(r.minutes ?? '')}`);

        out.push('BEGIN_EVENT');
        out.push(String(r.eventText || '').replace(/\r/g,''));
        out.push('END_EVENT');

        out.push('BEGIN_REMARKS');
        out.push(String(r.remarksText || '').replace(/\r/g,''));
        out.push('END_REMARKS');
        out.push('END_ROW');
      });
      out.push('END_ROWS');
      out.push('END_VISIT');
      out.push('');
    });
    return out.join('\n');
  }

  async function exportAllTxt(){
    const blob = new Blob([buildTxtExport(normalizeList(await loadAll()))], { type:'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'aavartan_visits_export.txt';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function parseTxtImport(text){
    const src = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g,'\n');
    const lines = src.split('\n');
    let i = 0;
    while(i < lines.length && !lines[i].trim()) i++;
    if(i >= lines.length) throw new Error('Empty file.');
    const header = lines[i].trim().replace(/^\ufeff/, '');
    if(header !== 'AAVARTAN_TXT_V1') throw new Error('Invalid file header. Expected AAVARTAN_TXT_V1.');
    i++;

    function readBlockUntil(endToken){
      const buf = [];
      while(i < lines.length && lines[i].trim() !== endToken){
        buf.push(lines[i]);
        i++;
      }
      if(i >= lines.length) throw new Error(`Missing ${endToken}.`);
      i++; // consume endToken
      while(buf.length && !buf[buf.length-1].trim()) buf.pop();
      return buf.join('\n');
    }

    const visits = [];
    function readKV(){
      const line = lines[i];
      const m = line.match(/^([^=]+)=(.*)$/);
      if(!m) return null;
      return { k: m[1].trim(), v: (m[2] ?? '').trim() };
    }

    while(i < lines.length){
      while(i < lines.length && !lines[i].trim()) i++;
      if(i >= lines.length) break;
      if(lines[i].trim() !== 'BEGIN_VISIT'){ i++; continue; }
      i++; // BEGIN_VISIT

      const v = { id:'', createdAt:'', header:{}, rows:[] };

      while(i < lines.length && lines[i].trim() !== 'BEGIN_ROWS'){
        const kv = readKV();
        if(kv){
          if(kv.k === 'id') v.id = kv.v;
          else if(kv.k === 'createdAt') v.createdAt = kv.v;
          else if(kv.k === 'eventName') v.header.eventName = kv.v;
          else if(kv.k === 'vipTitle') v.header.vipTitle = kv.v;
          else if(kv.k === 'vipFirst') v.header.vipFirst = kv.v;
          else if(kv.k === 'vipLast') v.header.vipLast = kv.v;
          else if(kv.k === 'vipAwards') v.header.vipAwards = kv.v;
          else if(kv.k === 'vipDesig') v.header.vipDesig = kv.v;
          else if(kv.k === 'stationName') v.header.stationName = kv.v;
          else if(kv.k === 'visitFrom') v.header.visitFrom = kv.v;
          else if(kv.k === 'visitTo') v.header.visitTo = kv.v;
        }
        i++;
      }
      if(i >= lines.length || lines[i].trim() !== 'BEGIN_ROWS') throw new Error('Missing BEGIN_ROWS in a visit.');
      i++; // BEGIN_ROWS

      while(i < lines.length && lines[i].trim() !== 'END_ROWS'){
        while(i < lines.length && !lines[i].trim()) i++;
        if(i >= lines.length) throw new Error('Unexpected EOF inside rows.');
        if(lines[i].trim() !== 'BEGIN_ROW'){ i++; continue; }
        i++; // BEGIN_ROW

        const r = { id:'', createdAt:'', date:'', start:'', style:'duration', minutes:0, eventText:'', remarksText:'' };

        while(i < lines.length && lines[i].trim() !== 'BEGIN_EVENT'){
          const kv = readKV();
          if(kv){
            if(kv.k === 'id') r.id = kv.v;
            else if(kv.k === 'createdAt') r.createdAt = kv.v;
            else if(kv.k === 'date') r.date = kv.v;
            else if(kv.k === 'start') r.start = kv.v;
            else if(kv.k === 'style') r.style = kv.v || 'duration';
            else if(kv.k === 'minutes') r.minutes = Number(kv.v || 0);
          }
          i++;
        }
        if(i >= lines.length || lines[i].trim() !== 'BEGIN_EVENT') throw new Error('Missing BEGIN_EVENT in a row.');
        i++; // BEGIN_EVENT
        r.eventText = readBlockUntil('END_EVENT');

        if(i >= lines.length || lines[i].trim() !== 'BEGIN_REMARKS') throw new Error('Missing BEGIN_REMARKS in a row.');
        i++; // BEGIN_REMARKS
        r.remarksText = readBlockUntil('END_REMARKS');

        while(i < lines.length && lines[i].trim() !== 'END_ROW') i++;
        if(i >= lines.length) throw new Error('Missing END_ROW.');
        i++; // END_ROW

        v.rows.push(r);
      }
      if(i >= lines.length) throw new Error('Missing END_ROWS.');
      i++; // END_ROWS

      while(i < lines.length && lines[i].trim() !== 'END_VISIT') i++;
      if(i >= lines.length) throw new Error('Missing END_VISIT.');
      i++; // END_VISIT

      visits.push(v);
    }

    return visits;
  }

  async function importAllTxt(file){
    const reader = new FileReader();
    reader.onload = () => {
      try{
        const parsed = parseTxtImport(String(reader.result || ''));
        if(!Array.isArray(parsed) || !parsed.length) throw new Error('No visits found in file.');
        saveAll(normalizeList(parsed));
        alert('Imported.');
        applyFilters();
      }catch(e){
        alert('Import failed: ' + e.message);
      }
    };
    reader.readAsText(file);
  }

  // --- Hero background: Conway's Game of Life (interactive, autoplay, low opacity)
  function initGameOfLife(){
    const canvas = document.getElementById('lifeCanvas');
    if(!canvas) return;

    const ctx = canvas.getContext('2d', { alpha: true });
    let cell = 10, cols = 0, rows = 0;
    let grid = [], next = [];
    let pointerDown = false;
    let running = true;

    const pauseBtn = document.getElementById('lifePauseBtn');
    const randomBtn = document.getElementById('lifeRandomBtn');
    const clearBtn = document.getElementById('lifeClearBtn');

    function idx(x,y){ return y*cols + x; }

    function randFill(p=0.18){
      for(let y=0; y<rows; y++){
        for(let x=0; x<cols; x++){
          grid[idx(x,y)] = (Math.random() < p) ? 1 : 0;
        }
      }
    }

    function clear(){
      grid.fill(0);
      draw();
    }

    function resize(){
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
      canvas.width  = Math.floor(rect.width * dpr);
      canvas.height = Math.floor(rect.height * dpr);
      ctx.setTransform(dpr,0,0,dpr,0,0);

      cell = Math.max(8, Math.min(14, Math.round(rect.width / 70)));
      cols = Math.max(20, Math.floor(rect.width / cell));
      rows = Math.max(12, Math.floor(rect.height / cell));

      grid = new Array(cols*rows).fill(0);
      next = new Array(cols*rows).fill(0);
      randFill(0.17);
      draw();
    }

    function step(){
      for(let y=0; y<rows; y++){
        for(let x=0; x<cols; x++){
          let n=0;
          for(let dy=-1; dy<=1; dy++){
            for(let dx=-1; dx<=1; dx++){
              if(dx===0 && dy===0) continue;
              const xx = (x + dx + cols) % cols;
              const yy = (y + dy + rows) % rows;
              n += grid[idx(xx,yy)];
            }
          }
          const v = grid[idx(x,y)];
          next[idx(x,y)] = (v && (n===2 || n===3)) || (!v && n===3) ? 1 : 0;
        }
      }
      const tmp = grid; grid = next; next = tmp;
    }

    function draw(){
      const rect = canvas.getBoundingClientRect();
      ctx.clearRect(0,0,rect.width,rect.height);

      const isDark = (document.documentElement.dataset.theme === 'dark');
      ctx.fillStyle = isDark ? 'rgba(147,197,253,0.36)' : 'rgba(191,219,254,0.32)';

      for(let y=0; y<rows; y++){
        for(let x=0; x<cols; x++){
          if(!grid[idx(x,y)]) continue;
          ctx.fillRect(x*cell, y*cell, cell-1, cell-1);
        }
      }
    }

    function setAliveAt(clientX, clientY, alive){
      const r = canvas.getBoundingClientRect();
      const x = Math.floor((clientX - r.left) / cell);
      const y = Math.floor((clientY - r.top) / cell);
      if(x<0 || y<0 || x>=cols || y>=rows) return;
      grid[idx(x,y)] = alive ? 1 : 0;
    }

    canvas.addEventListener('pointerdown', (e)=>{
      pointerDown = true;
      canvas.setPointerCapture(e.pointerId);
      setAliveAt(e.clientX, e.clientY, true);
      draw();
    });
    canvas.addEventListener('pointermove', (e)=>{
      if(!pointerDown) return;
      setAliveAt(e.clientX, e.clientY, true);
      draw();
    });
    canvas.addEventListener('pointerup', ()=>{ pointerDown=false; });
    canvas.addEventListener('pointercancel', ()=>{ pointerDown=false; });

    if(pauseBtn){
      pauseBtn.addEventListener('click', () => {
        running = !running;
        pauseBtn.textContent = running ? '⏸️' : '▶️';
      });
    }
    if(randomBtn){
      randomBtn.addEventListener('click', () => { randFill(0.18); draw(); });
    }
    if(clearBtn){
      clearBtn.addEventListener('click', () => clear());
    }

    // theme changes should re-render with new alpha
    window.addEventListener('aavartan:theme', draw);

    resize();
    window.addEventListener('resize', resize, { passive:true });

    let last = 0;
    function loop(t){
      if(running && (t - last > 55)){
        step();
        draw();
        last = t;
      }
      requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);
  }

  async function wire(){
    if(todayBadge) todayBadge.textContent = formatToday();

    // Dependencies checklist is shown automatically on first run (landing page).
    secure.get(DEPS_SEEN).then(v=>{ if(!v) setTimeout(() => showDepsChecklist(true), 450); }).catch(()=>{});

    if(applyBtn) applyBtn.addEventListener('click', ()=> applyFilters());
    if(resetBtn) resetBtn.addEventListener('click', ()=> reset());

    if(exportTxtBtn) exportTxtBtn.addEventListener('click', ()=> exportAllTxt());
    if(importTxtFile) importTxtFile.addEventListener('change', (e) => {
      if(e.target.files && e.target.files[0]) importAllTxt(e.target.files[0]);
      e.target.value = '';
    });

    if(closeDetailBtn) closeDetailBtn.addEventListener('click', ()=> closeInline());

    // Open from hash
    const m = (location.hash || '').match(/open=([^&]+)/);
    if(m && m[1]) openVisit(decodeURIComponent(m[1]));

    initGameOfLife();
    applyFilters();
  }

  document.addEventListener('DOMContentLoaded', wire);
})();