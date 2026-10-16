// defer script：DOM 解析完才執行
const clock = document.getElementById('clock');
function tick() { clock.textContent = '現在時間：' + new Date().toLocaleTimeString(); }
tick();
setInterval(tick, 1000);
