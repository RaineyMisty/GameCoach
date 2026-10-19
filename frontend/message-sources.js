'use strict';

window.GameCoachMessageSources = (() => {
  const tr = (...args) => window.GameCoachI18n ? window.GameCoachI18n.t(...args) : args[0].replace(/\{(\d+)\}/g, (_, i) => args[Number(i) + 1]);
  function render(message) {
    const section = document.createElement('div'); section.className = 'message-sources';
    const sources = message.sources || [];
    if (sources.length) {
      const details = document.createElement('details'); const summary = document.createElement('summary');
      summary.textContent = tr("资料来源 · ") + (message.searched ? tr("包含联网结果") : tr("本地官方快照")); details.append(summary);
      const list = document.createElement('ul');
      for (const source of sources) {
        try {
          const url = new URL(source.url); if (!['https:', 'http:'].includes(url.protocol)) continue;
          const item = document.createElement('li'), link = document.createElement('a');
          link.href = url.href; link.target = '_blank'; link.rel = 'noopener noreferrer';
          link.textContent = (source.kind === 'web' ? tr("联网 · ") : tr("本地 · ")) + source.title + (source.version ? ' · ' + source.version : ''); item.append(link);
          if (source.fetchedOn) item.append(document.createTextNode(tr("（采集 ") + source.fetchedOn + '）')); list.append(item);
        } catch {}
      }
      details.append(list); section.append(details);
    }
    if (message.searchSuggestions) {
      // Google 要求展示实际返回的搜索建议。隔离 HTML，不执行其中脚本或表单。
      const frame = document.createElement('iframe'); frame.className = 'search-suggestions'; frame.title = tr("Google 搜索建议");
      frame.setAttribute('sandbox', 'allow-popups'); frame.referrerPolicy = 'no-referrer';
      frame.srcdoc = window.DOMPurify.sanitize(message.searchSuggestions, { WHOLE_DOCUMENT: true,
        ADD_ATTR: ['target'], FORBID_TAGS: ['script', 'iframe', 'form', 'object', 'embed', 'base', 'meta'] });
      section.append(frame);
    }
    return section;
  }
  return Object.freeze({ render });
})();
