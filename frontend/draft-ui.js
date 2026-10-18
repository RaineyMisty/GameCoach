'use strict';
window.GameCoachDraftUI = (() => {
  function create({ champions, getDraft, onChange }) {
    const $ = selector => document.querySelector(selector);
    const draftOps = window.GameCoachDraft;
    let byId = new Map(champions.map(champion => [champion.id, champion]));
    function setChampions(next) {
      champions = next; byId = new Map(next.map(champion => [champion.id, champion])); banTarget = null; filter = 'all'; $('#search').value = '';
      for (const tab of $('#hero-filters').children) tab.setAttribute('aria-pressed', String(tab.textContent === '全部英雄'));
    }
    let dragging = null; let filter = 'all'; let banTarget = null;
    function node(tag, className, text) { const value = document.createElement(tag); if (className) value.className = className; if (text !== undefined) value.textContent = text; return value; }
    function control(label, className, action) { const value = node('button', className, label); value.type = 'button'; value.onclick = action; return value; }
    function image(champion) {
      const img = node('img'); img.src = champion.portrait; img.alt = ''; img.loading = 'lazy'; img.decoding = 'async'; img.draggable = false;
      img.onerror = () => { img.onerror = null; img.src = 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2264%22 height=%2264%22%3E%3C/svg%3E'; }; return img;
    }
    const slotName = slot => (slot.side === 'ally' ? '蓝方' : '红方') + (slot.kind === 'ban' ? '禁用位 ' + (slot.index + 1)
      : getDraft().bpMode ? '选人位 ' + (slot.index + 1) : draftOps.roles[slot.index].name);
    function commit(next) { onChange(next); }
    const autoTarget = draft => draft.bpMode ? draftOps.nextAction(draft)?.slot || null : draftOps.nextEmpty(draft);
    const currentTarget = draft => banTarget || autoTarget(draft);
    function removePick(id, selectedSlot) {
      const draft = getDraft();
      const selectedRow = selectedSlot?.kind === 'ban' ? draft.bans?.[selectedSlot.side] : draft[selectedSlot?.side];
      const slot = selectedSlot && selectedRow?.[selectedSlot.index] === id ? selectedSlot
        : selectedSlot ? null : draftOps.locate(draft, id, 'enemy') || draftOps.locate(draft, id, 'ally')
          || (draft.bpMode && draftOps.activeBan(draft, id) ? draftOps.locate(draft, id, undefined, 'ban') : null);
      if (slot) commit(draftOps.remove(getDraft(), slot));
    }
    function cancelOnRightClick(element, id, slot) {
      element.oncontextmenu = event => {
        event.preventDefault(); event.stopPropagation(); removePick(id, slot);
      };
    }
    function pick(id) {
      const draft = getDraft();
      // Always fill the earliest hole; deletion, focus and dragging never set a cursor.
      const target = currentTarget(draft);
      if (!target) { $('#pick-hint').textContent = '当前流程已填满，可右键取消选择，或拖动英雄替换。'; return; }
      if (target.kind !== 'ban' && draftOps.locate(draft, id, draft.bpMode ? undefined : target.side)) {
        $('#pick-hint').textContent = draft.bpMode ? 'BP 模式双方不能选择重复英雄。'
          : (target.side === 'ally' ? '蓝方' : '红方') + '已有该英雄，请选其他英雄；双方可以选择同一英雄。'; return;
      }
      try {
        const next = target.kind === 'ban' ? draftOps.assignBan(draft, id, target) : draftOps.assign(draft, id, target);
        banTarget = null; commit(next);
      }
      catch (error) { $('#pick-hint').textContent = error.message; return; }
      document.getElementById('hero-' + id)?.focus({ preventScroll: true });
    }
    function draggable(element, id, from = null) {
      element.draggable = true;
      element.ondragstart = event => {
        dragging = { id, from }; element.classList.add('is-dragging');
        event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('application/x-gamecoach-champion', id); event.dataTransfer.setData('text/plain', id);
      };
      element.ondragend = () => { dragging = null; element.classList.remove('is-dragging'); for (const slot of document.querySelectorAll('.drop-ready')) slot.classList.remove('drop-ready'); };
    }
    function dropTarget(element, slot) {
      element.ondragover = event => { if (!dragging || !byId.has(dragging.id)) return; event.preventDefault(); event.dataTransfer.dropEffect = 'move'; element.classList.add('drop-ready'); };
      element.ondragleave = event => { if (!element.contains(event.relatedTarget)) element.classList.remove('drop-ready'); };
      element.ondrop = event => {
        event.preventDefault(); element.classList.remove('drop-ready');
        const source = dragging; dragging = null;
        if (!source || !byId.has(source.id)) return;
        try {
          const draft = getDraft();
          const next = source.from ? draftOps.move(draft, source.from, slot) : slot.kind === 'ban'
            ? draftOps.assignBan(draft, source.id, slot) : draftOps.assign(draft, source.id, slot);
          commit(next);
        } catch (error) { $('#pick-hint').textContent = error.message; }
      };
    }
    function renderSlots(side) {
      const draft = getDraft(); const target = currentTarget(draft); const slots = $('#' + side); slots.replaceChildren();
      for (let index = 0; index < 5; index++) {
        const slot = { side, index }; const champion = byId.get(draft[side][index]);
        const wrap = node('div', 'draft-slot' + (draftOps.same(target, slot) ? ' is-next' : ''));
        const pickSlot = control('', 'slot-pick', () => { banTarget = null; render(); }); pickSlot.id = 'draft-' + side + '-' + index;
        pickSlot.setAttribute('aria-label', slotName(slot) + (champion ? '：' + champion.name + '，可拖动或右键取消选择' : '：空位，可拖入英雄')); pickSlot.setAttribute('aria-pressed', String(draftOps.same(target, slot)));
        if (champion) { pickSlot.append(image(champion), node('span', 'slot-name', champion.name)); draggable(pickSlot, champion.id, slot); cancelOnRightClick(pickSlot, champion.id, slot); }
        else pickSlot.append(node('span', 'slot-empty', '+'), node('span', 'slot-name', '待选'));
        wrap.append(pickSlot, node('span', 'slot-role', draftOps.roles[index].name)); dropTarget(pickSlot, slot);
        if (champion) {
          const remove = control('×', 'slot-remove', event => { event.stopPropagation(); removePick(champion.id, slot); });
          remove.setAttribute('aria-label', '移除' + slotName(slot) + '的' + champion.name); wrap.append(remove);
        }
        slots.append(wrap);
      }
    }
    function renderBans(side) {
      const draft = getDraft(); const slots = $('#ban-' + side); slots.replaceChildren();
      const limit = draftOps.banLimit(draft); const target = currentTarget(draft);
      slots.style.setProperty('--ban-slots', limit);
      $('#ban-count-' + side).textContent = (draft.bans?.[side] || []).slice(0, limit).filter(Boolean).length + '/' + limit;
      for (let index = 0; index < limit; index++) {
        const slot = { side, index, kind: 'ban' }; const champion = byId.get(draft.bans?.[side]?.[index]);
        const wrap = node('div', 'draft-slot ban-slot' + (draftOps.same(target, slot) ? ' is-next' : ''));
        const button = control('', 'slot-pick ban-pick', () => { banTarget = draftOps.same(banTarget, slot) ? null : slot; render(); });
        button.id = 'ban-' + side + '-' + index; button.setAttribute('aria-pressed', String(draftOps.same(target, slot)));
        button.setAttribute('aria-label', slotName(slot) + (champion ? '：' + champion.name + '，可拖动或右键取消禁用' : '：空位，点击后选择禁用英雄'));
        if (champion) { button.append(image(champion), node('span', 'slot-name', champion.name)); draggable(button, champion.id, slot); cancelOnRightClick(button, champion.id, slot); }
        else button.append(node('span', 'slot-empty', '−'));
        wrap.append(button); dropTarget(button, slot);
        if (champion) {
          const remove = control('×', 'slot-remove', event => { event.stopPropagation(); removePick(champion.id, slot); });
          remove.setAttribute('aria-label', '取消' + slotName(slot) + '的' + champion.name); wrap.append(remove);
        }
        slots.append(wrap);
      }
    }
    function renderSummary() {
      const draft = getDraft(); let hasBans = false;
      for (const side of ['ally', 'enemy']) {
        const bans = $('#summary-bans-' + side); bans.replaceChildren();
        const ids = draft.bpMode ? (draft.bans?.[side] || []).slice(0, draftOps.banLimit(draft)) : [];
        for (const id of ids) {
          const champion = byId.get(id); if (!champion) continue;
          const item = node('span', 'summary-slot summary-ban'); item.setAttribute('role', 'img');
          item.setAttribute('aria-label', (side === 'ally' ? '蓝方' : '红方') + '禁用：' + champion.name);
          item.append(image(champion)); bans.append(item);
        }
        bans.hidden = bans.childElementCount === 0; hasBans ||= !bans.hidden;
        const row = $('#summary-' + side); row.replaceChildren();
        for (let index = 0; index < 5; index++) {
          const slot = { side, index }; const champion = byId.get(draft[side][index]);
          const item = node('span', 'summary-slot');
          item.setAttribute('role', 'img'); item.setAttribute('aria-label', slotName(slot) + (champion ? '：' + champion.name : '：待选'));
          if (champion) item.append(image(champion)); else item.append(node('span', 'summary-empty'));
          row.append(item);
        }
      }
      $('.app-layout').classList.toggle('has-summary-bans', hasBans);
    }
    function renderPool() {
      const draft = getDraft(); const query = $('#search').value.trim().toLowerCase(); const pool = $('#champions'); pool.replaceChildren();
      const visible = champions.filter(champion => (filter === 'all' || champion.roles.includes(filter)) &&
        (!query || [champion.id, champion.name, champion.title, champion.englishName, ...(champion.aliases || [])].join(' ').toLowerCase().includes(query)));
      for (const champion of visible) {
        const picks = ['ally', 'enemy'].map(side => draftOps.locate(draft, champion.id, side)).filter(Boolean);
        const banned = draft.bpMode && draftOps.activeBan(draft, champion.id) ? draftOps.locate(draft, champion.id, undefined, 'ban') : null;
        const pickButton = control('', 'champion' + (picks.length ? ' is-picked' : ''), () => pick(champion.id));
        for (const picked of picks) pickButton.classList.add('picked-' + picked.side);
        if (banned) pickButton.classList.add('is-banned');
        pickButton.id = 'hero-' + champion.id; pickButton.title = champion.name + ' · ' + champion.title;
        pickButton.setAttribute('aria-label', '选择' + champion.name); pickButton.setAttribute('aria-pressed', String(picks.length > 0 || !!banned));
        pickButton.append(image(champion), node('span', 'champion-name', champion.name));
        if (picks.length || banned) {
          const tags = node('span', 'picked-tags');
          for (const picked of [...picks, ...(banned ? [banned] : [])]) {
            const label = picked.kind === 'ban' ? '禁用' : draft.bpMode ? '已选' : draftOps.roles[picked.index].name;
            const tag = node('span', 'picked-tag tag-' + picked.side, (picked.side === 'ally' ? '蓝' : '红') + '·' + label);
            tag.title = '右键取消' + slotName(picked) + '的' + champion.name;
            cancelOnRightClick(tag, champion.id, picked); tags.append(tag);
          }
          pickButton.append(tags);
          if (picks.length === 2) pickButton.title += ' · 双方已选；右键逐个取消（红方优先），也可右键蓝/红标记取消对应方';
        }
        draggable(pickButton, champion.id); cancelOnRightClick(pickButton, champion.id); pool.append(pickButton);
      }
      $('#hero-count').textContent = visible.length + ' / ' + champions.length + ' 位英雄';
      if (!visible.length) pool.append(node('p', 'empty-champions', '没有找到匹配英雄，试试中文名、称号或英文名。'));
    }
    function render() {
      const draft = getDraft();
      if (!draft.bpMode) banTarget = null;
      if (banTarget && banTarget.index >= draftOps.banLimit(draft)) banTarget = null;
      $('#bp-mode').checked = draft.bpMode === true;
      $('#bp-rule').hidden = !draft.bpMode; $('#bp-rule').value = draftOps.ruleFor(draft).id;
      $('#bp-rule-info').hidden = !draft.bpMode;
      const rule = draftOps.ruleFor(draft);
      $('#bp-rule-info').textContent = rule.type === 'split' ? '每方：3 Ban → 3 Pick → 2 Ban → 2 Pick · 选人按 1–2–2–1 / 1–2–1 分组'
        : '每方：' + rule.bans + ' Ban → 5 Pick · 选人按 1–2–2–2–2–1 分组';
      $('#bp-dialog').classList.toggle('is-bp', draft.bpMode === true);
      for (const row of document.querySelectorAll('[data-ban-row]')) row.hidden = !draft.bpMode;
      const target = currentTarget(draft); const action = draftOps.nextAction(draft);
      const count = draftOps.count(draft);
      $('#bp-count').textContent = count + '/10';
      $('#draft-label').textContent = count ? `蓝方 ${draftOps.count(draft, 'ally')} · 红方 ${draftOps.count(draft, 'enemy')}` : '添加阵容';
      $('#composer-bp').classList.toggle('active', count > 0);
      $('#ally-count').textContent = draftOps.count(draft, 'ally') + '/5'; $('#enemy-count').textContent = draftOps.count(draft, 'enemy') + '/5';
      $('#pick-hint').textContent = banTarget ? '手动禁用：' + slotName(banTarget) + ' · 选一个英雄后回到自动流程；点击选人位返回自动流程。'
        : draft.bpMode ? action ? '第 ' + action.step + '/' + action.total + ' 步 · ' + action.phase + ' · 下一位：' + slotName(action.slot) + '。'
          : 'BP 已完成 · 可拖动修正，或右键取消选择。'
        : target ? '下一位：' + slotName(target) + ' · 从左侧空位依次填充；右键取消，拖动换位。'
        : '阵容已选满 · 右键取消选择，或拖动英雄换位、替换。';
      renderSlots('ally'); renderSlots('enemy'); renderBans('ally'); renderBans('enemy'); renderSummary(); renderPool();
    }
    const filters = $('#hero-filters');
    for (const role of [{ id: 'all', name: '全部英雄' }, ...draftOps.roles]) {
      const tab = control(role.name, 'hero-filter', () => { filter = role.id; for (const item of filters.children) item.setAttribute('aria-pressed', String(item === tab)); renderPool(); });
      tab.setAttribute('aria-pressed', String(role.id === 'all')); filters.append(tab);
    }
    $('#search').oninput = renderPool;
    for (const rule of draftOps.rules) { const option = node('option', '', rule.name); option.value = rule.id; $('#bp-rule').append(option); }
    $('#bp-rule').onchange = event => { banTarget = null; commit(draftOps.setRule(getDraft(), event.target.value)); };
    $('#reset').onclick = () => { banTarget = null; commit(draftOps.clear(getDraft())); };
    $('#bp-mode').onchange = event => {
      const previous = getDraft(); const next = draftOps.setBPMode(previous, event.target.checked); banTarget = null;
      const removed = draftOps.count(previous) - draftOps.count(next); commit(next);
      if (removed) $('#pick-hint').textContent = '已开启 BP 模式：保留蓝方英雄，清除了 ' + removed + ' 个红方重复选择。';
    };
    return Object.freeze({ render, setChampions });
  }
  return Object.freeze({ create });
})();
