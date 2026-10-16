export function startClock(el) {
  const tick = () => { el.textContent = '現在時間：' + new Date().toLocaleTimeString(); };
  tick();
  return setInterval(tick, 1000);
}
