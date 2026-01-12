/* AAVARTAN Auth + Encrypted Storage (admin-only)
   Uses WebCrypto (AES-GCM + PBKDF2). No external crypto library required.
*/

(function(){
  'use strict';

  const ADMIN_ID = 'admin';
  const SESSION_MS = 20 * 60 * 1000;

  // Vault keys (plaintext)
  const K_VAULT_PW = 'aavartan_auth_vault_pw_v1';
  const K_VAULT_RC = 'aavartan_auth_vault_rc_v1';
  const K_INIT = 'aavartan_auth_init_v1';
  const K_DEPS_SEEN = 'aavartan_deps_seen_v1';

  // Session keys (sessionStorage)
  const S_DEK = 'aavartan_s_dek_b64_v1';
  const S_START = 'aavartan_s_start_ms_v1';

  // Prefix for encrypted localStorage values
  const ENC_PREFIX = 'enc1:';

  // Keys that must remain unencrypted in localStorage
  const PLAINTEXT_KEYS = new Set([K_VAULT_PW, K_VAULT_RC, K_INIT, K_DEPS_SEEN]);

  // External libraries used by this app (for offline download checklist on first run)
  const EXTERNAL_DEPS = [
    { name: 'Bootstrap CSS', url: 'https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css' },
    { name: 'Bootstrap JS Bundle', url: 'https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/js/bootstrap.bundle.min.js' },
    { name: 'Flatpickr CSS', url: 'https://cdn.jsdelivr.net/npm/flatpickr/dist/flatpickr.min.css' },
    { name: 'Flatpickr JS', url: 'https://cdn.jsdelivr.net/npm/flatpickr' },
    { name: 'jsPDF', url: 'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js' },
    { name: 'jsPDF AutoTable', url: 'https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.3/dist/jspdf.plugin.autotable.min.js' },
    { name: 'docx (DOCX export)', url: 'https://cdn.jsdelivr.net/npm/docx@8.5.0/build/index.umd.js' },
    { name: 'Three.js', url: 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.min.js' }
  ];

  function escapeHtml(s){
    return String(s || '')
      .replaceAll('&','&amp;')
      .replaceAll('<','&lt;')
      .replaceAll('>','&gt;')
      .replaceAll('"','&quot;')
      .replaceAll("'",'&#39;');
  }

  function renderDepsChecklist(){
    const depsBody = document.getElementById('depsBody');
    if(!depsBody) return;
    depsBody.innerHTML = `
      <div class="small text-muted mb-2">
        Download these \u26A1 files for full offline use. Replace the CDN links in <code>index.html</code> with local paths.
      </div>
      <ol class="mb-0">
        ${EXTERNAL_DEPS.map(d => `<li><b>${escapeHtml(d.name)}</b><br><a class="deps-link" href="${d.url}" target="_blank" rel="noopener">${escapeHtml(d.url)}</a> \u26A1</li>`).join('')}
      </ol>
      <div class="small text-muted mt-3">
        Security: <b>WebCrypto</b> is built into modern browsers (no download required) and is used for local encryption.
      </div>
    `;
  }

  const textEncoder = new TextEncoder();
  const textDecoder = new TextDecoder();

  function b64enc(bytes){
    let bin = '';
    bytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    for(let i=0;i<bytes.length;i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }
  function b64dec(b64){
    const bin = atob(String(b64 || ''));
    const out = new Uint8Array(bin.length);
    for(let i=0;i<bin.length;i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function nowMs(){ return Date.now(); }

  function isIndexPage(){
    const p = (location.pathname || '').split('/').pop() || 'index.html';
    return p === '' || p === 'index.html';
  }

  function sessionRemainingMs(){
    const start = parseInt(sessionStorage.getItem(S_START) || '0', 10);
    if(!start) return 0;
    const remaining = (start + SESSION_MS) - nowMs();
    return Math.max(0, remaining);
  }

  function hasVault(){
    try{ return !!localStorage.getItem(K_VAULT_PW); }catch(e){ return false; }
  }

  function isUnlocked(){
    try{
      const dek = sessionStorage.getItem(S_DEK);
      if(!dek) return false;
      return sessionRemainingMs() > 0;
    }catch(e){ return false; }
  }

  function markLocked(){
    window.__AAVARTAN_LOCKED__ = true;
    document.documentElement.classList.add('aavartan-locked');
  }

  function clearSession(){
    try{ sessionStorage.removeItem(S_DEK); }catch(e){}
    try{ sessionStorage.removeItem(S_START); }catch(e){}
  }

  function setSession(dekB64){
    sessionStorage.setItem(S_DEK, dekB64);
    sessionStorage.setItem(S_START, String(nowMs()));
  }

  async function importAesKeyRaw(rawBytes){
    return crypto.subtle.importKey(
      'raw',
      rawBytes,
      { name:'AES-GCM', length:256 },
      false,
      ['encrypt','decrypt']
    );
  }

  async function deriveKek(passphrase, saltBytes, iterations){
    const baseKey = await crypto.subtle.importKey(
      'raw',
      textEncoder.encode(String(passphrase)),
      { name:'PBKDF2' },
      false,
      ['deriveKey']
    );
    return crypto.subtle.deriveKey(
      {
        name:'PBKDF2',
        salt: saltBytes,
        iterations: iterations,
        hash:'SHA-256'
      },
      baseKey,
      { name:'AES-GCM', length:256 },
      false,
      ['encrypt','decrypt']
    );
  }

  async function aesGcmEncrypt(key, plaintextBytes, aadBytes){
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt(
      { name:'AES-GCM', iv, additionalData: aadBytes || undefined },
      key,
      plaintextBytes
    );
    return { iv: b64enc(iv), ct: b64enc(new Uint8Array(ct)) };
  }

  async function aesGcmDecrypt(key, ivB64, ctB64, aadBytes){
    const iv = b64dec(ivB64);
    const ct = b64dec(ctB64);
    const pt = await crypto.subtle.decrypt(
      { name:'AES-GCM', iv, additionalData: aadBytes || undefined },
      key,
      ct
    );
    return new Uint8Array(pt);
  }

  async function encryptStringWithDek(dekKey, keyName, plaintext){
    const aad = textEncoder.encode(String(keyName));
    const pt = textEncoder.encode(String(plaintext));
    const payload = await aesGcmEncrypt(dekKey, pt, aad);
    return ENC_PREFIX + JSON.stringify({ v:1, iv: payload.iv, ct: payload.ct });
  }

  async function decryptStringWithDek(dekKey, keyName, storedValue){
    if(typeof storedValue !== 'string') return null;
    if(!storedValue.startsWith(ENC_PREFIX)) return storedValue; // legacy plaintext (will be migrated)
    const json = storedValue.slice(ENC_PREFIX.length);
    const obj = JSON.parse(json);
    const aad = textEncoder.encode(String(keyName));
    const ptBytes = await aesGcmDecrypt(dekKey, obj.iv, obj.ct, aad);
    return textDecoder.decode(ptBytes);
  }

  async function makeVaultFromSecret(secret, dekRawB64){
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iterations = 250000;
    const kek = await deriveKek(secret, salt, iterations);
    const dekRaw = b64dec(dekRawB64);
    const enc = await aesGcmEncrypt(kek, dekRaw, textEncoder.encode('aavartan-dek'));
    return {
      v:1,
      salt: b64enc(salt),
      iter: iterations,
      iv: enc.iv,
      ct: enc.ct
    };
  }

  async function openVaultWithSecret(vaultObj, secret){
    const salt = b64dec(vaultObj.salt);
    const iterations = vaultObj.iter || 250000;
    const kek = await deriveKek(secret, salt, iterations);
    const dekBytes = await aesGcmDecrypt(kek, vaultObj.iv, vaultObj.ct, textEncoder.encode('aavartan-dek'));
    return b64enc(dekBytes);
  }

  async function migrateAllToEncrypted(dekKey){
    // Encrypt any non-vault localStorage key that is currently plaintext.
    const keys = [];
    for(let i=0;i<localStorage.length;i++){
      const k = localStorage.key(i);
      if(!k) continue;
      if(PLAINTEXT_KEYS.has(k)) continue;
      keys.push(k);
    }

    for(const k of keys){
      const raw = localStorage.getItem(k);
      if(typeof raw !== 'string') continue;
      if(raw.startsWith(ENC_PREFIX)) continue;
      const enc = await encryptStringWithDek(dekKey, k, raw);
      localStorage.setItem(k, enc);
    }
  }

  // --- High-level auth operations -------------------------------------------------
  function getVaultObj(key){
    const raw = localStorage.getItem(key);
    if(!raw) return null;
    try{ return JSON.parse(raw); }catch(e){ return null; }
  }

  function setVaultObj(key, obj){
    localStorage.setItem(key, JSON.stringify(obj));
  }

  function assertNonEmpty(label, v){
    if(!v || !String(v).trim()) throw new Error(`${label} is required.`);
  }

  function assertPasswordOk(pw){
    if(typeof pw !== 'string' || pw.length < 6) throw new Error('Password must be at least 6 characters.');
  }

  async function setupNewInstall(pw, pw2, resetCode){
    assertPasswordOk(pw);
    if(pw !== pw2) throw new Error('Passwords do not match.');
    assertNonEmpty('Reset Code', resetCode);

    // Create a fresh Data Encryption Key (DEK) for all encrypted local data.
    const dek = crypto.getRandomValues(new Uint8Array(32));
    const dekB64 = b64enc(dek);

    // Create two vaults that can unlock the same DEK.
    const pwVault = await makeVaultFromSecret(pw, dekB64);
    const rcVault = await makeVaultFromSecret(resetCode, dekB64);
    setVaultObj(K_VAULT_PW, pwVault);
    setVaultObj(K_VAULT_RC, rcVault);
    try{ localStorage.setItem(K_INIT, '1'); }catch(e){}

    // Establish session and install secure store for this runtime.
    setSession(dekB64);
    await installSecureStore(dekB64);
    // Migrate any existing plaintext keys into encrypted form.
    await window.AAVARTAN_SECURE.migrate();
  }

  async function login(password){
    assertNonEmpty('Password', password);
    const vault = getVaultObj(K_VAULT_PW);
    if(!vault) throw new Error('No vault found.');
    const dekB64 = await openVaultWithSecret(vault, password);
    setSession(dekB64);
    await installSecureStore(dekB64);
    await window.AAVARTAN_SECURE.migrate();
  }

  async function resetPassword(resetCode, newPw, newPw2){
    assertNonEmpty('Reset Code', resetCode);
    assertPasswordOk(newPw);
    if(newPw !== newPw2) throw new Error('Passwords do not match.');
    const rcVault = getVaultObj(K_VAULT_RC);
    if(!rcVault) throw new Error('No reset vault found.');
    const dekB64 = await openVaultWithSecret(rcVault, resetCode);
    const pwVault = await makeVaultFromSecret(newPw, dekB64);
    setVaultObj(K_VAULT_PW, pwVault);
    setSession(dekB64);
    await installSecureStore(dekB64);
    await window.AAVARTAN_SECURE.migrate();
  }

  async function changePassword(currentPw, newPw, newPw2){
    assertNonEmpty('Current password', currentPw);
    assertPasswordOk(newPw);
    if(newPw !== newPw2) throw new Error('Passwords do not match.');
    const pwVault = getVaultObj(K_VAULT_PW);
    if(!pwVault) throw new Error('No vault found.');
    const dekB64 = await openVaultWithSecret(pwVault, currentPw);
    const nextVault = await makeVaultFromSecret(newPw, dekB64);
    setVaultObj(K_VAULT_PW, nextVault);
  }

  async function changeResetCode(currentRc, newRc){
    assertNonEmpty('Current reset code', currentRc);
    assertNonEmpty('New reset code', newRc);
    const rcVault = getVaultObj(K_VAULT_RC);
    if(!rcVault) throw new Error('No reset vault found.');
    const dekB64 = await openVaultWithSecret(rcVault, currentRc);
    const nextVault = await makeVaultFromSecret(newRc, dekB64);
    setVaultObj(K_VAULT_RC, nextVault);
  }

  async function requirePassword(actionLabel){
    // Always ask for password, even during an active session.
    return new Promise((resolve)=>{
      if(!window.bootstrap){ resolve(false); return; }
      injectAuthModals();
      const el = document.getElementById('authPwConfirmModal');
      const titleEl = document.getElementById('authPwConfirmTitle');
      const hintEl = document.getElementById('authPwConfirmHint');
      const inputEl = document.getElementById('authPwConfirmInput');
      const btn = document.getElementById('authPwConfirmBtn');
      if(titleEl) titleEl.textContent = actionLabel ? `${actionLabel} — password required` : 'Password required';
      if(hintEl) hintEl.textContent = '';
      if(inputEl) inputEl.value = '';

      const m = new bootstrap.Modal(el);

      const cleanup = ()=>{
        try{ btn?.removeEventListener('click', onConfirm); }catch(e){}
        try{ el?.removeEventListener('hidden.bs.modal', onHide); }catch(e){}
      };

      const onHide = ()=>{ cleanup(); resolve(false); };

      const onConfirm = async ()=>{
        if(hintEl) hintEl.textContent = '';
        const pw = inputEl ? String(inputEl.value || '') : '';
        try{
          const vault = getVaultObj(K_VAULT_PW);
          if(!vault) throw new Error('No vault found.');
          await openVaultWithSecret(vault, pw); // validate only
          cleanup();
          try{ m.hide(); }catch(e){}
          resolve(true);
        }catch(e){
          if(hintEl) hintEl.textContent = 'Incorrect password.';
        }
      };

      el.addEventListener('hidden.bs.modal', onHide, { once:true });
      btn.addEventListener('click', onConfirm);
      m.show();
      setTimeout(()=>{ try{ inputEl?.focus(); }catch(e){} }, 120);
    });
  }

  // Expose a minimal API for other modules (e.g., PDF export).
  window.AAVARTAN_AUTH = {
    requirePassword,
    isUnlocked,
    clearSession
  };

  function ensureAuthCss(){
    if(document.getElementById('authCss')) return;
    const style = document.createElement('style');
    style.id = 'authCss';
    style.textContent = `
      .aavartan-locked .requires-auth { filter: blur(1px); pointer-events:none; user-select:none; }
      .auth-badge { font-weight: 700; }
      .auth-countdown { color: #1DB954; font-variant-numeric: tabular-nums; }
      .auth-mini { opacity: 0.85; }
      .auth-modal .form-text { opacity: 0.85; }
      .auth-modal .modal-content { border-radius: 18px; }
      .auth-modal .modal-header { border-bottom: 1px solid rgba(255,255,255,0.10); }
      [data-theme="light"] .auth-modal .modal-header { border-bottom: 1px solid rgba(0,0,0,0.08); }
          /* Smaller first-run checklist text */
      .deps-links, .deps-links * { font-size: .78rem; line-height: 1.25; }

      /* Modal contrast (dark + light) */
      .auth-modal .modal-content{
        background: rgba(15, 23, 42, .94);
        color: #ffffff;
        border: 1px solid rgba(255,255,255,.12);
      }
      [data-theme="light"] .auth-modal .modal-content{
        background: rgba(255,255,255,.96);
        color: #0b1220;
        border: 1px solid rgba(0,0,0,.12);
      }
      .auth-modal .form-label, .auth-modal label, .auth-modal .fw-bold{ color: inherit !important; }
      .auth-modal .form-control{
        background: rgba(255,255,255,.06);
        color: inherit;
        border-color: rgba(255,255,255,.14);
      }
      [data-theme="light"] .auth-modal .form-control{
        background: rgba(255,255,255,.96);
        color: #0b1220;
        border-color: rgba(0,0,0,.14);
      }
      .auth-modal .btn-close{ filter: invert(1); }
      [data-theme="light"] .auth-modal .btn-close{ filter: none; }

      /* Profile modal sizing + background art */
      .auth-profile-dialog{ max-width: 720px; }
      .auth-profile .modal-content{ position: relative; overflow: hidden; }
      .auth-profile .auth-modal-bg{
        position:absolute; inset:0;
        background: url('about_bg.png') center/cover no-repeat;
        opacity: .12;
        pointer-events:none;
      }
      .auth-profile .modal-body{ position: relative; z-index: 1; max-height: 60vh; overflow:auto; }
      .auth-profile .form-label{ font-size: .82rem; }
      .auth-profile .form-control{
        padding: .30rem .50rem;
        font-size: .90rem;
      }
`;
    document.head.appendChild(style);
  }

  function enhanceSidebar(){
    const swRow = document.querySelector('.offcanvas-body .mt-auto');
    if(!swRow) return;

    // Add Profile button once
    const list = document.querySelector('.offcanvas-body .list-group');
    if(list && !document.getElementById('profileBtn')){
      const btn = document.createElement('button');
      btn.className = 'list-group-item list-group-item-action';
      btn.type = 'button';
      btn.id = 'profileBtn';
      btn.textContent = 'Profile';
      list.appendChild(btn);
    }

    // Add @admin + countdown above theme switch
    if(!document.getElementById('authLine')){
      const line = document.createElement('div');
      line.id = 'authLine';
      line.className = 'd-flex align-items-center justify-content-between px-2 mb-1';
      line.innerHTML = `<div class="small auth-badge">@admin</div><div class="d-flex align-items-center gap-2"><a href="#" id="authSidebarLogout" class="small text-decoration-none">logout</a><div class="small auth-countdown" id="authCountdown">--:--</div></div>`;
      swRow.insertBefore(line, swRow.firstChild);
    }

    const profileBtn = document.getElementById('profileBtn');
    if(profileBtn){
      profileBtn.addEventListener('click', ()=>{
        if(!window.bootstrap) return;
        const m = document.getElementById('authProfileModal');
        if(m){ new bootstrap.Modal(m).show(); }
      });
    }
  }

  function injectAuthModals(){
    if(document.getElementById('authLoginModal')) return;

    const wrapper = document.createElement('div');
    wrapper.innerHTML = `
      <div class="modal fade auth-modal" id="authLoginModal" tabindex="-1" aria-hidden="true" data-bs-backdrop="static" data-bs-keyboard="false">
        <div class="modal-dialog modal-dialog-centered">
          <div class="modal-content">
            <div class="modal-header">
              <h5 class="modal-title">Sign in</h5>
            </div>
            <div class="modal-body py-2">
              <div class="mb-2">
                <label class="form-label fw-bold">ID</label>
                <input class="form-control" id="authId" autocomplete="username" placeholder="admin" />
              </div>
              <div class="mb-2">
                <label class="form-label fw-bold">Password</label>
                <input class="form-control" id="authPw" type="password" autocomplete="current-password" />
              </div>
              <div class="d-flex align-items-center justify-content-between mt-2">
                <button class="btn btn-primary fw-bold" id="authLoginBtn" type="button">Login</button>
                <button class="btn btn-link p-0" id="authForgotBtn" type="button">Forgot password?</button>
              </div>
              <div class="form-text mt-2" id="authLoginHint"></div>
            </div>
          </div>
        </div>
      </div>

      <div class="modal fade auth-modal" id="authSetupModal" tabindex="-1" aria-hidden="true" data-bs-backdrop="static" data-bs-keyboard="false">
        <div class="modal-dialog modal-dialog-centered">
          <div class="modal-content">
            <div class="modal-header">
              <h5 class="modal-title">Create Admin Password</h5>
            </div>
            <div class="modal-body py-2">
              <div class="mb-2">
                <label class="form-label fw-bold">Password</label>
                <input class="form-control" id="setupPw" type="password" autocomplete="new-password" />
              </div>
              <div class="mb-2">
                <label class="form-label fw-bold">Confirm Password</label>
                <input class="form-control" id="setupPw2" type="password" autocomplete="new-password" />
              </div>
              <div class="mb-2">
                <label class="form-label fw-bold">Reset Code</label>
                <input class="form-control" id="setupRc" type="text" autocomplete="off" placeholder="Case-sensitive secret" />
                <div class="form-text">This reset code is required for Forgot Password.</div>
              </div>
              <div class="d-flex align-items-center justify-content-between mt-3">
                <button class="btn btn-primary fw-bold" id="setupSaveBtn" type="button">Save</button>
              </div>
              <div class="form-text mt-2" id="setupHint"></div>
            </div>
          </div>
        </div>
      </div>

      <div class="modal fade auth-modal" id="authResetModal" tabindex="-1" aria-hidden="true" data-bs-backdrop="static" data-bs-keyboard="false">
        <div class="modal-dialog modal-dialog-centered">
          <div class="modal-content">
            <div class="modal-header">
              <h5 class="modal-title">Reset Password</h5>
            </div>
            <div class="modal-body py-2">
              <div class="mb-2">
                <label class="form-label fw-bold">ID</label>
                <input class="form-control" id="resetId" placeholder="admin" />
              </div>
              <div class="mb-2">
                <label class="form-label fw-bold">Reset Code</label>
                <input class="form-control" id="resetRc" type="text" autocomplete="off" />
              </div>
              <div class="mb-2">
                <label class="form-label fw-bold">New Password</label>
                <input class="form-control" id="resetPw" type="password" autocomplete="new-password" />
              </div>
              <div class="mb-2">
                <label class="form-label fw-bold">Confirm Password</label>
                <input class="form-control" id="resetPw2" type="password" autocomplete="new-password" />
              </div>
              <div class="d-flex align-items-center justify-content-between mt-2">
                <button class="btn btn-primary fw-bold" id="resetSaveBtn" type="button">Update</button>
                <button class="btn btn-outline-secondary fw-bold" id="resetBackBtn" type="button">Back</button>
              </div>
              <div class="form-text mt-2" id="resetHint"></div>
            </div>
          </div>
        </div>
      </div>
      <div class="modal fade auth-modal" id="authPwConfirmModal" tabindex="-1" aria-hidden="true">
        <div class="modal-dialog modal-dialog-centered">
          <div class="modal-content">
            <div class="modal-header">
              <h5 class="modal-title" id="authPwConfirmTitle">Password required</h5>
              <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
            </div>
            <div class="modal-body py-2">
              <div class="mb-2">
                <label class="form-label fw-bold" id="authPwConfirmLabel">Enter password</label>
                <input class="form-control" id="authPwConfirmInput" type="password" autocomplete="current-password" />
                <div class="form-text mt-2" id="authPwConfirmHint"></div>
              </div>
              <div class="d-flex align-items-center justify-content-end gap-2 mt-3">
                <button class="btn btn-outline-secondary fw-bold" data-bs-dismiss="modal" type="button">Cancel</button>
                <button class="btn btn-primary fw-bold" id="authPwConfirmBtn" type="button">Confirm</button>
              </div>
            </div>
          </div>
        </div>
      </div>


      <div class="modal fade auth-modal auth-profile" id="authProfileModal" tabindex="-1" aria-hidden="true">
        <div class="modal-dialog modal-dialog-centered auth-profile-dialog">
          <div class="modal-content">
            <div class="modal-header">
              <h5 class="modal-title w-100">
                <div class="d-flex align-items-center justify-content-between w-100">
                  <span>Profile (@admin)</span>
                  <span class="small auth-countdown" id="profileCountdown">--:--</span>
                </div>
              </h5>
              <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
            </div>
            <div class="modal-body py-2">

              <hr class="my-3">

              <div class="fw-bold mb-2">Change password</div>
              <div class="mb-2">
                <label class="form-label fw-bold">Current password</label>
                <input class="form-control form-control-sm" id="chgCurPw" type="password" autocomplete="current-password" />
              </div>
              <div class="row g-2 mb-2">
                <div class="col-6">
                  <label class="form-label fw-bold">New password</label>
                  <input class="form-control form-control-sm" id="chgNewPw" type="password" autocomplete="new-password" />
                </div>
                <div class="col-6">
                  <label class="form-label fw-bold">Confirm</label>
                  <input class="form-control form-control-sm" id="chgNewPw2" type="password" autocomplete="new-password" />
                </div>
              </div>
              <button class="btn btn-sm btn-primary fw-bold" id="chgPwBtn" type="button">Update password</button>
              <div class="form-text mt-2" id="chgPwHint"></div>

              <hr class="my-3">

              <div class="fw-bold mb-2">Change reset code</div>
              <div class="row g-2 mb-2">
                <div class="col-5">
                  <label class="form-label fw-bold">Current code</label>
                  <input class="form-control form-control-sm" id="chgCurRc" type="text" autocomplete="off" />
                </div>
                <div class="col-5">
                  <label class="form-label fw-bold">New code</label>
                  <input class="form-control form-control-sm" id="chgNewRc" type="text" autocomplete="off" />
                </div>
              </div>
              <button class="btn btn-sm btn-outline-secondary fw-bold" id="chgRcBtn" type="button">Update reset code</button>
              <div class="form-text mt-2" id="chgRcHint"></div>
            </div>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(wrapper);
  }

  function fmtCountdown(ms){
    const s = Math.max(0, Math.floor(ms / 1000));
    const mm = String(Math.floor(s / 60)).padStart(2,'0');
    const ss = String(s % 60).padStart(2,'0');
    return `${mm}:${ss}`;
  }

  function startCountdownLoop(){
    function tick(){
      const ms = sessionRemainingMs();
      const txt = fmtCountdown(ms);
      const a = document.getElementById('authCountdown');
      if(a) a.textContent = txt;
      const p = document.getElementById('profileCountdown');
      if(p) p.textContent = txt;
      if(ms <= 0){
        // force lock
        clearSession();
        if(isIndexPage()){
          showLoginModal('Session expired. Please login again.');
        }else{
          location.href = 'index.html';
        }
        return;
      }
      setTimeout(tick, 1000);
    }
    setTimeout(tick, 200);
  }

  function showLoginModal(hint){
    if(!window.bootstrap) return;
    injectAuthModals();
    const el = document.getElementById('authLoginModal');
    const hintEl = document.getElementById('authLoginHint');
    if(hintEl) hintEl.textContent = hint || '';
    const m = new bootstrap.Modal(el);
    m.show();
    setTimeout(()=>{
      const idEl = document.getElementById('authId');
      if(idEl){ idEl.value = 'admin'; idEl.focus(); }
      const pwEl = document.getElementById('authPw');
      if(pwEl) pwEl.value = '';
    }, 150);
  }

  function showSetupModal(hint){
    if(!window.bootstrap) return;
    injectAuthModals();
    const el = document.getElementById('authSetupModal');
    const hintEl = document.getElementById('setupHint');
    if(hintEl) hintEl.textContent = hint || '';
    const m = new bootstrap.Modal(el);
    m.show();
    setTimeout(()=>{
      const pw = document.getElementById('setupPw');
      if(pw){ pw.value = ''; pw.focus(); }
      const pw2 = document.getElementById('setupPw2');
      if(pw2) pw2.value = '';
      const rc = document.getElementById('setupRc');
      if(rc) rc.value = '';
    }, 150);
  }

  function showResetModal(hint){
    if(!window.bootstrap) return;
    injectAuthModals();
    const el = document.getElementById('authResetModal');
    const hintEl = document.getElementById('resetHint');
    if(hintEl) hintEl.textContent = hint || '';
    const m = new bootstrap.Modal(el);
    m.show();
    setTimeout(()=>{
      const idEl = document.getElementById('resetId');
      if(idEl){ idEl.value = 'admin'; idEl.focus(); }
      ['resetRc','resetPw','resetPw2'].forEach(id=>{ const x=document.getElementById(id); if(x) x.value=''; });
    }, 150);
  }

  async function installSecureStore(dekB64){
    const dekBytes = b64dec(dekB64);
    const dekKey = await importAesKeyRaw(dekBytes);

    const secure = {
      async get(key){
        if(PLAINTEXT_KEYS.has(key)) return localStorage.getItem(key);
        const raw = localStorage.getItem(key);
        if(raw == null) return null;
        return decryptStringWithDek(dekKey, key, raw);
      },
      async set(key, value){
        if(PLAINTEXT_KEYS.has(key)){
          localStorage.setItem(key, String(value));
          return;
        }
        const enc = await encryptStringWithDek(dekKey, key, String(value));
        localStorage.setItem(key, enc);
      },
      async remove(key){
        localStorage.removeItem(key);
      },
      async migrate(){
        await migrateAllToEncrypted(dekKey);
      },
      _dekKey: dekKey
    };

    window.AAVARTAN_SECURE = secure;
    try{ window.dispatchEvent(new Event('aavartan:secure-ready')); }catch(e){}
    return secure;
  }

  async function handleFirstRunFlow(){
    // index.html: show the libraries checklist first (before any auth prompts), then setup.
    const depsModal = document.getElementById('depsModal');
    if(depsModal && window.bootstrap){
      renderDepsChecklist();
      const body = document.getElementById('depsBody');
      if(body) body.classList.add('deps-links');
      const m = new bootstrap.Modal(depsModal);
      depsModal.addEventListener('hidden.bs.modal', ()=>{
        try{ localStorage.setItem(K_DEPS_SEEN, '1'); }catch(e){}
        showSetupModal('');
      }, { once:true });
      m.show();
      return;
    }
    showSetupModal('');
  }

  function wireAuthUi(){
    ensureAuthCss();
    injectAuthModals();
    enhanceSidebar();

    const loginBtn = document.getElementById('authLoginBtn');
    const forgotBtn = document.getElementById('authForgotBtn');
    const setupSaveBtn = document.getElementById('setupSaveBtn');
    const resetSaveBtn = document.getElementById('resetSaveBtn');
    const resetBackBtn = document.getElementById('resetBackBtn');

    if(forgotBtn){
      forgotBtn.addEventListener('click', ()=>{
        // hide login modal then show reset
        const lmEl = document.getElementById('authLoginModal');
        if(lmEl){
          try{ bootstrap.Modal.getInstance(lmEl)?.hide(); }catch(e){}
        }
        setTimeout(()=> showResetModal(''), 180);
      });
    }

    if(resetBackBtn){
      resetBackBtn.addEventListener('click', ()=>{
        const rmEl = document.getElementById('authResetModal');
        if(rmEl){
          try{ bootstrap.Modal.getInstance(rmEl)?.hide(); }catch(e){}
        }
        setTimeout(()=> showLoginModal(''), 180);
      });
    }

    if(loginBtn){
      loginBtn.addEventListener('click', async ()=>{
        const id = (document.getElementById('authId')?.value || '').trim();
        const pw = (document.getElementById('authPw')?.value || '');
        const hint = document.getElementById('authLoginHint');
        if(hint) hint.textContent = '';
        if(id !== ADMIN_ID){ if(hint) hint.textContent = 'Invalid ID.'; return; }
        try{
          await login(pw);
          location.reload();
        }catch(e){
          if(hint) hint.textContent = 'Login failed. Check password.';
        }
      });
    }

    if(setupSaveBtn){
      setupSaveBtn.addEventListener('click', async ()=>{
        const pw = (document.getElementById('setupPw')?.value || '');
        const pw2 = (document.getElementById('setupPw2')?.value || '');
        const rc = (document.getElementById('setupRc')?.value || '');
        const hint = document.getElementById('setupHint');
        if(hint) hint.textContent = '';
        try{
          await setupNewInstall(pw, pw2, rc);
          location.reload();
        }catch(e){
          if(hint) hint.textContent = e && e.message ? e.message : 'Setup failed.';
        }
      });
    }

    if(resetSaveBtn){
      resetSaveBtn.addEventListener('click', async ()=>{
        const id = (document.getElementById('resetId')?.value || '').trim();
        const rc = (document.getElementById('resetRc')?.value || '');
        const pw = (document.getElementById('resetPw')?.value || '');
        const pw2 = (document.getElementById('resetPw2')?.value || '');
        const hint = document.getElementById('resetHint');
        if(hint) hint.textContent = '';
        if(id !== ADMIN_ID){ if(hint) hint.textContent = 'Invalid ID.'; return; }
        try{
          await resetPassword(rc, pw, pw2);
          location.reload();
        }catch(e){
          if(hint) hint.textContent = 'Reset failed. Check reset code.';
        }
      });
    }

    // Profile actions
    const logoutBtn = document.getElementById('authSidebarLogout');
    if(logoutBtn){
      logoutBtn.addEventListener('click', ()=>{
        clearSession();
        location.href = 'index.html';
      });
    }

    const chgPwBtn = document.getElementById('chgPwBtn');
    if(chgPwBtn){
      chgPwBtn.addEventListener('click', async ()=>{
        const cur = document.getElementById('chgCurPw')?.value || '';
        const n1 = document.getElementById('chgNewPw')?.value || '';
        const n2 = document.getElementById('chgNewPw2')?.value || '';
        const hint = document.getElementById('chgPwHint');
        if(hint) hint.textContent='';
        try{
          await changePassword(cur, n1, n2);
          if(hint) hint.textContent = 'Password updated.';
        }catch(e){
          if(hint) hint.textContent = e && e.message ? e.message : 'Update failed.';
        }
      });
    }

    const chgRcBtn = document.getElementById('chgRcBtn');
    if(chgRcBtn){
      chgRcBtn.addEventListener('click', async ()=>{
        const cur = document.getElementById('chgCurRc')?.value || '';
        const n1 = document.getElementById('chgNewRc')?.value || '';
        const hint = document.getElementById('chgRcHint');
        if(hint) hint.textContent='';
        try{
          await changeResetCode(cur, n1);
          if(hint) hint.textContent = 'Reset code updated.';
        }catch(e){
          if(hint) hint.textContent = e && e.message ? e.message : 'Update failed.';
        }
      });
    }
  }

  async function boot(){
    if(!('crypto' in window) || !crypto.subtle){
      // Fall back: do not allow app without WebCrypto.
      markLocked();
      if(isIndexPage()) alert('This browser does not support WebCrypto.');
      return;
    }

    ensureAuthCss();

    if(isUnlocked()){
      // Install secure store for this page (if not already installed)
      const dekB64 = sessionStorage.getItem(S_DEK);
      if(!window.AAVARTAN_SECURE) await installSecureStore(dekB64);
      window.__AAVARTAN_LOCKED__ = false;
      document.documentElement.classList.remove('aavartan-locked');
      wireAuthUi();
      startCountdownLoop();
      return;
    }

    // Locked
    markLocked();
    wireAuthUi();

    // If not index, redirect to index for login
    if(!isIndexPage()){
      location.href = 'index.html';
      return;
    }

    // Index page: show first-run deps then setup OR login
    if(!hasVault()){
      await handleFirstRunFlow();
    }else{
      showLoginModal('');
    }
  }

  // Install the secure store as early as possible (so other scripts can wait on it).
  (async ()=>{
    try{
      if(isUnlocked() && !window.AAVARTAN_SECURE){
        const dekB64 = sessionStorage.getItem(S_DEK);
        if(dekB64) await installSecureStore(dekB64);
        window.__AAVARTAN_LOCKED__ = false;
        document.documentElement.classList.remove('aavartan-locked');
      }
    }catch(e){}
  })();

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', ()=>{ boot(); });
  }else{
    boot();
  }
})();
