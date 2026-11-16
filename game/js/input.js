/* STARFORGE input: keyboard state, mouse position in canvas coordinates and
   edge-triggered presses (so menus read one clean tap per key). The demo
   autopilot writes into the same shape, which is how the title screen's
   attract mode plays the game with nobody at the keys. */
'use strict';

const Input = (() => {
  const keys = Object.create(null);
  const pressed = Object.create(null);
  const mouse = { x: 640, y: 400, down: false, clicked: false };
  let canvas = null;

  function toCanvas(evt) {
    const rect = canvas.getBoundingClientRect();
    mouse.x = (evt.clientX - rect.left) * (canvas.width / rect.width);
    mouse.y = (evt.clientY - rect.top) * (canvas.height / rect.height);
  }

  function attach(el) {
    canvas = el;
    window.addEventListener('keydown', (e) => {
      const k = e.key.toLowerCase();
      if (!keys[k]) pressed[k] = true;
      keys[k] = true;
      if ([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) e.preventDefault();
      Sfx.unlock();
    });
    window.addEventListener('keyup', (e) => { keys[e.key.toLowerCase()] = false; });
    canvas.addEventListener('mousemove', toCanvas);
    canvas.addEventListener('mousedown', (e) => {
      toCanvas(e);
      mouse.down = true;
      mouse.clicked = true;
      Sfx.unlock();
    });
    window.addEventListener('mouseup', () => { mouse.down = false; });
    canvas.addEventListener('touchstart', (e) => {
      if (e.touches.length) toCanvas(e.touches[0]);
      mouse.down = true;
      mouse.clicked = true;
    }, { passive: true });
    canvas.addEventListener('touchmove', (e) => {
      if (e.touches.length) toCanvas(e.touches[0]);
    }, { passive: true });
    canvas.addEventListener('touchend', () => { mouse.down = false; }, { passive: true });
  }

  function endFrame() {
    for (const k in pressed) pressed[k] = false;
    mouse.clicked = false;
  }

  return {
    attach,
    endFrame,
    mouse,
    down(...names) { return names.some((n) => !!keys[n]); },
    hit(...names) { return names.some((n) => !!pressed[n]); },
    axis() {
      const x = (this.down('d', 'arrowright') ? 1 : 0) - (this.down('a', 'arrowleft') ? 1 : 0);
      const y = (this.down('s', 'arrowdown') ? 1 : 0) - (this.down('w', 'arrowup') ? 1 : 0);
      return { x, y };
    },
  };
})();
