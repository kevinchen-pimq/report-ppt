// ES module：import 的檔案會被 esbuild 打包成一個檔案
import { startClock } from './clock.js';

startClock(document.getElementById('clock'));
