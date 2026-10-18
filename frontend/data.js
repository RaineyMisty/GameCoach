'use strict';
// Game sources are separate classic scripts so GitHub Pages and file:// both work.
window.GameCoachGames = (() => {
  const list = Object.freeze(Object.values(window.GAMECOACH_SOURCES || {}).map(game => Object.freeze(game)));
  const has = id => list.some(game => game.gameId === id);
  const resolve = id => has(id) ? id : 'lolm';
  const get = id => list.find(game => game.gameId === resolve(id));
  return Object.freeze({ list, has, resolve, get });
})();
// Compatibility alias for existing integrations. The UI uses GameCoachGames.
window.GAMECOACH_DATA = window.GameCoachGames.get('lolm');
