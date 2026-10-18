'use strict';
(() => {
  const results = [];
  function assert(condition, message) { if (!condition) throw new Error(message); }
  function render(source) { const target = document.createElement('div'); target.className = 'reply-text'; window.GameCoachMarkdown.renderInto(target, source); return target; }
  function test(name, run) {
    let error;
    try { run(); } catch (failure) { error = failure.message; }
    const result = document.createElement('li'); result.dataset.pass = String(!error);
    result.textContent = (error ? 'FAIL ' : 'PASS ') + name + (error ? '：' + error : '');
    document.querySelector('#results').append(result); results.push(!error);
  }
  test('真实浏览器依赖已加载', () => {
    assert(typeof window.marked?.parse === 'function', 'Marked 未加载'); assert(window.DOMPurify?.isSupported, 'DOMPurify 未加载');
  });
  test('标题、中文加粗、斜体、删除线与换行', () => {
    const target = render('## 阵容结论\n\n**先保金克丝**，再考虑*反打*，~~盲目开团~~。\n第二行');
    assert(target.querySelector('h2')?.textContent === '阵容结论', '标题未渲染');
    assert(target.querySelector('strong')?.textContent === '先保金克丝', '加粗未渲染');
    assert(target.querySelector('em')?.textContent === '反打' && target.querySelector('del'), '强调未渲染');
    assert(target.querySelector('br'), '单换行未保留');
  });
  test('有序、无序与嵌套列表', () => {
    const target = render('1. 第一项\n2. 第二项\n   - 子项一\n   - 子项二');
    assert(target.querySelectorAll('ol > li').length === 2, '有序列表错误'); assert(target.querySelectorAll('ol li ul li').length === 2, '嵌套列表错误');
  });
  test('引用、分隔线、行内代码和围栏代码块', () => {
    const target = render('> 提醒：先看对方开团技能。\n\n---\n\n行内 `const x = 1`\n\n```html\n<img src=x onerror=alert(1)>\n```');
    assert(target.querySelector('blockquote') && target.querySelector('hr'), '引用或分隔线错误');
    assert(target.querySelectorAll('code').length === 2, '代码片段错误');
    assert(target.querySelector('pre code')?.textContent.includes('<img src=x onerror=alert(1)>'), '代码没有按原文保留');
    assert(!target.querySelector('img'), '代码中的 HTML 被执行为元素');
  });
  test('表格有列标题和独立横向滚动区域', () => {
    const target = render('| 英雄 | 作用 |\n| --- | --- |\n| 露露 | 保护 |\n| 蕾欧娜 | 控制 |');
    assert(target.querySelectorAll('thead th[scope="col"]').length === 2, '列标题错误');
    assert(target.querySelectorAll('tbody tr').length === 2, '数据行错误');
    assert(target.querySelector('.table-scroll[tabindex="0"][role="region"] > table'), '表格缺少可键盘访问的滚动区域');
  });
  test('普通链接可用且新页面没有 opener', () => {
    const target = render('[说明](https://example.com/docs "说明")'); const link = target.querySelector('a');
    assert(link?.getAttribute('href') === 'https://example.com/docs', '链接错误');
    assert(link.target === '_blank' && link.rel.includes('noopener') && link.rel.includes('noreferrer'), '链接未隔离');
  });
  test('危险协议、内联事件、HTML 脚本和表单无法进入回复 DOM', () => {
    const target = render('<script>alert(1)</script><svg onload="alert(1)"></svg><iframe src="https://example.com"></iframe><form><input name="x"></form>\n\n<a href="javascript:alert(1)" onclick="alert(1)" id="account-open">危险链接</a>\n\n[坏链接](data:text/html,test)');
    assert(!target.querySelector('script, svg, iframe, form, input, img, style'), '危险标签仍存在');
    assert(!target.querySelector('[onclick], [onload], [id], [style]'), '危险属性或可覆盖页面 ID 仍存在');
    assert([...target.querySelectorAll('a')].every(link => !link.hasAttribute('href')), '危险协议仍存在');
  });
  test('同一节点接收半截 Markdown 后可以继续完成', () => {
    const target = render('**先保'); window.GameCoachMarkdown.renderInto(target, '**先保金克丝**\n\n- 再反打');
    assert(target.querySelector('strong')?.textContent === '先保金克丝', '流式补全加粗失败');
    assert(target.querySelectorAll('li').length === 1 && target.textContent.includes('再反打'), '流式列表失败');
  });
  test('依赖缺失时安全回退成纯文本，恢复后可重新渲染', () => {
    const purify = window.DOMPurify; const target = document.createElement('div');
    try {
      window.DOMPurify = undefined; window.GameCoachMarkdown.renderInto(target, '<b onclick="alert(1)">text</b>');
      assert(!target.querySelector('b') && target.classList.contains('is-plain'), '回退没有使用纯文本');
    } finally { window.DOMPurify = purify; }
    window.GameCoachMarkdown.renderInto(target, '**恢复**');
    assert(target.querySelector('strong') && !target.classList.contains('is-plain'), '渲染未恢复');
  });
  const passed = results.filter(Boolean).length;
  document.querySelector('#summary').textContent = `${passed}/${results.length} 项通过`;
  document.querySelector('#summary').dataset.passed = String(passed === results.length);
  window.GameCoachMarkdown.renderInto(document.querySelector('#sample'), '## 阵容分析示例\n\n**结论：先保护金克丝，等对方进场后反打。**\n\n1. 露露、娜美保留关键保护技能。\n2. 蕾欧娜优先限制突进英雄。\n\n> 这是界面验证用的示例，不是模型分析结果。\n\n| 阶段 | 目标 |\n| --- | --- |\n| 前期 | 稳定发育 |\n| 团战 | 保护后排 |\n\n```text\n先观察 → 再保护 → 后反打\n```');
})();
