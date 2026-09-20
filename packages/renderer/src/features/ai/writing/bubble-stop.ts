import { attachBubbleTooltip, defaultBubbleIconRenderer } from '@nexnote/kernel';
import { useWritingStore, type WritingSession } from './writing-store';

/**
 * DEV-034：划词工具栏的独立停止控件（生成中可点击、可键盘操作）。
 *
 * - 每次调用返回独立实例：块编辑与源码模式各自把实例注入自己的工具栏，
 *   同一时刻只可能有一个编辑器在跑会话（一个 DOM 节点不能挂在两处）
 * - 仅在 status === 'streaming' 时显示并可用；其余状态隐藏（disabled + hidden）
 * - 原生 button：Tab 可达，Enter/Space 触发停止（无需自定义键盘处理）
 * - 点击走会话 stop（DEV-037）：取消上游流后保留已显示内容并标记未完成，
 *   浮层继续提供 Accept/Reject；与浮层「停止生成」按钮同语义
 *
 * DEV-063：图标改为内核 SVG icon renderer（与顶部 lucide-react `Square` 同源），
 * 不再使用字形字符 `■`。
 */

export interface BubbleStopControl {
  dom: HTMLButtonElement;
  destroy(): void;
}

export function writingStopControl(): BubbleStopControl {
  const dom = document.createElement('button');
  dom.type = 'button';
  dom.className = 'nexnote-selection-bubble__stop';
  dom.dataset.bubbleAction = 'ai:stop';
  dom.dataset.testid = 'bubble-stop';
  dom.setAttribute('aria-label', '停止生成');
  const icon = document.createElement('span');
  icon.className = 'nexnote-selection-bubble__icon';
  icon.dataset.icon = 'stop';
  icon.setAttribute('aria-hidden', 'true');
  const svg = defaultBubbleIconRenderer('stop');
  if (svg) icon.append(svg);
  dom.append(icon);
  attachBubbleTooltip(dom, 'nexnote-selection-bubble', () => '停止生成');
  // 与其它工具栏按钮一致：mousedown 不抢编辑器选区
  dom.addEventListener('mousedown', (event) => event.preventDefault());
  dom.addEventListener('click', (event) => {
    event.preventDefault();
    const session = useWritingStore.getState().session;
    if (session?.status === 'streaming') session.stop();
  });

  const render = (session: WritingSession | null) => {
    const streaming = session?.status === 'streaming';
    dom.hidden = !streaming;
    dom.disabled = !streaming;
  };
  render(useWritingStore.getState().session);
  const unsubscribe = useWritingStore.subscribe((state) => render(state.session));
  return {
    dom,
    destroy: () => {
      unsubscribe();
      dom.remove();
    },
  };
}