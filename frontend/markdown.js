'use strict';

// Render model output only after sanitizing it. Stored messages stay plain Markdown.
window.GameCoachMarkdown = (() => {
  const allowedTags = ['p', 'br', 'strong', 'em', 'del', 's', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'hr', 'table', 'caption', 'thead', 'tbody', 'tr', 'th', 'td', 'a'];
  function renderInto(target, value) {
    const source = typeof value === 'string' ? value : '';
    // If a script fails to load, keep readable text instead of inserting raw HTML.
    if (!window.marked?.parse || !window.DOMPurify?.isSupported) {
      target.classList.add('is-plain'); target.textContent = source; return;
    }
    let fragment;
    try {
      const html = window.marked.parse(source, { async: false, gfm: true, breaks: true });
      fragment = window.DOMPurify.sanitize(html, {
        ALLOWED_TAGS: allowedTags, ALLOWED_ATTR: ['href', 'title', 'start', 'align'],
        ALLOW_DATA_ATTR: false, ALLOW_ARIA_ATTR: false, RETURN_DOM_FRAGMENT: true,
      });
    } catch {
      target.classList.add('is-plain'); target.textContent = source; return;
    }
    for (const link of fragment.querySelectorAll('a')) {
      const href = link.getAttribute('href');
      try {
        if (!href || !['http:', 'https:', 'mailto:'].includes(new URL(href, document.baseURI).protocol)) {
          link.removeAttribute('href'); continue;
        }
        link.setAttribute('target', '_blank'); link.setAttribute('rel', 'noopener noreferrer');
      } catch { link.removeAttribute('href'); }
    }
    for (const table of fragment.querySelectorAll('table')) {
      const scroll = document.createElement('div'); scroll.className = 'table-scroll';
      scroll.tabIndex = 0; scroll.setAttribute('role', 'region'); scroll.setAttribute('aria-label', '回复表格，可横向滚动');
      table.replaceWith(scroll); scroll.append(table);
      for (const heading of table.querySelectorAll('thead th')) heading.setAttribute('scope', 'col');
    }
    target.classList.remove('is-plain'); target.replaceChildren(fragment);
  }
  return Object.freeze({ renderInto });
})();
