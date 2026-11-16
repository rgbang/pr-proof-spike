// On-screen overlay injected into the app's page during a recorded test run:
// scoreboard (top right), narration banner (bottom), check toasts, a visible cursor and click rings.
(() => {
  if (window.__tr) return;
  const css = document.createElement('style');
  css.textContent = `
    #tr-panel { position: fixed; top: 14px; right: 14px; width: 262px; max-height: calc(100vh - 28px); overflow: hidden;
      z-index: 2147483640; background: rgba(13,17,23,.94); color: #e6edf3; border-radius: 14px; padding: 12px 12px 10px;
      font: 12.5px/1.35 'Segoe UI', system-ui, sans-serif; box-shadow: 0 12px 32px rgba(0,0,0,.35); }
    #tr-panel .hd { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 8px; }
    #tr-panel .hd b { font-size: 13px; letter-spacing: .08em; color: #6c9bff; }
    #tr-panel .hd span { font-size: 12px; color: #8b949e; }
    #tr-panel .cnt { display: flex; gap: 10px; margin-bottom: 8px; font-weight: 700; font-size: 13px; }
    #tr-panel .it { display: grid; grid-template-columns: 16px 1fr; gap: 6px; padding: 2.5px 4px; border-radius: 6px; color: #8b949e; }
    #tr-panel .it.run { background: rgba(108,155,255,.18); color: #fff; }
    #tr-panel .it.pass { color: #c9d1d9; } #tr-panel .it.fail { color: #ffb3ae; }
    #tr-panel .ic { text-align: center; font-weight: 800; }
    #tr-panel .pass .ic { color: #3fb950; } #tr-panel .fail .ic { color: #f85149; } #tr-panel .run .ic { color: #6c9bff; }
    #tr-banner { position: fixed; left: 14px; right: 290px; bottom: 14px; z-index: 2147483640;
      background: rgba(13,17,23,.94); color: #e6edf3; border-radius: 14px; padding: 12px 18px;
      font: 15px/1.4 'Segoe UI', system-ui, sans-serif; box-shadow: 0 12px 32px rgba(0,0,0,.35); }
    #tr-banner .n { font-size: 13px; color: #6c9bff; font-weight: 700; letter-spacing: .04em; }
    #tr-banner .s { font-size: 16.5px; margin-top: 2px; }
    #tr-banner .st { font-size: 13px; color: #8b949e; margin-top: 4px; min-height: 18px; }
    #tr-toasts { position: fixed; left: 14px; bottom: 128px; z-index: 2147483641; display: flex; flex-direction: column; gap: 6px; align-items: flex-start; }
    .tr-toast { background: #12261a; color: #aff5b4; border: 1px solid #2e6b3a; border-radius: 10px; padding: 6px 12px;
      font: 600 14px/1.3 'Segoe UI', system-ui, sans-serif; box-shadow: 0 6px 18px rgba(0,0,0,.25); max-width: 760px;
      animation: trIn .25s ease-out; }
    .tr-toast.bad { background: #2d1215; color: #ffb3ae; border-color: #7a2a2a; }
    .tr-toast.info { background: #13203a; color: #b8cfff; border-color: #2c4a85; }
    @keyframes trIn { from { opacity: 0; transform: translateY(6px); } }
    #tr-cursor { position: fixed; left: 0; top: 0; z-index: 2147483647; pointer-events: none; transition: transform .45s cubic-bezier(.3,.8,.3,1); }
    #tr-cursor svg { filter: drop-shadow(0 1px 2px rgba(0,0,0,.6)); }
    #tr-ring { position: fixed; z-index: 2147483646; pointer-events: none; width: 36px; height: 36px; margin: -18px 0 0 -18px;
      border-radius: 50%; border: 3px solid #2f6fed; opacity: 0; }
    #tr-ring.go { animation: trRing .5s ease-out; }
    @keyframes trRing { from { opacity: 1; transform: scale(.3); } to { opacity: 0; transform: scale(1.4); } }
    #tr-peek { position: fixed; left: 50%; transform: translateX(-60%); top: 90px; width: min(680px, 60vw); z-index: 2147483642;
      background: #fff; color: #1b1f24; border: 2px solid #2f6fed; border-radius: 12px; padding: 14px 18px;
      font: 14px/1.45 'Segoe UI', system-ui, sans-serif; box-shadow: 0 16px 40px rgba(0,0,0,.3); white-space: pre-wrap; }
    #tr-peek b { display: block; color: #2f6fed; margin-bottom: 6px; }
  `;
  document.head.appendChild(css);
  const add = (id, html) => { const e = document.createElement('div'); e.id = id; e.innerHTML = html || ''; document.body.appendChild(e); return e; };
  add('tr-panel'); add('tr-banner'); add('tr-toasts');
  add('tr-cursor', '<svg width="22" height="22" viewBox="0 0 22 22"><path d="M3 2 L3 18 L7.5 13.8 L10.5 20.5 L13.3 19.3 L10.4 12.7 L16.5 12.7 Z" fill="#fff" stroke="#111" stroke-width="1.3" stroke-linejoin="round"/></svg>');
  add('tr-ring');
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };
  const CLICKABLE = 'button, a, summary, [role=button], [role=tab], [role=option], [role=menuitem], input, textarea, select, label, [onclick], [tabindex]';
  window.__tr = {
    esc,
    panel(state) {
      const ic = { pass: '✓', fail: '✗', run: '▸', todo: '○' };
      const p = state.tests.filter(t => t.s === 'pass').length, f = state.tests.filter(t => t.s === 'fail').length;
      document.getElementById('tr-panel').innerHTML =
        '<div class="hd"><b>BROWSER TESTS</b><span>' + (p + f) + ' / ' + state.tests.length + '</span></div>' +
        '<div class="cnt"><span style="color:#3fb950">✓ ' + p + ' passed</span><span style="color:' + (f ? '#f85149' : '#8b949e') + '">✗ ' + f + ' failed</span></div>' +
        state.tests.map(t => '<div class="it ' + t.s + '"><span class="ic">' + ic[t.s] + '</span><span>' + esc(t.name) + '</span></div>').join('');
    },
    banner(n, s, st) {
      document.getElementById('tr-banner').innerHTML = '<div class="n">' + esc(n) + '</div><div class="s">' + esc(s) + '</div><div class="st">' + esc(st || '') + '</div>';
    },
    status(st) { const e = document.querySelector('#tr-banner .st'); if (e) e.textContent = st; },
    toast(text, kind) {
      const box = document.getElementById('tr-toasts');
      const t = document.createElement('div'); t.className = 'tr-toast ' + (kind || ''); t.textContent = text; box.appendChild(t);
      while (box.children.length > 4) box.firstChild.remove();
    },
    clearToasts() { document.getElementById('tr-toasts').innerHTML = ''; },
    // Find a clickable element by its visible text: exact match first, then starts-with, then contains.
    find(text, sel) {
      sel = sel || (window.__trExtra ? CLICKABLE + ', ' + window.__trExtra : CLICKABLE);
      const els = [...document.querySelectorAll(sel)].filter(visible).filter(e => !e.closest('#tr-panel, #tr-banner, #tr-toasts'));
      const t = (e) => (e.textContent || e.value || e.placeholder || e.getAttribute('aria-label') || '').trim();
      return els.find(e => t(e) === text) || els.find(e => t(e).startsWith(text)) || els.find(e => t(e).includes(text));
    },
    center(el) { const r = el.getBoundingClientRect(); return { x: r.left + Math.min(r.width / 2, 80), y: r.top + r.height / 2 }; },
    move(x, y) { document.getElementById('tr-cursor').style.transform = 'translate(' + (x - 3) + 'px,' + (y - 2) + 'px)'; },
    pulse(x, y) { const r = document.getElementById('tr-ring'); r.style.left = x + 'px'; r.style.top = y + 'px'; r.classList.remove('go'); void r.offsetWidth; r.classList.add('go'); },
    peek(title, text) { let p = document.getElementById('tr-peek'); if (!p) p = add('tr-peek'); p.innerHTML = '<b>' + esc(title) + '</b>' + esc(text); },
    unpeek() { document.getElementById('tr-peek')?.remove(); },
    async sha256(data) {
      const buf = data instanceof ArrayBuffer ? data : await new Response(data).arrayBuffer();
      const h = await crypto.subtle.digest('SHA-256', buf);
      return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('');
    },
  };
})()
