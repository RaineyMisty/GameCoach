'use strict';
// Game sources are separate classic scripts so GitHub Pages and file:// both work.
window.GameCoachGames = (() => {
  const list = Object.freeze(Object.values(window.GAMECOACH_SOURCES || {}).map(game => Object.freeze(game)));
  const has = id => list.some(game => game.gameId === id);
  const resolve = id => has(id) ? id : 'lolm';
  const localize = game => {
    const i18n = window.GameCoachI18n;
    if (!i18n || i18n.locale !== 'en') return game;
    return { ...game, name: i18n.t(game.name), platform: game.gameId === 'lol' ? 'PC' : 'Mobile',
      description: game.gameId === 'lol' ? 'League of Legends · PC' : 'League of Legends: Wild Rift · Mobile',
      champions: game.champions.map(i18n.champion) };
  };
  const get = id => localize(list.find(game => game.gameId === resolve(id)));
  return Object.freeze({ get list() { return list.map(localize); }, has, resolve, get });
})();
// Compatibility alias for existing integrations. The UI uses GameCoachGames.
window.GAMECOACH_DATA = window.GameCoachGames.get('lolm');
