// 在 Apps Script 裡用 esbuild 打包：TypeScript、相對 import、npm 套件（esm.sh）都可以
import dayjs from 'dayjs';
import { startClock } from './clock';
import './highlight.css';

const el = document.getElementById('clock') as HTMLElement;
startClock(el, (d: Date) => '現在時間：' + dayjs(d).format('YYYY-MM-DD HH:mm:ss'));
