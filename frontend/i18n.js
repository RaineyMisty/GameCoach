'use strict';

// UI language is a browser preference, independent of local users and API keys.
window.GameCoachI18n = (() => {
  const key = 'gamecoach-language';
  const dictionary = window.GAMECOACH_ENGLISH || {};
  let locale = 'en';
  try { if (localStorage.getItem(key) === 'zh-CN') locale = 'zh-CN'; } catch {}
  const t = (source, ...values) => (locale === 'en' && Object.hasOwn(dictionary, source) ? dictionary[source] : source)
    .replace(/\{(\d+)\}/g, (_, index) => String(values[Number(index)] ?? ''));
  const nodes = [], attributes = [];
  // Capture only the original HTML. Chat text, user names, input values and
  // user-authored memories are never scanned or machine-translated.
  function capture() {
    if (typeof document === 'undefined') return;
    const walker = document.createTreeWalker(document.documentElement, 4);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (/[\u3400-\u9fff]/.test(node.data) && !node.parentElement.closest('script,style')) nodes.push([node, node.data]);
    }
    for (const element of document.querySelectorAll('*')) for (const attr of ['aria-label', 'title', 'placeholder', 'data-prompt']) {
      const value = element.getAttribute(attr);
      if (value && /[\u3400-\u9fff]/.test(value)) attributes.push([element, attr, value]);
    }
  }
  function apply() {
    if (typeof document === 'undefined') return;
    document.documentElement.lang = locale;
    document.title = t('GameCoach · 你的游戏教练');
    for (const [node, source] of nodes) if (node.isConnected) {
      const trimmed = source.trim(); node.data = source.replace(trimmed, t(trimmed));
    }
    for (const [element, attr, source] of attributes) if (element.isConnected) element.setAttribute(attr, t(source));
    const select = document.getElementById('language'); if (select) select.value = locale;
  }
  function setLocale(value) {
    if (!['en', 'zh-CN'].includes(value) || value === locale) return;
    // Stop using the old response language before updating any labels.
    window.dispatchEvent(new Event('gamecoach:language-changing'));
    locale = value;
    try { localStorage.setItem(key, locale); } catch {}
    apply(); window.dispatchEvent(new CustomEvent('gamecoach:language-changed', { detail: { locale } }));
  }
  const champion = (hero) => {
    if (!hero || locale !== 'en') return hero;
    const official = window.GAMECOACH_ENGLISH_CHAMPIONS?.[hero.id];
    return { ...hero, name: official?.name || hero.englishName || hero.name, title: official?.title || hero.title };
  };
  capture(); apply();
  if (typeof document !== 'undefined') document.getElementById('language')?.addEventListener('change', event => setLocale(event.target.value));
  return Object.freeze({ t, setLocale, get locale() { return locale; }, champion });
})();
