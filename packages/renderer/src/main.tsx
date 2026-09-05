import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './features/bootstrap';
import './globals.css';
import { runSmokeIfEnabled } from './smoke/smoke';

const container = document.getElementById('root');
if (!container) throw new Error('#root 不存在');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// 冒烟模式（NEXNOTE_SMOKE=1）：应用挂载后自动执行 DOM 自检 + 截图
setTimeout(() => void runSmokeIfEnabled(), 600);
