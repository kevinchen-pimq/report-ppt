// 極簡事件匯流排 (event bus)
//
//   import { bus } from './events.js';
//   bus.on('player:hurt', (amount, hp) => { ... });
//   bus.emit('player:hurt', 10, 90);
//   bus.off('player:hurt', fn);
//
// 目前已使用的事件：
//   'game:start'      (mode: 'desktop' | 'vr')
//   'game:pause'      ()
//   'game:resume'     ()
//   'player:hurt'     (amount, hp)
//   'player:heal'     (amount, hp)
//   'player:dead'     ()
//   'player:levelup'  (level)
//   'player:exp'      (gained, exp, expToNext)
//   'player:col'      (gained, col)
//   'player:respawn'  ()
//   'player:mode'     (mode)

const listeners = new Map();

export const bus = {
  on(evt, fn) {
    if (!listeners.has(evt)) listeners.set(evt, new Set());
    listeners.get(evt).add(fn);
    return () => bus.off(evt, fn);
  },
  off(evt, fn) {
    const set = listeners.get(evt);
    if (set) set.delete(fn);
  },
  emit(evt, ...args) {
    const set = listeners.get(evt);
    if (!set) return;
    // 複製一份以允許在回呼中 off()
    for (const fn of [...set]) {
      try {
        fn(...args);
      } catch (err) {
        console.error(`[bus] listener for "${evt}" threw`, err);
      }
    }
  },
};
