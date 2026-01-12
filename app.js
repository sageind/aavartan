
/* AAVARTAN — VIP Itinerary Planner (offline-first)
   PDF export uses jsPDF + AutoTable. Default PDF font is Helvetica (closest to Arial). For strict Arial, embed Arial TTF offline.
*/

(async () => {
  'use strict';

  if(!window.AAVARTAN_SECURE){
    await new Promise(res => window.addEventListener('aavartan:secure-ready', ()=>res(), { once:true }));
  }

  const secure = window.AAVARTAN_SECURE;
  if(!secure) return;

  const STORE_KEY = 'aavartan_visits_v2';
  const ACTIVE_KEY = 'aavartan_active_visit_id';
  const DEPS_SEEN = 'aavartan_deps_seen_v1';

  const el = (id) => document.getElementById(id);

  const todayBadge = el('todayBadge');
  const generatedHeader = el('generatedHeader');
  const rowsTbody = el('rowsTbody');
  const rowCountBadge = el('rowCountBadge');

  const depsBtn = el('depsBtn');
  const depsModalEl = el('depsModal');
  const depsBody = el('depsBody');

  // Visit header fields
  const eventName = el('eventName');
  const vipTitle = el('vipTitle');
  const vipFirst = el('vipFirst');
  const vipLast = el('vipLast');
  const vipAwards = el('vipAwards');
  const vipDesig = el('vipDesig');
  const stationName = el('stationName');
  const visitFrom = el('visitFrom');
  const visitTo = el('visitTo');

  // Row fields
  const rowDate = el('rowDate');
  const rowStart = el('rowStart');
  const rowTimeStyle = el('rowTimeStyle');
  const rowMinutes = el('rowMinutes');
  const applyMinutesBtn = el('applyMinutesBtn');
  const rowEvent = el('rowEvent');
  const rowRemarks = el('rowRemarks');
  const rowHint = el('rowHint');

  // Buttons
  const addRowBtn = el('addRowBtn');
  const updateRowBtn = el('updateRowBtn');
  const cancelEditBtn = el('cancelEditBtn');

  // Bottom bar
  const newVisitBtn = el('newVisitBtn');
  const saveVisitBtn = el('saveVisitBtn');
  const loadVisitBtn = el('loadVisitBtn');
  const pdfA4Btn = el('pdfA4Btn');
  const docxBtn = el('docxBtn');
  const pdfPocketBtn = el('pdfPocketBtn');

  const exportA4TopBtn = el('exportA4TopBtn');
  const exportDocxTopBtn = el("exportDocxTopBtn");
  const readOnlyBanner = el('readOnlyBanner');

  // Load modal elements
  const loadModalEl = el('loadModal');
  const loadPreview = el('loadPreview');
  const loadPrevBtn = el('loadPrevBtn');
  const loadNextBtn = el('loadNextBtn');
  const loadConfirmBtn = el('loadConfirmBtn');

  // --- External deps checklist
  const EXTERNAL_DEPS = [
    { name: 'Bootstrap CSS', url: 'https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css' },
    { name: 'Bootstrap JS Bundle', url: 'https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/js/bootstrap.bundle.min.js' },
    { name: 'Flatpickr CSS', url: 'https://cdn.jsdelivr.net/npm/flatpickr/dist/flatpickr.min.css' },
    { name: 'Flatpickr JS', url: 'https://cdn.jsdelivr.net/npm/flatpickr' },
    { name: 'jsPDF', url: 'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js' },
    { name: 'jsPDF AutoTable', url: 'https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.3/dist/jspdf.plugin.autotable.min.js' }
  ];

  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  }

  function showDepsChecklist(auto = false) {
    const html = `
      <div class="small text-muted mb-2">
        The files are bundled ⚡ for full offline use. Download the Zip from the project page for offline use.
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
    if (auto) secure.set(DEPS_SEEN, '1').catch(()=>{});
  }

  // --- Storage
  let visits = await loadStore();
  let activeVisitId = (await secure.get(ACTIVE_KEY)) || null;
  // Draft visit exists only in-memory until the user performs an explicit save/export or adds rows.
  // This prevents blank visits from being auto-added during offline testing.
  let draftVisit = null;
  let editingRowId = null;


  // When opened from Visits Conducted (embedded iframe), the parent page may send the full visit object via postMessage.
  // This is important for file:// deployments where localStorage can be isolated per file.
  let pendingIncomingVisit = null;

  function mergeIncomingVisit(incoming){
    if(!incoming || !incoming.id) return;
    const idx = visits.findIndex(x => x.id === incoming.id);
    if(idx >= 0) visits[idx] = incoming;
    else visits.unshift(incoming);

    activeVisitId = incoming.id;
    try{ secure.set(ACTIVE_KEY, activeVisitId).catch(()=>{}); }catch(e){}
    try{ saveStore().catch(()=>{}); }catch(e){}
  }

  function applyIncomingVisit(incoming){
    mergeIncomingVisit(incoming);
    const v = ensureActiveVisit();
    syncStateToHeader(v);
    reflowAllRows(v);
    setRowDefaultsFromLast(v);
    render();
    applyReadOnlyForCurrent();
  }

  window.addEventListener('message', (e) => {
    const data = e && e.data;
    if(!data || data.type !== 'aavartan:openVisit') return;
    const incoming = data.visit;
    if(incoming && incoming.id){
      pendingIncomingVisit = incoming;
      if(document.readyState !== 'loading'){
        applyIncomingVisit(pendingIncomingVisit);
        pendingIncomingVisit = null;
      }
    }
  });


  async function loadStore() {
    try { return JSON.parse((await secure.get(STORE_KEY)) || '[]'); }
    catch { return []; }
  }
  function saveStore() { return secure.set(STORE_KEY, JSON.stringify(visits)); }
  function uid() { return 'r_' + Math.random().toString(16).slice(2) + Date.now().toString(16); }
  function pad2(n) { return String(n).padStart(2, '0'); }

  // Local YYYY-MM-DD (avoids UTC date drift that can incorrectly mark "today" as "past" in timezones ahead of UTC)
  function localISODate(d){
    const y = d.getFullYear();
    const m = pad2(d.getMonth() + 1);
    const day = pad2(d.getDate());
    return `${y}-${m}-${day}`;
  }

  function ensureActiveVisit() {
    if (draftVisit && draftVisit.id === activeVisitId) return draftVisit;

    const v = visits.find(x => x.id === activeVisitId) || null;
    if (v) return v;

    // No active saved visit: start a new in-memory draft (do not persist yet).
    draftVisit = makeNewVisit();
    activeVisitId = draftVisit.id;
    return draftVisit;
  }

  function commitDraftIfNeeded(v){
    if(!draftVisit || !v || v.id !== draftVisit.id) return;
    // Commit the draft into the saved list exactly once.
    if(!visits.some(x => x && x.id === draftVisit.id)){
      visits.unshift(draftVisit);
    }
    draftVisit = null;
    try{ secure.set(ACTIVE_KEY, activeVisitId).catch(()=>{}); }catch(e){}
  }

  function makeNewVisit() {
    const now = new Date();
    const iso = localISODate(now);
    return {
      id: 'v_' + now.getTime(),
      createdAt: now.toISOString(),
      header: {
        eventName: '',
        vipTitle: '',
        vipFirst: '',
        vipLast: '',
        vipAwards: '',
        vipDesig: '',
        stationName: '',
        visitFrom: iso,
        visitTo: iso
      },
      rows: []
    };
  }

  // --- Dates & time
  function formatToday() {
    const d = new Date();
    const dd = pad2(d.getDate());
    const mon = d.toLocaleString('en-US', { month: 'short' }).toUpperCase();
    const yyyy = d.getFullYear();
    return `${dd} ${mon} ${yyyy}`;
  }

  function toDMS(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr + 'T00:00:00');
    const dd = pad2(d.getDate());
    const mon = d.toLocaleString('en-US', { month: 'short' }).toUpperCase();
    const yy = pad2(d.getFullYear() % 100);
    const dow = d.toLocaleString('en-US', { weekday: 'short' }).toUpperCase();
    return `${dd} ${mon} ${yy} (${dow})`;
  }

  function toDMSShort(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr + 'T00:00:00');
    const dd = pad2(d.getDate());
    const mon = d.toLocaleString('en-US', { month: 'short' }).toUpperCase();
    const yy = pad2(d.getFullYear() % 100);
    return `${dd} ${mon} ${yy}`;
  }

  function minutesFromHHMM(hhmm) {
    if (!hhmm) return null;
    const parts = hhmm.includes(':') ? hhmm.split(':') : [hhmm.slice(0,2), hhmm.slice(2,4)];
    const h = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10);
    if (Number.isNaN(h) || Number.isNaN(m)) return null;
    return h*60 + m;
  }

  function HHMMFromMinutes(total) {
    total = (total % (24*60) + (24*60)) % (24*60);
    const h = Math.floor(total / 60);
    const m = total % 60;
    return `${pad2(h)}${pad2(m)}`;
  }

  function HHMMColonFromMinutes(total) {
    total = (total % (24*60) + (24*60)) % (24*60);
    const h = Math.floor(total / 60);
    const m = total % 60;
    return `${pad2(h)}:${pad2(m)}`;
  }

  function normalizeTimeInput(value) {
    const v = String(value || '').trim();
    if (!v) return '';
    if (v.includes(':')) return v;
    if (/^\d{4}$/.test(v)) return v.slice(0,2) + ':' + v.slice(2);
    return v;
  }

  // --- Parsing Event/Remarks
  function parseEventText(txt) {
    const lines = String(txt || '')
      .split('\n')
      .map(s => String(s).replace(/\s+$/,''))
      .filter(s => String(s).trim().length);

    const heading = (lines[0] || '').trim();
    const body = lines.slice(1).map(s => String(s).trim()).filter(Boolean);
    return { heading, body };
  }

  function parseRemarks(txt) {
    const lines = String(txt || '').split('\n').map(s => String(s).trim()).filter(Boolean);
    const first = (lines[0] || '').trim();
    const rest = lines.slice(1);
    return { first, bullets: rest };
  }

  // --- Title
  function buildTitleLine() {
    const en = (eventName.value || '').trim();
    const t = (vipTitle.value || '').trim();
    const fn = (vipFirst.value || '').trim();
    const ln = (vipLast.value || '').trim();
    const aw = (vipAwards.value || '').trim();
    const des = (vipDesig.value || '').trim();
    const st = (stationName.value || '').trim();
    const vf = visitFrom.value;
    const vt = visitTo.value;

    const namePart = [t, fn, ln].filter(Boolean).join(' ').trim();
    const awardPart = aw ? `, ${aw}` : '';
    const desPart = des ? `, ${des}` : '';
    const visitPart = st ? `VISIT TO ${st}` : 'VISIT';
    const datePart = (vf && vt) ? `(${toDMSShort(vf)} - ${toDMSShort(vt)})` : '';
    const pieces = [en, (namePart + awardPart + desPart).trim(), `${visitPart} ${datePart}`.trim()].filter(s => String(s).trim().length);
    return pieces.join(' ').replace(/\s+/g,' ').trim().toUpperCase();
  }

  function buildTitleLineFromHeader(h) {
    const en = (h.eventName || '').trim();
    const namePart = [h.vipTitle, h.vipFirst, h.vipLast].filter(Boolean).join(' ').trim();
    const awardPart = h.vipAwards ? `, ${h.vipAwards}` : '';
    const desPart = h.vipDesig ? `, ${h.vipDesig}` : '';
    const visitPart = h.stationName ? `VISIT TO ${h.stationName}` : 'VISIT';
    const datePart = (h.visitFrom && h.visitTo) ? `(${toDMSShort(h.visitFrom)} - ${toDMSShort(h.visitTo)})` : '';
    const pieces = [en, (namePart + awardPart + desPart).trim(), `${visitPart} ${datePart}`.trim()].filter(s => String(s).trim().length);
    return pieces.join(' ').replace(/\s+/g,' ').trim().toUpperCase();
  }

  // --- Time display per spec
  function timeDisplay(row) {
    const startMin = minutesFromHHMM(row.start);
    const startHHMM = (startMin == null) ? '' : HHMMFromMinutes(startMin);

    if (row.style === 'onwards') return `${startHHMM}h onwards`;
    if (row.style === 'instant') return `${startHHMM}h`;

    const mins = Number(row.minutes || 0);
    const endHHMM = HHMMFromMinutes(startMin + mins);
    return `${startHHMM} - ${endHHMM}h (${mins} min)`;
  }

  
  // --- Export time display (PDF/DOCX): two-line format for duration rows
  function timeDisplayExport(row){
    const startMin = minutesFromHHMM(row.start);
    const startHHMM = (startMin == null) ? '' : HHMMFromMinutes(startMin);

    if (row.style === 'onwards') return `${startHHMM}h onwards`;
    if (row.style === 'instant') return `${startHHMM}h`;

    const mins = Number(row.minutes || 0);
    const endHHMM = HHMMFromMinutes((startMin == null ? 0 : startMin) + mins);
    const line1 = `${startHHMM}-${endHHMM}h`;
    const line2 = `(${mins} min)`;
    return `${line1}\n${line2}`;
  }

  function timeLinesExport(row){
    const s = timeDisplayExport(row).split('\n');
    return { line1: s[0] || '', line2: s[1] || '' };
  }

function computedEndMinutes(row) {
    const s = minutesFromHHMM(row.start);
    if (s == null) return null;
    if (row.style !== 'duration') return s;
    return s + Number(row.minutes || 0);
  }

  function sortRows(rows) {
    return rows.slice().sort((a,b) => {
      const da = a.date || '';
      const db = b.date || '';
      if (da < db) return -1;
      if (da > db) return 1;
      return (a.createdAt || '').localeCompare(b.createdAt || '');
    });
  }

  function reflowAllRows(v) {
    const rows = sortRows(v.rows || []);
    const byDate = {};
    rows.forEach(r => { (byDate[r.date] ||= []).push(r); });

    Object.keys(byDate).sort().forEach(date => {
      const list = byDate[date];
      for (let i=1; i<list.length; i++) {
        const prevEnd = computedEndMinutes(list[i-1]);
        if (prevEnd == null) continue;
        list[i].start = HHMMColonFromMinutes(prevEnd);
      }
    });
    v.rows = rows;
  }

  function shiftFromIndex(v, date, idxInDate, delta) {
    const rows = sortRows(v.rows || []);
    const dateRows = rows.filter(r => r.date === date);
    for (let i=idxInDate; i<dateRows.length; i++) {
      const r = dateRows[i];
      const m = minutesFromHHMM(r.start);
      if (m == null) continue;
      r.start = HHMMColonFromMinutes(m + delta);
    }
    v.rows = rows;
  }

  // --- Header sync
  function syncHeaderToState(v) {
    v.header.eventName = eventName.value || '';
    v.header.vipTitle = vipTitle.value || '';
    v.header.vipFirst = vipFirst.value || '';
    v.header.vipLast = vipLast.value || '';
    v.header.vipAwards = vipAwards.value || '';
    v.header.vipDesig = vipDesig.value || '';
    v.header.stationName = stationName.value || '';
    v.header.visitFrom = visitFrom.value || '';
    v.header.visitTo = visitTo.value || '';
  }

  function syncStateToHeader(v) {
    eventName.value = v.header.eventName || '';
    vipTitle.value = v.header.vipTitle || '';
    vipFirst.value = v.header.vipFirst || '';
    vipLast.value = v.header.vipLast || '';
    vipAwards.value = v.header.vipAwards || '';
    vipDesig.value = v.header.vipDesig || '';
    stationName.value = v.header.stationName || '';
    visitFrom.value = v.header.visitFrom || '';
    visitTo.value = v.header.visitTo || '';
  }

  function setRowDefaultsFromLast(v) {
    const rows = sortRows(v.rows || []);
    const last = rows[rows.length - 1] || null;
    const d = (last && last.date) || visitFrom.value || new Date().toISOString().slice(0,10);
    rowDate.value = d;

    const sameDateLast = (last && last.date === d) ? last : null;
    if (sameDateLast) {
      const endMin = computedEndMinutes(sameDateLast);
      rowStart.value = (endMin != null) ? HHMMColonFromMinutes(endMin) : (sameDateLast.start || '');
    } else {
      rowStart.value = '09:00';
    }

    rowTimeStyle.value = 'duration';
    rowMinutes.value = '';
    rowEvent.value = '';
    rowRemarks.value = '';
    rowHint.textContent = `Next slot: ${rowStart.value || ''}`;
  }

  // --- CRUD rows
  function startEditRow(v, rowId) {
    const r = (v.rows || []).find(x => x.id === rowId);
    if (!r) return;
    editingRowId = rowId;

    rowDate.value = r.date || '';
    rowStart.value = normalizeTimeInput(r.start || '');
    rowTimeStyle.value = r.style || 'duration';
    rowMinutes.value = (r.minutes ?? '');
    rowEvent.value = r.eventText || '';
    rowRemarks.value = r.remarksText || '';

    addRowBtn.disabled = true;
    updateRowBtn.disabled = false;
    cancelEditBtn.disabled = false;

    // UX: bring the form into view and make it obvious that edit-mode is active.
    try{
      rowHint.textContent = `Editing row…`;
      const card = document.querySelector('.form-card');
      if(card){
        card.scrollIntoView({ behavior: 'smooth', block: 'start' });
        card.classList.add('flash-outline');
        setTimeout(() => card.classList.remove('flash-outline'), 900);
      }
      setTimeout(() => { try{ rowEvent.focus(); }catch(e){} }, 350);
    }catch(e){}
  }

  function cancelEdit() {
    editingRowId = null;
    addRowBtn.disabled = false;
    updateRowBtn.disabled = true;
    cancelEditBtn.disabled = true;
    setRowDefaultsFromLast(ensureActiveVisit());
  }

  function addRow(v) {
    const d = rowDate.value;
    const s = normalizeTimeInput(rowStart.value);
    if (!d || !s) { alert('Please select Date and Start Time (24h).'); return; }

    const style = rowTimeStyle.value;
    const mins = Number(rowMinutes.value || 0);

    v.rows.push({
      id: uid(),
      createdAt: new Date().toISOString(),
      date: d,
      start: s,
      style,
      minutes: (style === 'duration') ? mins : 0,
      eventText: rowEvent.value || '',
      remarksText: rowRemarks.value || ''
    });

    reflowAllRows(v);
    // Persist the draft on first meaningful content.
    commitDraftIfNeeded(v);
    saveStore().catch(()=>{});
    render();
    setRowDefaultsFromLast(v);
  }

  function updateRow(v) {
    if (!editingRowId) return;
    const r = (v.rows || []).find(x => x.id === editingRowId);
    if (!r) return;

    r.date = rowDate.value;
    r.start = normalizeTimeInput(rowStart.value);
    r.style = rowTimeStyle.value;
    r.minutes = (r.style === 'duration') ? Number(rowMinutes.value || 0) : 0;
    r.eventText = rowEvent.value || '';
    r.remarksText = rowRemarks.value || '';

    reflowAllRows(v);
    commitDraftIfNeeded(v);
    saveStore().catch(()=>{});
    cancelEdit();
    render();
    applyReadOnlyForCurrent();
  }

  function deleteRow(v, rowId) {
    const idx = (v.rows || []).findIndex(x => x.id === rowId);
    if (idx === -1) return;
    v.rows.splice(idx, 1);
    reflowAllRows(v);
    commitDraftIfNeeded(v);
    saveStore().catch(()=>{});
    render();
    applyReadOnlyForCurrent();
  }

  function adjustDuration(v, rowId, deltaMinutes) {
    const rows = sortRows(v.rows || []);
    const r = rows.find(x => x.id === rowId);
    if (!r) return;

    if (r.style !== 'duration') {
      r.style = 'duration';
      r.minutes = Math.max(0, Number(r.minutes || 0));
    }

    const before = Number(r.minutes || 0);
    const after = Math.max(0, before + deltaMinutes);
    const delta = after - before;
    r.minutes = after;

    const dateRows = rows.filter(x => x.date === r.date);
    const idxInDate = dateRows.findIndex(x => x.id === rowId);
    if (idxInDate !== -1 && delta !== 0) shiftFromIndex(v, r.date, idxInDate + 1, delta);

    reflowAllRows(v);
    commitDraftIfNeeded(v);
    saveStore().catch(()=>{});
    render();
    applyReadOnlyForCurrent();
  }

  // --- Visit actions
  function newVisit() {
    draftVisit = makeNewVisit();
    activeVisitId = draftVisit.id;
    syncStateToHeader(draftVisit);
    setRowDefaultsFromLast(draftVisit);
    render();
    applyReadOnlyForCurrent();
  }

  function saveVisit() {
    const v = ensureActiveVisit();
    if (document.body.dataset.locked === '1') return notifyLocked();

    // Saving commits any in-memory draft.
    commitDraftIfNeeded(v);
    syncHeaderToState(v);
    reflowAllRows(v);
    saveStore().catch(()=>{});
    try{ secure.set(ACTIVE_KEY, activeVisitId).catch(()=>{}); }catch(e){}
    alert('Saved.');
  }

  function loadVisit() {
    // Loading visits is only supported when the Load modal exists (removed from Visit Programme pages)
    if(!loadModalEl) return;

    if (!visits.length) { alert('No saved visits found.'); return; }
    if (!window.bootstrap || !loadModalEl) {
      // fallback prompt (should not happen)
      const list = visits.map((v, i) => {
        const title = buildTitleLineFromHeader(v.header) || `VISIT ${i+1}`;
        const date = (v.header.visitFrom && v.header.visitTo) ? `${toDMSShort(v.header.visitFrom)}–${toDMSShort(v.header.visitTo)}` : '';
        return `${i+1}. ${title} ${date ? '('+date+')' : ''}`.trim();
      }).join('\n');
      const pick = prompt('Select a visit number:\n\n' + list);
      const n = parseInt(pick, 10);
      if (!n || n < 1 || n > visits.length) return;
      activeVisitId = visits[n-1].id;
      secure.set(ACTIVE_KEY, activeVisitId).catch(()=>{});
      const v = ensureActiveVisit();
      syncStateToHeader(v);
      reflowAllRows(v);
      setRowDefaultsFromLast(v);
      render();
      applyReadOnlyForCurrent();
      return;
    }

    // Modal picker
    const modal = new bootstrap.Modal(loadModalEl);

    let idx = Math.max(0, visits.findIndex(x => x.id === activeVisitId));
    if (idx < 0) idx = 0;

    function renderPreview(){
      const v = visits[idx];
      const title = buildTitleLineFromHeader(v.header) || `VISIT ${idx+1}`;
      const date = (v.header.visitFrom && v.header.visitTo) ? `${toDMSShort(v.header.visitFrom)} – ${toDMSShort(v.header.visitTo)}` : '';
      const created = v.createdAt ? new Date(v.createdAt).toLocaleString(undefined, { year:'2-digit', month:'short', day:'2-digit', hour:'2-digit', minute:'2-digit' }).toUpperCase() : '—';

      if(loadPreview){
        loadPreview.innerHTML = `
          <div class="d-flex justify-content-between align-items-start gap-2">
            <div class="fw-bold">#${idx+1}</div>
            <div class="text-muted small">${escapeHtml(created)}</div>
          </div>
          <div class="mt-2 fw-bold">${escapeHtml(title)}</div>
          <div class="mt-1 small text-muted">${escapeHtml(date)}</div>
        `;
      }
    }

    function prev(){ idx = (idx - 1 + visits.length) % visits.length; renderPreview(); }
    function next(){ idx = (idx + 1) % visits.length; renderPreview(); }

    if(loadPrevBtn) loadPrevBtn.onclick = prev;
    if(loadNextBtn) loadNextBtn.onclick = next;

    if(loadConfirmBtn){
      loadConfirmBtn.onclick = () => {
        activeVisitId = visits[idx].id;
        secure.set(ACTIVE_KEY, activeVisitId).catch(()=>{});

        const v = ensureActiveVisit();
        syncStateToHeader(v);
        reflowAllRows(v);
        setRowDefaultsFromLast(v);
        render();
        applyReadOnlyForCurrent();

        modal.hide();
      };
    }

    renderPreview();
    modal.show();
  }

  // --- Render
  function render() {
    const v = ensureActiveVisit();
    generatedHeader.textContent = buildTitleLine();

    const rows = sortRows(v.rows || []);
    rowCountBadge.textContent = `${rows.length} items`;

    rowsTbody.innerHTML = '';
    let currentDate = null;
    let ser = 0;

    rows.forEach(r => {
      if (r.date !== currentDate) {
        currentDate = r.date;
        const trD = document.createElement('tr');
        trD.className = 'date-row';
        const td = document.createElement('td');
        td.colSpan = 5;
        td.textContent = toDMS(currentDate);
        trD.appendChild(td);
        rowsTbody.appendChild(trD);
      }

      ser += 1;
      const tr = document.createElement('tr');

      const tdSer = document.createElement('td');
      tdSer.textContent = ser;
      tdSer.style.textAlign = 'center';

      const tdTime = document.createElement('td');
      tdTime.textContent = timeDisplay(r);
      tdTime.style.whiteSpace = 'nowrap';
      tdTime.style.textAlign = 'center';

      const ev = parseEventText(r.eventText);
      const tdEvent = document.createElement('td');
      tdEvent.style.textAlign = 'left';
      tdEvent.innerHTML = `
        <div style="font-weight:700; font-size:12px; line-height:1.25;">${escapeHtml(ev.heading || '')}</div>
        ${ev.body.length ? `<div style="font-weight:400; font-size:12px; line-height:1.25; white-space:pre-line;">${escapeHtml(ev.body.join('\n'))}</div>` : ``}
      `;

      const rm = parseRemarks(r.remarksText);
      const tdRem = document.createElement('td');
      const items = [];
      if (rm.first) items.push({ text: rm.first, bold: true });
      rm.bullets.forEach(b => items.push({ text: b, bold: false }));
      const bullets = items.length
        ? `<ul style="margin: .25rem 0 0 1.1rem; padding:0; list-style-type: circle; font-size:12px; line-height:1.25;">
             ${items.map(it => `<li style="font-weight:${it.bold ? 700 : 400};">${escapeHtml(it.text)}</li>`).join('')}
           </ul>`
        : '';
      tdRem.innerHTML = bullets;

      const tdCtl = document.createElement('td');
      tdCtl.className = 'no-pdf text-end';
      const locked = (document.body.dataset.locked === '1');
      if(locked){
        tdCtl.innerHTML = `<div class="small text-muted">Locked</div>`;
      }else{
        tdCtl.innerHTML = `
        <div class="d-flex flex-wrap gap-1 justify-content-end align-items-center">
          <div class="input-group input-group-sm" style="width: 140px;">
            <button class="btn btn-outline-danger" type="button" data-act="m" title="Decrement by step">−</button>
            <input type="number" class="form-control text-center adj-step" value="5" min="1" step="1" aria-label="Minutes step">
            <button class="btn btn-outline-success" type="button" data-act="p" title="Increment by step">+</button>
          </div>
          <button class="btn btn-sm btn-outline-primary" type="button" data-act="edit">Edit</button>
          <button class="btn btn-sm btn-outline-danger" type="button" data-act="del">Del</button>
        </div>
      `;
      }
      tdCtl.addEventListener('click', (e) => {
        const btn = e.target.closest('button');
        if (!btn) return;
        const act = btn.getAttribute('data-act');
        if (document.body.dataset.locked === '1') return notifyLocked();
        if (act === 'edit') return startEditRow(v, r.id);
        if (act === 'del') return deleteRow(v, r.id);

        if (act === 'm' || act === 'p') {
          const stepEl = tdCtl.querySelector('.adj-step');
          const raw = stepEl ? parseInt(stepEl.value, 10) : 5;
          const step = Number.isFinite(raw) && raw > 0 ? raw : 5;
          if (document.body.dataset.locked === '1') return notifyLocked();
          adjustDuration(v, r.id, act === 'm' ? -step : +step);
        }
      });

      tr.appendChild(tdSer);
      tr.appendChild(tdTime);
      tr.appendChild(tdEvent);
      tr.appendChild(tdRem);
      tr.appendChild(tdCtl);

      rowsTbody.appendChild(tr);
    });
  }

  // --- PDF Export (title + table only)
  async function exportPdf(kind) {
    const v = ensureActiveVisit();
    syncHeaderToState(v);
    reflowAllRows(v);

    // Require password for export
    if(false && window.AAVARTAN_AUTH && typeof window.AAVARTAN_AUTH.requirePassword === 'function'){
      const ok = await window.AAVARTAN_AUTH.requirePassword('Export PDF');
      if(!ok) return;
    }

    const title = buildTitleLineFromHeader(v.header);
    const rows = sortRows(v.rows || []);
    if (!rows.length) { alert('No rows to export.'); return; }

    // Commit + persist only when there is exportable content.
    commitDraftIfNeeded(v);
    saveStore().catch(()=>{});

    if (!window.jspdf || !window.jspdf.jsPDF) {
      alert('PDF libraries not loaded. Download the ⚡ libraries for offline use.');
      return;
    }
    const { jsPDF } = window.jspdf;

    const isPocket = (kind === 'pocket');
    const scale = isPocket ? 0.85 : 1.0;
    const doc = isPocket
      ? new jsPDF({ orientation: 'landscape', unit: 'pt', format: [8*72, 5*72] })
      : new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });

    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const marginX = 36;

    // Title (bold 12 + underline, centered)
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12 * scale);
    const titleLines = doc.splitTextToSize(title, pageW - marginX*2);
    // Keep clear of the RESTRICTED header, but avoid excessive top whitespace.
    let y = 70 * scale;
    titleLines.forEach((ln) => {
      const w = doc.getTextWidth(ln);
      const x = (pageW - w) / 2;
      doc.text(ln, x, y);
      doc.setLineWidth(0.6);
      doc.line(x, y + 2, x + w, y + 2);
      y += 14 * scale;
    });
    y += 6 * scale;

    // Build body with date separator rows (max 7 lines per row for readability)
    const body = [];
    const MAX_LINES_PER_ROW = 7;
    let currentDate = null;
    let ser = 0;

    // Conservative width estimate so pre-wrapped lines never overflow real cells.
    const tableAvailW = pageW - (marginX * 2);
    const col0W = 54;
    const col1W = 118;
    const remainderW = Math.max(140, tableAvailW - col0W - col1W);
    const estTextW = Math.max(140, (remainderW / 2) - (14 * scale));

    function segmentsToStyledLines(docRef, segs, maxW) {
      const out = [];
      (segs || []).forEach(seg => {
        const t = (seg && typeof seg.text === "string") ? seg.text : (seg && seg.text != null ? String(seg.text) : "");
        if (!t || !t.trim()) return;
        const style = (seg.style === "bold") ? "bold" : "normal";
        docRef.setFont("helvetica", style);
        const lines = docRef.splitTextToSize(t, maxW);
        (lines || []).forEach(ln => out.push({ text: ln, style }));
      });
      docRef.setFont("helvetica", "normal");
      return out;
    }

    function chunkLines(lines, maxLines) {
      if (!lines || !lines.length) return [[]];
      const chunks = [];
      for (let i = 0; i < lines.length; i += maxLines) {
        chunks.push(lines.slice(i, i + maxLines));
      }
      return chunks;
    }

    rows.forEach(r => {
      if (r.date !== currentDate) {
        currentDate = r.date;
        body.push([{ content: toDMS(currentDate), colSpan: 4, styles: { fontStyle: 'bold', fillColor: [245,245,245], textColor: [0,0,0], halign: 'left', cellPadding: 4 * scale, lineWidth: 0.8 } }]);
      }
      ser += 1;

      const ev = parseEventText(r.eventText);
      const rm = parseRemarks(r.remarksText);

      // Build styled segments: only first line/bullet bold
      const evSegments = [];
      if (ev.heading) evSegments.push({ text: ev.heading, style: 'bold' });
      if (ev.body.length) ev.body.forEach((line) => evSegments.push({ text: line, style: 'normal' }));

      const rmSegments = [];
      if (rm.first) rmSegments.push({ text: `• ${rm.first}`, style: 'bold' });
      if (rm.bullets.length) rm.bullets.forEach((line) => rmSegments.push({ text: `• ${line}`, style: 'normal' }));

      // Pre-wrap and chunk to cap row height to MAX_LINES_PER_ROW lines
      const evLines = segmentsToStyledLines(doc, evSegments, estTextW);
      const rmLines = segmentsToStyledLines(doc, rmSegments, estTextW);
      const evChunks = chunkLines(evLines, MAX_LINES_PER_ROW);
      const rmChunks = chunkLines(rmLines, MAX_LINES_PER_ROW);

      const n = Math.max(evChunks.length, rmChunks.length);
      for (let i = 0; i < n; i++) {
        const isFirst = (i === 0);
        const eChunk = evChunks[i] || [];
        const rChunk = rmChunks[i] || [];

        body.push([
          { content: isFirst ? String(ser) : '' },
          { content: isFirst ? timeDisplayExport(r) : '' },
          { content: eChunk.map(x => x.text).join('\n'), _meta: { type: 'styledLines', lines: eChunk } },
          { content: rChunk.map(x => x.text).join('\n'), _meta: { type: 'styledLines', lines: rChunk } }
        ]);
      }
    });

    // Table (Arial 11 equivalent -> Helvetica 11)
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(12 * scale);

    function computeStyledLineCount(docRef, segs, maxW, fontSize, lineHeightFactor){
      let n = 0;
      (segs || []).forEach(seg => {
        const t = (seg && typeof seg.text === "string") ? seg.text : (seg && seg.text != null ? String(seg.text) : "");
        // Skip empty segments to avoid artificial blank lines / extra row height.
        if(!t || !t.trim()) return;
        const style = (seg.style === 'bold') ? 'bold' : 'normal';
        docRef.setFont('helvetica', style);
        const lines = docRef.splitTextToSize(t, maxW);
        n += Math.max(1, (lines || []).length);
      });
      docRef.setFont('helvetica', 'normal');
      return n;
    }

    doc.autoTable({
      startY: y,
      // Keep table clear of the RESTRICTED header/footer on every page.
      // Reduce header/footer reserved space (~40%) while keeping content clear of stamps.
      margin: { top: 62 * scale, bottom: 44 * scale, left: marginX, right: marginX },
      showHead: 'everyPage',
      rowPageBreak: 'avoid',
      styles: { fontSize: 11 * scale, overflow: 'linebreak', cellWidth: 'wrap', valign: 'top', lineHeightFactor: 1.15, cellPadding: 4 * scale },
      didParseCell: function(data) {
        const raw = data.cell && data.cell.raw;
        if (data.section === 'body' && raw && raw._meta && raw._meta.type === 'styledLines') {
          // Hide default text; we'll custom-draw with mixed bold/normal
          data.cell.styles.textColor = [255, 255, 255];

          // Height is driven by our pre-wrapped line list (capped to MAX_LINES_PER_ROW).
          try{
            const cell = data.cell;
            const basePad = (cell.styles && typeof cell.styles.cellPadding === 'number') ? cell.styles.cellPadding : (4 * scale);
            const padT = (typeof cell.padding === 'function') ? cell.padding('top') : basePad;
            const padB = (typeof cell.padding === 'function') ? cell.padding('bottom') : basePad;
            const fontSize = (cell.styles && cell.styles.fontSize) ? cell.styles.fontSize : (11 * scale);
            const lhf = (cell.styles && cell.styles.lineHeightFactor) ? cell.styles.lineHeightFactor : 1.15;
            const lineH = fontSize * lhf;

            const lines = raw._meta.lines || [];
            const lineCount = Math.max(1, lines.length);
            const needed = padT + padB + (lineCount * lineH);
            data.cell.styles.minCellHeight = Math.max(data.cell.styles.minCellHeight || 0, needed);
          }catch(e){}
        }
      },
      didDrawCell: function(data) {
        const raw = data.cell && data.cell.raw;
        if (data.section !== 'body' || !raw || !raw._meta || raw._meta.type !== 'styledLines') return;

        const lines = raw._meta.lines || [];
        const doc = data.doc;
        const cell = data.cell;

        const basePad = (cell.styles && typeof cell.styles.cellPadding === 'number') ? cell.styles.cellPadding : (4 * scale);
        const padL = (typeof cell.padding === 'function') ? cell.padding('left') : basePad;
        const padR = (typeof cell.padding === 'function') ? cell.padding('right') : basePad;
        const padT = (typeof cell.padding === 'function') ? cell.padding('top') : basePad;
        const padB = (typeof cell.padding === 'function') ? cell.padding('bottom') : basePad;
        const fontSize = (cell.styles && cell.styles.fontSize) ? cell.styles.fontSize : (11 * scale);
        const lhf = (cell.styles && cell.styles.lineHeightFactor) ? cell.styles.lineHeightFactor : 1.15;
        const lineH = fontSize * lhf;

        let x = cell.x + padL;
        let y = cell.y + padT + fontSize * 0.90;
        const yMax = cell.y + cell.height - padB;

        doc.setTextColor(0, 0, 0);

        (lines || []).forEach(ln => {
          if (!ln || !ln.text || !String(ln.text).trim()) { return; }
          const style = (ln.style === 'bold') ? 'bold' : 'normal';
          doc.setFont('helvetica', style);
          if (y < yMax) doc.text(String(ln.text), x, y);
          y += lineH;
        });

        doc.setFont('helvetica', 'normal');
      },
      head: [['Ser No.', 'Time', 'Event', 'Remarks']],
      body,
      theme: 'grid',
      styles: {
        font: 'helvetica',
        fontSize: 11 * scale,
        lineHeightFactor: 1.15,
        cellPadding: 4 * scale,
        lineWidth: 0.8,
        lineColor: [0,0,0],
        textColor: [0,0,0]
      },
      headStyles: {
        fontStyle: 'bold',
        fillColor: [255,255,255],
        textColor: [0,0,0],
        lineWidth: 0.8,
        lineColor: [0,0,0]
      },
      columnStyles: {
        // Fix the narrow columns, let Event/Remarks share remaining width.
        0: { halign: 'center', cellWidth: 54 },
        1: { halign: 'center', cellWidth: 118 },
        2: { halign: 'left', cellWidth: 'auto' },
        3: { halign: 'left', cellWidth: 'auto' }
      }
    });

    // Add RESTRICTED + page numbers (top only)
    const pageCount = doc.getNumberOfPages();
    for (let p=1; p<=pageCount; p++) {
      doc.setPage(p);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8 * scale);

      const word = 'RESTRICTED';
      const w = doc.getTextWidth(word);
      // Give more vertical air so the header/footer doesn't crowd content.
      const topY = 28;
      const bottomY = pageH - 22;

      doc.text(word, (pageW - w)/2, topY);
      doc.setLineWidth(0.6);
      doc.line((pageW - w)/2, topY + 2, (pageW + w)/2, topY + 2);

      const pn = String(p);
      const pnW = doc.getTextWidth(pn);
      // Page number centered above RESTRICTED (no "Page" prefix)
      doc.text(pn, (pageW - pnW)/2, topY - 14);

      doc.text(word, (pageW - w)/2, bottomY);
      doc.line((pageW - w)/2, bottomY + 2, (pageW + w)/2, bottomY + 2);
    }

    const fname = (title || 'AAVARTAN').replace(/[^A-Z0-9]+/g,'_').slice(0,40);
    doc.save(`${fname}_${isPocket ? '8x5' : 'A4'}.pdf`);
  }

  // --- DOCX Export (title + table) ------------------------------------------------
  async function exportDocx(){
    const v = ensureActiveVisit();
    syncHeaderToState(v);
    reflowAllRows(v);

    // Require password for export
    if(false && window.AAVARTAN_AUTH && typeof window.AAVARTAN_AUTH.requirePassword === 'function'){
      const ok = await window.AAVARTAN_AUTH.requirePassword('Export DOCX');
      if(!ok) return;
    }

    const title = buildTitleLineFromHeader(v.header);
    const rows = sortRows(v.rows || []);
    if(!rows.length){ alert('No rows to export.'); return; }

    // Commit + persist only when there is exportable content.
    commitDraftIfNeeded(v);
    saveStore().catch(()=>{});

    if(!window.docx){
      alert('DOCX library not loaded. Download the \u26A1 libraries for offline use.');
      return;
    }

    const {
      Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
      WidthType, AlignmentType, BorderStyle
    } = window.docx;

    const RUN_FONT = 'Arial';


    function makeTextRuns(lines){
      const runs = [];
      (lines || []).forEach((ln, idx)=>{
        const t = String(ln || '');
        if(!t) return;
        if(idx === 0){
          runs.push(new TextRun({ text: t, bold: true, font: RUN_FONT }));
        } else {
          runs.push(new TextRun({ text: t, break: 1, font: RUN_FONT }));
        }
      });
      return runs.length ? runs : [new TextRun('')];
    }

    const COL_SER = 10;
    const COL_TIME = 15;
    const COL_EVENT = 37.5;
    const COL_REMARKS = 37.5;

    function cell(children, widthPct, opts){
      const base = {
        children,
        width: (typeof widthPct === 'number')
          ? { size: widthPct, type: WidthType.PERCENTAGE }
          : { size: 1, type: WidthType.AUTO }
      };
      return new TableCell(Object.assign(base, (opts||{})));
    }

    const titlePara = new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 180 },
      children: [new TextRun({ text: title, bold: true, underline: {}, font: RUN_FONT })]
    });

    const headerRow = new TableRow({
      children: [
        cell([new Paragraph({ children:[new TextRun({ text:'Ser No.', bold:true, font: RUN_FONT })], alignment: AlignmentType.CENTER })], COL_SER),
        cell([new Paragraph({ children:[new TextRun({ text:'Time', bold:true, font: RUN_FONT })], alignment: AlignmentType.CENTER })], COL_TIME),
        cell([new Paragraph({ children:[new TextRun({ text:'Event', bold:true, font: RUN_FONT })] })], COL_EVENT),
        cell([new Paragraph({ children:[new TextRun({ text:'Remarks', bold:true, font: RUN_FONT })] })], COL_REMARKS)
      ]
    });

    const tblRows = [headerRow];
    let currentDate = null;
    let ser = 0;

    rows.forEach(r=>{
      if(r.date !== currentDate){
        currentDate = r.date;
        tblRows.push(new TableRow({
          children: [
            cell([
              new Paragraph({
                children: [new TextRun({ text: toDMS(currentDate), bold: true, font: RUN_FONT })]
              })
            ], null, { columnSpan: 4 })
          ]
        }));
      }
      ser += 1;

      const ev = parseEventText(r.eventText);
      const rm = parseRemarks(r.remarksText);

      const evLines = [];
      if(ev.heading) evLines.push(ev.heading);
      if(ev.body && ev.body.length) ev.body.forEach(x=>evLines.push(x));

      const rmParas = [];
      if(rm.first){
        rmParas.push(new Paragraph({
          bullet: { level: 0 },
          children: [new TextRun({ text: rm.first, bold: true, font: RUN_FONT })]
        }));
      }
      (rm.bullets || []).forEach(b=>{
        rmParas.push(new Paragraph({
          bullet: { level: 0 },
          children: [new TextRun({ text: b, bold: false, font: RUN_FONT })]
        }));
      });
      if(!rmParas.length) rmParas.push(new Paragraph(''));

      tblRows.push(new TableRow({
        children: [
          cell([new Paragraph({ alignment: AlignmentType.CENTER, children:[new TextRun({ text: String(ser), font: RUN_FONT })] })], COL_SER),
          cell([new Paragraph({ alignment: AlignmentType.CENTER, children:[...(() => { const t = timeLinesExport(r); return [new TextRun({ text: t.line1, font: RUN_FONT }), ...(t.line2 ? [new TextRun({ text: t.line2, break: 1, font: RUN_FONT })] : [])]; })()] })], COL_TIME),
          cell([new Paragraph({ children: makeTextRuns(evLines) })], COL_EVENT),
          cell(rmParas, COL_REMARKS)
        ]
      }));
    });

    const borders = {
      top: { style: BorderStyle.SINGLE, size: 1, color: '888888' },
      bottom: { style: BorderStyle.SINGLE, size: 1, color: '888888' },
      left: { style: BorderStyle.SINGLE, size: 1, color: '888888' },
      right: { style: BorderStyle.SINGLE, size: 1, color: '888888' },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: '888888' },
      insideVertical: { style: BorderStyle.SINGLE, size: 1, color: '888888' }
    };

    const table = new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders,
      rows: tblRows
    });

    const doc = new Document({
      styles: {
        default: {
          document: {
            run: { font: RUN_FONT },
          }
        }
      },
      sections: [{
        properties: { page: { margin: { top: 720, right: 720, bottom: 720, left: 720 } } },
        children: [titlePara, table]
      }]
    });

    try{
      const blob = await Packer.toBlob(doc);
      const a = document.createElement('a');
      const from = v.header?.visitFrom || '';
      const to = v.header?.visitTo || '';
      const base = String(v.header?.vipLast || 'visit').replace(/[^a-zA-Z0-9_-]+/g,'_');
      a.download = `Visit_Programme_${base}_${from}_${to}.docx`;
      a.href = URL.createObjectURL(blob);
      document.body.appendChild(a);
      a.click();
      setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); }, 250);
    }catch(e){
      console.error(e);
      alert('DOCX export failed.');
    }
  }

  // --- Time picker
  function bindTimePicker() {
    if (!window.flatpickr) return;
    flatpickr(rowStart, {
      enableTime: true,
      noCalendar: true,
      dateFormat: "H:i",
      time_24hr: true,
      allowInput: true
    });
  }


  function isPastVisit(v){
    const h = (v && v.header) ? v.header : {};
    const endStr = (h.visitTo || h.visitFrom || '').trim();
    if(!endStr) return false;
    const end = new Date(endStr + 'T23:59:59');
    if(Number.isNaN(end.getTime())) return false;
    return end.getTime() < Date.now();
  }

  function notifyLocked(){
    try{
      alert('This visit is in the past and is opened in read-only mode. You can still export.');
    }catch(e){}
  }

  function applyReadOnlyForCurrent(){
    const v = ensureActiveVisit();

    // Edit page (vispgme.html) must remain editable for active/new visits.
    // Read-only rendering is handled on the dedicated view page (vispgme_view.html).
    let locked = false;
    try{
      if(document.body && document.body.dataset && document.body.dataset.view === '1') locked = true;
      if(/vispgme_view\.html$/i.test(location.pathname)) locked = true;
      const qs = new URLSearchParams(location.search);
      if(qs.get('mode') === 'view') locked = true;
    }catch(e){}

    document.body.dataset.locked = locked ? '1' : '0';

    if(readOnlyBanner){
      readOnlyBanner.classList.toggle('d-none', !locked);
    }

    const lockInputs = document.querySelectorAll('input, textarea, select');
    lockInputs.forEach(inp => {
      if(inp.id === 'exportA4TopBtn') return;
      if(inp.closest('.no-lock')) return;
      // keep the load dialog usable
      if(inp.id === 'loadVisitSelect') return;

      if(locked){
        inp.setAttribute('disabled','disabled');
        // preserve placeholder visibility
        if(inp.tagName === 'TEXTAREA') inp.setAttribute('readonly','readonly');
      }else{
        inp.removeAttribute('disabled');
        if(inp.tagName === 'TEXTAREA') inp.removeAttribute('readonly');
      }
    });

    const lockBtns = document.querySelectorAll('button');
    lockBtns.forEach(btn => {
      const id = btn.id || '';
      // Allow exports + load modal + nav/auth buttons in read-only
      const allow = ['pdfA4Btn','docxBtn','pdfPocketBtn','exportA4TopBtn','exportDocxTopBtn','loadVisitBtn','closeInlineBtn','toggleThemeBtn','profileBtn','authSidebarLogout'].includes(id);
      if(locked && !allow){
        btn.setAttribute('disabled','disabled');
      }else if(!locked){
        btn.removeAttribute('disabled');
      }
    });

    if(locked){
      notifyLocked();
    }
  }



  // --- Wire
  function wire() {
    todayBadge.textContent = formatToday();

    // Embedded mode (inline view in Visits Conducted)
    try{
      const qs = new URLSearchParams(location.search);
      if(qs.get('embedded') === '1') document.body.classList.add('embedded');
    }catch(e){}

    if(exportA4TopBtn) exportA4TopBtn.addEventListener('click', () => exportPdf('a4'));
    if(exportDocxTopBtn) exportDocxTopBtn.addEventListener("click", exportDocx);
    bindTimePicker();
    // Load visit via URL hash, e.g. vispgme.html#load=v_123
    const m = (location.hash || '').match(/load=([^&]+)/);
    if (m && m[1]) {
      const wanted = decodeURIComponent(m[1]);
      const exists = visits.find(x => x.id === wanted);
      if (exists) {
        activeVisitId = wanted;
        secure.set(ACTIVE_KEY, activeVisitId).catch(()=>{});
      }
      // Clean URL (keeps page path stable for offline use)
      try { history.replaceState(null, document.title, location.pathname + location.search); } catch (e) {}
    try{
      const qs2 = new URLSearchParams(location.search);
      const isView = (document.body && document.body.dataset && document.body.dataset.view === '1')
                  || /vispgme_view\.html$/i.test(location.pathname)
                  || qs2.get('mode') === 'view';
      const wantsNew = qs2.get('new') === '1';
      const hasLoadHash = /load=/.test(location.hash || '');
      if(wantsNew && !isView && qs2.get('embedded') !== '1' && !hasLoadHash){
        // Start a fresh in-memory draft (behaves like the New button)
        draftVisit = makeNewVisit();
        activeVisitId = draftVisit.id;

        // Remove ?new=1 from the address bar for cleanliness (keeps other params intact)
        qs2.delete('new');
        const s = qs2.toString();
        try { history.replaceState(null, document.title, location.pathname + (s ? ('?' + s) : '') + (location.hash || '')); } catch(e){}
      }
    }catch(e){}

    }

    // Dependencies checklist is shown automatically on first run.
    secure.get(DEPS_SEEN).then(v=>{ if(!v) setTimeout(()=> showDepsChecklist(true), 450); }).catch(()=>{});

    applyMinutesBtn.addEventListener('click', () => {
      if (rowTimeStyle.value !== 'duration') rowTimeStyle.value = 'duration';
      if (!rowMinutes.value) rowMinutes.value = 10;
      rowMinutes.focus();
    });

    addRowBtn.addEventListener('click', () => addRow(ensureActiveVisit()));
    updateRowBtn.addEventListener('click', () => updateRow(ensureActiveVisit()));
    cancelEditBtn.addEventListener('click', cancelEdit);

    newVisitBtn.addEventListener('click', () => { if (confirm('Start a new visit? Current visit remains saved.')) newVisit(); });
    saveVisitBtn.addEventListener('click', saveVisit);
    if(loadVisitBtn) loadVisitBtn.addEventListener('click', loadVisit);

    pdfA4Btn.addEventListener('click', () => exportPdf('a4'));
    if (docxBtn) docxBtn.addEventListener('click', exportDocx);
    if (pdfPocketBtn) pdfPocketBtn.addEventListener('click', () => exportPdf('pocket'));

    [eventName, vipTitle, vipFirst, vipLast, vipAwards, vipDesig, stationName, visitFrom, visitTo]
      .forEach(inp => inp.addEventListener('input', () => { generatedHeader.textContent = buildTitleLine(); }));

    const v = ensureActiveVisit();
    syncStateToHeader(v);
    reflowAllRows(v);
    setRowDefaultsFromLast(v);
    render();
    applyReadOnlyForCurrent();

    // If a visit payload arrived via postMessage before the page finished loading, apply it now.
    if(pendingIncomingVisit){
      applyIncomingVisit(pendingIncomingVisit);
      pendingIncomingVisit = null;
    }
  }

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
  else wire();
})();
