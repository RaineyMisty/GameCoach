'use strict';
window.GameCoachDraftUI = (() => {
  function create({ champions, getDraft, onChange, onOpen }) {
    const $ = selector => document.querySelector(selector);
    const draftOps = window.GameCoachDraft;
    const byId = new Map(champions.map(champion => [champion.id, champion]));
    let target = null; let moving = null; let dragging = null; let filter = 'all'; let lastDraft = null;
    function node(tag, className, text) { const value = document.createElement(tag); if (className) value.className = className; if (text !== undefined) value.textContent = text; return value; }
    function control(label, className, action) { const value = node('button', className, label); value.type = 'button'; value.onclick = action; return value; }
    function image(champion) {
      const img = node('img'); img.src = champion.portrait; img.alt = ''; img.loading = 'lazy'; img.decoding = 'async'; img.draggable = false;
      img.onerror = () => { img.onerror = null; img.src = './assets/portraits/placeholder.svg'; }; return img;
    }
    const slotName = slot => (slot.side === 'ally' ? '我方' : '敌方') + draftOps.roles[slot.index].name;
    function commit(next, nextTarget) { lastDraft = next; target = nextTarget; moving = null; onChange(next); }
    function pick(id) {
      const draft = getDraft(); const current = draftOps.locate(draft, id);
      if (current) { target = current; moving = current; render(); $('#draft-' + current.side + '-' + current.index)?.focus({ preventScroll: true }); return; }
      if (!target) { $('#pick-hint').textContent = '双方已选满，请先点击一个位置再替换英雄。'; return; }
      const next = draftOps.assign(draft, id, target); const nextTarget = draftOps.nextEmpty(next, target);
      commit(next, nextTarget); document.getElementById('hero-' + id)?.focus({ preventScroll: true });
    }
    function select(slot) {
      const draft = getDraft();
      if (moving && !draftOps.same(moving, slot)) { const next = draftOps.move(draft, moving, slot); commit(next, draftOps.nextEmpty(next)); }
      else { target = slot; moving = draft[slot.side][slot.index] && !draftOps.same(moving, slot) ? slot : null; render(); }
      $('#draft-' + slot.side + '-' + slot.index)?.focus({ preventScroll: true });
    }
    function draggable(element, id) {
      element.draggable = true;
      element.ondragstart = event => {
        dragging = id; element.classList.add('is-dragging');
        event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('application/x-gamecoach-champion', id); event.dataTransfer.setData('text/plain', id);
      };
      element.ondragend = () => { dragging = null; element.classList.remove('is-dragging'); for (const slot of document.querySelectorAll('.drop-ready')) slot.classList.remove('drop-ready'); };
    }
    function dropTarget(element, slot) {
      element.ondragover = event => { if (!dragging || !byId.has(dragging)) return; event.preventDefault(); event.dataTransfer.dropEffect = 'move'; element.classList.add('drop-ready'); };
      element.ondragleave = event => { if (!element.contains(event.relatedTarget)) element.classList.remove('drop-ready'); };
      element.ondrop = event => {
        event.preventDefault(); element.classList.remove('drop-ready');
        const id = dragging; dragging = null;
        if (!id || !byId.has(id)) return;
        const next = draftOps.assign(getDraft(), id, slot); commit(next, draftOps.nextEmpty(next, slot));
      };
    }
    function renderSlots(side) {
      const draft = getDraft(); const slots = $('#' + side); slots.replaceChildren();
      for (let index = 0; index < 5; index++) {
        const slot = { side, index }; const champion = byId.get(draft[side][index]);
        const wrap = node('div', 'draft-slot' + (draftOps.same(target, slot) ? ' is-next' : '') + (draftOps.same(moving, slot) ? ' is-moving' : ''));
        const pickSlot = control('', 'slot-pick', () => select(slot)); pickSlot.id = 'draft-' + side + '-' + index;
        pickSlot.setAttribute('aria-label', slotName(slot) + (champion ? '：' + champion.name + '，可拖动或点击移动' : '：空位，点击指定')); pickSlot.setAttribute('aria-pressed', String(draftOps.same(target, slot)));
        if (champion) { pickSlot.append(image(champion), node('span', 'slot-name', champion.name)); draggable(pickSlot, champion.id); }
        else pickSlot.append(node('span', 'slot-empty', '+'), node('span', 'slot-name', '待选'));
        pickSlot.append(node('span', 'slot-role', draftOps.roles[index].name)); wrap.append(pickSlot); dropTarget(wrap, slot);
        if (champion) {
          const remove = control('×', 'slot-remove', event => { event.stopPropagation(); commit(draftOps.remove(getDraft(), slot), slot); });
          remove.setAttribute('aria-label', '移除' + slotName(slot) + '的' + champion.name); wrap.append(remove);
        }
        slots.append(wrap);
      }
    }
    function renderSummary() {
      const draft = getDraft(); $('#summary-count').textContent = draftOps.count(draft) + '/10';
      for (const side of ['ally', 'enemy']) {
        const row = $('#summary-' + side); row.replaceChildren();
        for (let index = 0; index < 5; index++) {
          const slot = { side, index }; const champion = byId.get(draft[side][index]);
          const item = control('', 'summary-slot', () => { target = slot; moving = null; lastDraft = getDraft(); onOpen(); });
          item.title = slotName(slot) + (champion ? ' · ' + champion.name : ' · 待选'); item.setAttribute('aria-label', '编辑' + item.title);
          if (champion) item.append(image(champion)); else item.append(node('span', 'summary-empty', '+'));
          item.append(node('span', 'summary-name', champion?.name || '待选'), node('span', 'summary-role', draftOps.roles[index].name)); row.append(item);
        }
      }
    }
    function renderPool() {
      const draft = getDraft(); const query = $('#search').value.trim().toLowerCase(); const pool = $('#champions'); pool.replaceChildren();
      const visible = champions.filter(champion => (filter === 'all' || champion.roles.includes(filter)) &&
        (!query || [champion.id, champion.name, champion.title, champion.englishName, ...(champion.aliases || [])].join(' ').toLowerCase().includes(query)));
      for (const champion of visible) {
        const picked = draftOps.locate(draft, champion.id); const pickButton = control('', 'champion' + (picked ? ' is-picked' : ''), () => pick(champion.id));
        pickButton.id = 'hero-' + champion.id; pickButton.title = champion.name + ' · ' + champion.title;
        pickButton.setAttribute('aria-label', '选择' + champion.name); pickButton.setAttribute('aria-pressed', String(!!picked));
        pickButton.append(image(champion), node('span', 'champion-name', champion.name));
        if (picked) pickButton.append(node('span', 'picked-tag', (picked.side === 'ally' ? '我' : '敌') + '·' + draftOps.roles[picked.index].name));
        draggable(pickButton, champion.id); pool.append(pickButton);
      }
      $('#hero-count').textContent = visible.length + ' / ' + champions.length + ' 位英雄';
      if (!visible.length) pool.append(node('p', 'empty-champions', '没有找到匹配英雄，试试中文名、称号或英文名。'));
    }
    function render() {
      const draft = getDraft();
      if (draft !== lastDraft) { lastDraft = draft; target = draftOps.nextEmpty(draft); moving = null; }
      const count = draftOps.count(draft);
      $('#bp-count').textContent = count + '/10';
      $('#draft-label').textContent = count ? `我方 ${draftOps.count(draft, 'ally')} · 敌方 ${draftOps.count(draft, 'enemy')}` : '添加阵容';
      $('#composer-bp').classList.toggle('active', count > 0);
      $('#ally-count').textContent = draftOps.count(draft, 'ally') + '/5'; $('#enemy-count').textContent = draftOps.count(draft, 'enemy') + '/5';
      $('#pick-hint').textContent = moving ? '已选中' + slotName(moving) + '，点另一个位置可移动或交换，也可以直接选新英雄替换。'
        : target ? '下一位：' + slotName(target) + ' · 点击英雄自动交替填充，也可拖动调整。' : '阵容已选满 · 拖动交换位置，或点一个位置替换英雄。';
      renderSlots('ally'); renderSlots('enemy'); renderSummary(); renderPool();
    }
    const filters = $('#hero-filters');
    for (const role of [{ id: 'all', name: '全部英雄' }, ...draftOps.roles]) {
      const tab = control(role.name, 'hero-filter', () => { filter = role.id; for (const item of filters.children) item.setAttribute('aria-pressed', String(item === tab)); renderPool(); });
      tab.setAttribute('aria-pressed', String(role.id === 'all')); filters.append(tab);
    }
    $('#search').oninput = renderPool;
    $('#reset').onclick = () => commit(draftOps.empty(), { side: 'ally', index: 0 });
    $('#summary-edit').onclick = onOpen;
    const compact = matchMedia('(max-width: 1100px)');
    const updateSummary = () => { $('#summary-details').open = !compact.matches; };
    compact.addEventListener('change', updateSummary); updateSummary();
    return Object.freeze({ render });
  }
  return Object.freeze({ create });
})();
