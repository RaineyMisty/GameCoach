'use strict';
(() => {
  let failed = 0, passed = 0;
  function check(name, value) {
    const row = document.createElement('li'); row.textContent = (value ? '通过：' : '失败：') + name;
    document.getElementById('checks').append(row); if (value) passed++; else failed++;
  }
  const section = window.GameCoachMessageSources.render({ searched: true,
    sources: [{ kind: 'local', title: '<img onerror=alert(1)> 本地技能快照', version: '7.3', fetchedOn: '2026-10-18', url: 'https://example.org/local' },
      { kind: 'web', title: '模拟联网来源', url: 'https://example.org/web' }, { title: 'unsafe', url: 'javascript:alert(1)' }],
    searchSuggestions: '<html><head><style>body{font:14px sans-serif}</style></head><body>模拟 Google 搜索建议<script>alert(1)</script><a href="javascript:alert(1)" onclick="alert(1)">危险链接</a><form><input></form><a href="https://example.org/" target="_blank">普通链接</a></body></html>' });
  document.getElementById('fixture').append(section); section.querySelector('details').open = true;
  const links = section.querySelectorAll('li a'), frame = section.querySelector('iframe');
  const doc = new DOMParser().parseFromString(frame.srcdoc, 'text/html');
  check('区分本地与联网来源，过滤危险地址', links.length === 2 && links[0].textContent.includes('本地') && links[1].textContent.includes('联网'));
  check('来源标题作为纯文字展示', !section.querySelector('img'));
  check('外部来源使用安全的新窗口链接', [...links].every(link => link.target === '_blank' && link.rel.includes('noopener')));
  check('搜索建议放在隔离 iframe', frame.getAttribute('sandbox') === 'allow-popups' && frame.referrerPolicy === 'no-referrer');
  check('搜索建议移除脚本、表单和事件属性', !doc.querySelector('script,form,[onclick],[onerror]'));
  check('搜索建议过滤 javascript 地址并保留正常链接', !doc.querySelector('a[href^="javascript:"]') && !!doc.querySelector('a[href="https://example.org/"]'));
  document.getElementById('result').textContent = passed + ' 项通过，' + failed + ' 项失败';
})();
