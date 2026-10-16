export function startClock(el: HTMLElement, format: (d: Date) => string): number {
  const tick = () => {
    el.textContent = format(new Date());
  };
  tick();
  return setInterval(tick, 1000) as unknown as number;
}
