/* STARFORGE boot: wire the canvas to input and start the loop. Two URL
   switches exist for the maker's own testing and screenshots:
   ?demo=1 starts the autopilot playing (the title's attract mode, live), and
   ?demo=1&kamikaze=1 makes the autopilot fly into the swarm without firing,
   which reaches the game-over screen honestly by playing badly. */
'use strict';

(function boot() {
  const canvas = document.getElementById('game');
  Input.attach(canvas);
  Game.init(canvas);
  const params = new URLSearchParams(window.location.search);
  if (params.get('shot') === '1') document.body.classList.add('shot');
  if (params.get('demo') === '1') {
    Game.setDemo(true, {
      kamikaze: params.get('kamikaze') === '1',
      holdShop: params.get('shop') === 'hold',
    });
  }
  window.STARFORGE = Game;
})();
