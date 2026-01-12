(function(){
  'use strict';

  // --- Theme (light/dark)
  const THEME_KEY = 'AAV_THEME';
  function applyTheme(theme){
    const t = (theme === 'dark') ? 'dark' : 'light';
    document.documentElement.dataset.theme = t;
    try { sessionStorage.setItem(THEME_KEY, t); } catch(e) {}
    if(window.AAVARTAN_SECURE){ window.AAVARTAN_SECURE.set(THEME_KEY, t).catch(()=>{}); }
    window.dispatchEvent(new CustomEvent('aavartan:theme'));
    const btn = document.getElementById('toggleThemeBtn');
    if(btn) btn.textContent = (t === 'dark') ? 'Light mode' : 'Dark mode';
    const sw = document.getElementById('themeSwitch');
    if(sw) sw.checked = (t === 'dark');
  }
  function initTheme(){
    let t = 'light';
    try { t = sessionStorage.getItem(THEME_KEY) || 'light'; } catch(e) {}
    applyTheme(t);

    // If theme was previously stored encrypted, apply it once unlocked.
    if(!sessionStorage.getItem(THEME_KEY) && window.AAVARTAN_SECURE){
      window.AAVARTAN_SECURE.get(THEME_KEY).then(v=>{ if(v) applyTheme(v); }).catch(()=>{});
    }

    const btn = document.getElementById('toggleThemeBtn');
    if(btn){
      btn.addEventListener('click', function(){
        const cur = document.documentElement.dataset.theme || 'light';
        applyTheme(cur === 'dark' ? 'light' : 'dark');
      });
    }

    const sw = document.getElementById('themeSwitch');
    if(sw){
      sw.checked = (document.documentElement.dataset.theme === 'dark');
      sw.addEventListener('change', function(){
        applyTheme(sw.checked ? 'dark' : 'light');
      });
    }
  }

  function getTheme(){
    const t = document.documentElement.dataset.theme;
    return (t === 'dark') ? 'dark' : 'light';
  }

  function init(){

    const mount = document.getElementById('terrainLayer');
    if(!mount || !window.THREE) return;

    // Prevent double-init (if script included twice)
    if(mount.__terrainInitialized) return;
    mount.__terrainInitialized = true;

    const { Scene, PerspectiveCamera, WebGLRenderer, PlaneGeometry, MeshStandardMaterial, Mesh, AmbientLight, DirectionalLight } = THREE;

    const scene = new Scene();

    const camera = new PerspectiveCamera(55, 1, 0.1, 1000);
    camera.position.set(0, 28, 46);
    camera.lookAt(0, 0, 0);


    // --- Simple orbit controls (interactive background)
    const target = new THREE.Vector3(0, 0, 0);
    let radius = 72;
    let theta = Math.PI * 0.35;
    let phi = Math.PI * 0.34;
    let dragging = false;
    let lastX = 0, lastY = 0;
    let userActiveUntil = 0;

    function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }
    function updateCamera(){
      phi = clamp(phi, 0.20, Math.PI/2 - 0.06);
      const sinPhi = Math.sin(phi);
      camera.position.x = target.x + radius * sinPhi * Math.cos(theta);
      camera.position.z = target.z + radius * sinPhi * Math.sin(theta);
      camera.position.y = target.y + radius * Math.cos(phi);
      camera.lookAt(target);
    }
    updateCamera();

    mount.addEventListener('pointerdown', (e)=>{
      dragging = true;
      userActiveUntil = performance.now() + 2200;
      lastX = e.clientX; lastY = e.clientY;
      mount.setPointerCapture(e.pointerId);
    });
    mount.addEventListener('pointermove', (e)=>{
      if(!dragging) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX; lastY = e.clientY;
      theta -= dx * 0.006;
      phi   -= dy * 0.006;
      userActiveUntil = performance.now() + 2200;
      updateCamera();
    });
    mount.addEventListener('pointerup', ()=>{ dragging = false; });
    mount.addEventListener('pointercancel', ()=>{ dragging = false; });
    mount.addEventListener('wheel', (e)=>{
      e.preventDefault();
      radius = clamp(radius + e.deltaY * 0.05, 55, 120);
      userActiveUntil = performance.now() + 2200;
      updateCamera();
    }, { passive:false });


    // Opaque renderer so the terrain is always visible behind the UI (body background is transparent).
    const renderer = new WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor((getTheme()==='dark') ? 0x070b14 : 0xeef4ff, 1);

    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.display = 'block';

    mount.innerHTML = '';
    mount.appendChild(renderer.domElement);

    // Lights
    scene.add(new AmbientLight(0xffffff, 0.55));
    const sun = new DirectionalLight(0xffffff, 0.9);
    sun.position.set(-40, 60, 40);
    scene.add(sun);

    // Terrain mesh
    const size = 140;
    const seg = 120;
    const geo = new PlaneGeometry(size, size, seg, seg);
    geo.rotateX(-Math.PI/2);

    const mat = new MeshStandardMaterial({
      color: 0x1e5eff,
      roughness: 0.95,
      metalness: 0.0,
      wireframe: true,
      opacity: 0.22,
      transparent: true
    });

    const mesh = new Mesh(geo, mat);
    mesh.position.y = -4.0;
    scene.add(mesh);

    const pos = geo.attributes.position;
    const base = new Float32Array(pos.count);
    for(let i=0;i<pos.count;i++){
      base[i] = pos.getY(i);
    }

    let w = 0, h = 0;
    function resize(){
      const rect = mount.getBoundingClientRect();
      w = Math.max(1, rect.width);
      h = Math.max(1, rect.height);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h, false);
    }

  function applyThemeToTerrain(){
    const theme = getTheme();
    renderer.setClearColor((theme === 'dark') ? 0x070b14 : 0xeef4ff, 1);
  }
    resize();
    window.addEventListener('resize', resize, { passive: true });

    // Motion preference
    const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let t0 = performance.now();
    let frame = 0;

    function animate(now){
      const dt = (now - t0) / 1000;
      t0 = now;

      const t = now * 0.00055;
      // Subtle wave displacement (legacy look)
      for(let i=0;i<pos.count;i++){
        const x = pos.getX(i);
        const z = pos.getZ(i);
        const wave =
          Math.sin((x * 0.08) + (t * 2.2)) * 0.9 +
          Math.cos((z * 0.07) + (t * 1.8)) * 0.8 +
          Math.sin(((x+z) * 0.05) - (t * 1.6)) * 0.6;
        pos.setY(i, base[i] + wave);
      }
      pos.needsUpdate = true;

      // Normals are expensive; update periodically
      frame++;
      if(frame % 10 === 0) geo.computeVertexNormals();

      // Idle motion when not interacting
      if (performance.now() > userActiveUntil) {
        theta += 0.0012;
        updateCamera();
      }

      renderer.render(scene, camera);

      if(!reduceMotion) requestAnimationFrame(animate);
    }

    // Render at least one frame even if reduced motion
    requestAnimationFrame(animate);
  }

  if(document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function(){ initTheme(); init(); });
  } else {
    initTheme();
    init();
  }
})();
