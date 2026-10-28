"use strict";

// 仅管理阵容浮窗位置和显示状态；不改变英雄选择、聊天或 Skill。
(() => {
  const panel = document.getElementById('draft-summary');
  const content = document.getElementById('summary-content');
  const handle = document.getElementById('summary-drag');
  const pin = document.getElementById('summary-pin');
  const toggle = document.getElementById('summary-toggle');
  const layout = document.querySelector('.app-layout');
  if (!panel || !content || !handle || !pin || !toggle || !layout) return;
  const tr = key => window.GameCoachI18n ? window.GameCoachI18n.t(key) : key;
  const compact = () => window.innerWidth <= 760;
  let bucket = compact() ? 'compact' : 'wide';
  const key = () => 'gamecoach-draft-panel:v1:' + bucket;
  let state, drag = null;
  function load() {
    let saved;
    try { saved = JSON.parse(localStorage.getItem(key()) || 'null'); } catch {}
    state = {collapsed: typeof saved?.collapsed === 'boolean' ? saved.collapsed : compact(),
      pinned: saved?.pinned === true,
      x: Number.isFinite(saved?.x) ? saved.x : null, y: Number.isFinite(saved?.y) ? saved.y : null};
  }
  function persist() { try { localStorage.setItem(key(), JSON.stringify(state)); } catch {} }
  function bounds() {
    const viewport = window.visualViewport;
    const left = (viewport?.offsetLeft || 0) + 8;
    const top = (viewport?.offsetTop || 0) + 8;
    const right = left + (viewport?.width || window.innerWidth) - 16;
    const bottom = top + (viewport?.height || window.innerHeight) - 16;
    const headerBottom = document.querySelector('.topbar')?.getBoundingClientRect().bottom || 0;
    return {left, top: Math.min(Math.max(top, headerBottom + 8), Math.max(top, bottom - 48)), right, bottom};
  }
  function move(x, y) {
    const box = bounds();
    panel.style.maxHeight = Math.max(44, box.bottom - box.top) + 'px';
    const rect = panel.getBoundingClientRect();
    state.x = Math.max(box.left, Math.min(x, Math.max(box.left, box.right - rect.width)));
    state.y = Math.max(box.top, Math.min(y, Math.max(box.top, box.bottom - rect.height)));
    panel.style.left = state.x + 'px'; panel.style.top = state.y + 'px'; panel.style.right = 'auto';
  }
  function constrain() {
    const rect = panel.getBoundingClientRect();
    move(state.x ?? rect.left, state.y ?? rect.top);
  }
  function render() {
    content.hidden = state.collapsed;
    panel.classList.toggle('is-collapsed', state.collapsed);
    panel.classList.toggle('is-pinned', state.pinned);
    layout.classList.toggle('summary-collapsed', state.collapsed);
    pin.textContent = tr(state.pinned ? '已固定' : '固定');
    pin.setAttribute('aria-pressed', String(state.pinned));
    pin.title = tr(state.pinned ? '解除固定后可拖动' : '固定当前位置');
    toggle.textContent = tr(state.collapsed ? '展开' : '收起');
    toggle.setAttribute('aria-expanded', String(!state.collapsed));
    handle.title = tr(state.pinned ? '解除固定后可拖动' : '拖动阵容窗口，方向键也可移动');
    constrain();
  }
  function endDrag(event) {
    if (!drag || (event?.pointerId !== undefined && event.pointerId !== drag.id)) return;
    const id = drag.id; drag = null; panel.classList.remove('is-dragging-panel');
    if (handle.hasPointerCapture?.(id)) handle.releasePointerCapture(id);
    persist();
  }
  toggle.onclick = () => { endDrag(); state.collapsed = !state.collapsed; render(); persist(); };
  pin.onclick = () => { endDrag(); state.pinned = !state.pinned; render(); persist(); };
  handle.onpointerdown = event => {
    if (state.pinned || event.button !== 0) return;
    event.preventDefault();
    const rect = panel.getBoundingClientRect();
    drag = {id: event.pointerId, clientX: event.clientX, clientY: event.clientY, x: rect.left, y: rect.top};
    handle.setPointerCapture?.(event.pointerId);
    panel.classList.add('is-dragging-panel');
  };
  handle.onpointermove = event => {
    if (!drag || event.pointerId !== drag.id) return;
    move(drag.x + event.clientX - drag.clientX, drag.y + event.clientY - drag.clientY);
  };
  handle.onpointerup = endDrag; handle.onpointercancel = endDrag; handle.onlostpointercapture = endDrag;
  handle.onkeydown = event => {
    if (state.pinned) return;
    const direction = {ArrowLeft: [-1,0], ArrowRight: [1,0], ArrowUp: [0,-1], ArrowDown: [0,1]}[event.key];
    if (!direction) return;
    event.preventDefault(); const step = event.shiftKey ? 40 : 10;
    move(state.x + direction[0] * step, state.y + direction[1] * step); persist();
  };
  function resize() {
    const next = compact() ? 'compact' : 'wide';
    endDrag();
    if (next !== bucket) {
      bucket = next; load(); panel.style.left = ''; panel.style.top = ''; panel.style.right = '';
      render();
    } else constrain();
  }
  window.addEventListener('resize', resize);
  window.visualViewport?.addEventListener('resize', resize);
  window.addEventListener('gamecoach:language-changed', render);
  load(); render();
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(constrain).observe(panel);
})();
