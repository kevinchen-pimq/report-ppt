// Practice mode on the web page: the options on the 歌曲 tab (on / off, start position, speed)
// and the bar at the bottom of the screen while a practice run plays on the computer.
import { fmtTime, fmtRate, RATE_MIN, RATE_MAX } from './game/Practice.js';

const $ = (id) => document.getElementById(id);

/** No focus on click: Space / arrow keys keep controlling the game, not the button. */
function noFocus(el) {
  el.addEventListener('pointerdown', (e) => e.preventDefault());
}

/**
 * getCurrent() -> the selected song on the 歌曲 tab ({ entry, preview: { map } } or null).
 * Returns { sync() } to call when the selection changes.
 */
export function initPracticeUI(game, getCurrent) {
  const pr = game.practice;

  // ----- 歌曲 tab ---------------------------------------------------------------
  const on = $('practice-on');
  const opts = $('practice-opts');
  const start = $('practice-start');
  const startOut = $('practice-start-out');

  const startText = (s) => (s > 0 ? `${fmtTime(s)} / ${fmtTime(Number(start.max))}` : '從頭開始');

  function sync() {
    const cur = getCurrent();
    on.checked = pr.enabled;
    opts.hidden = !pr.enabled;
    const max = Math.max(1, Math.floor(cur?.preview?.map?.lastTime || 0));
    start.max = String(max);
    const s = Math.min(pr.startFor(cur?.entry?.key), max);
    if (document.activeElement !== start) start.value = String(s);
    startOut.textContent = startText(Number(start.value));
    $('practice-rate').textContent = fmtRate(pr.rate);
    $('practice-slower').disabled = pr.rate <= RATE_MIN;
    $('practice-faster').disabled = pr.rate >= RATE_MAX;
    $('practice-rate-reset').disabled = pr.rate === 1;
  }

  on.addEventListener('change', () => pr.setEnabled(on.checked));
  start.addEventListener('input', () => {
    startOut.textContent = startText(Number(start.value));
    pr.setStart(getCurrent()?.entry?.key, Number(start.value));
  });
  $('practice-slower').addEventListener('click', () => pr.stepRate(-1));
  $('practice-faster').addEventListener('click', () => pr.stepRate(1));
  $('practice-rate-reset').addEventListener('click', () => pr.setRate(1));

  // ----- bar while playing on the computer ----------------------------------------
  const bar = $('practice-bar');
  const seek = $('pb-seek');
  let dragging = false;
  for (const id of ['pb-slower', 'pb-faster', 'pb-reset']) noFocus($(id));
  $('pb-slower').addEventListener('click', () => pr.stepRate(-1));
  $('pb-faster').addEventListener('click', () => pr.stepRate(1));
  $('pb-reset').addEventListener('click', () => pr.setRate(1));
  seek.addEventListener('pointerdown', () => {
    dragging = true;
  });
  seek.addEventListener('input', () => {
    dragging = true;
    $('pb-time').textContent = fmtTime(Number(seek.value));
  });
  seek.addEventListener('change', () => {
    dragging = false;
    pr.jumpTo(Number(seek.value));
    seek.blur();
  });
  window.addEventListener('pointerup', () => {
    dragging = false;
  });

  function syncBar() {
    const show = game.mode === 'desktop' && pr.active && game.state === 'playing';
    if (bar.hidden === show) bar.hidden = !show;
    if (!show) return;
    const total = pr.duration;
    seek.max = String(Math.max(1, Math.floor(total)));
    $('pb-total').textContent = fmtTime(total);
    $('pb-rate').textContent = fmtRate(pr.rate);
    $('pb-slower').disabled = pr.rate <= RATE_MIN;
    $('pb-faster').disabled = pr.rate >= RATE_MAX;
    $('pb-reset').disabled = pr.rate === 1;
    if (!dragging) {
      const t = pr.position;
      seek.value = String(t);
      $('pb-time').textContent = fmtTime(t);
    }
  }
  setInterval(syncBar, 100);

  pr.subscribe(() => {
    sync();
    syncBar();
  });
  return { sync };
}
