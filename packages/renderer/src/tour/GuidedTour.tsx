import { useCallback, useEffect, useState } from 'react';
import { useUiStore } from '../stores/ui-store';
import { cn } from '../lib/utils';
import { TOUR_STEPS, type TourStep } from './tour-steps';

/**
 * 新手引导 Tour（零依赖）：
 * - 半透明覆盖层 + box-shadow spotlight 高亮 `[data-tour]` 目标区域；
 * - 每步：标题 + 两句以内说明 + 上一步/下一步/跳过；
 * - 键盘可用：→/Enter 下一步、← 上一步、Esc 跳过；
 * - 完成或跳过均持久化 guideCompleted（经 vault layout 链路），之后不再自动弹出；
 * - 目标缺失或尺寸为 0 时优雅降级为居中卡片，不阻塞引导流程。
 */

const SPOTLIGHT_PAD = 8;
const TOOLTIP_WIDTH = 320;
const VIEWPORT_MARGIN = 12;

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
  bottom: number;
}

function readRect(selector: string): Rect | null {
  const el = document.querySelector(selector);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  // happy-dom / 隐藏元素返回全 0 矩形，视为无可用高亮
  if (r.width <= 0 || r.height <= 0) return null;
  return { top: r.top, left: r.left, width: r.width, height: r.height, bottom: r.bottom };
}

/** 越界安全的步骤读取（步骤数组非空）。 */
function getStep(index: number): TourStep {
  const clamped = Math.min(Math.max(index, 0), TOUR_STEPS.length - 1);
  return TOUR_STEPS[clamped] ?? TOUR_STEPS[TOUR_STEPS.length - 1]!;
}

export function GuidedTour() {
  const tourOpen = useUiStore((s) => s.tourOpen);
  const completeTour = useUiStore((s) => s.completeTour);
  const [stepIndex, setStepIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const [targetFound, setTargetFound] = useState(false);

  const step = getStep(stepIndex);
  const isLast = stepIndex >= TOUR_STEPS.length - 1;

  // 关闭后回到第一步：下次打开（含重播入口）总是从头开始
  useEffect(() => {
    if (tourOpen) return;
    const raf = requestAnimationFrame(() => setStepIndex(0));
    return () => cancelAnimationFrame(raf);
  }, [tourOpen]);

  const measure = useCallback(() => {
    const found = !!document.querySelector(step.targetSelector);
    setTargetFound(found);
    setRect(readRect(step.targetSelector));
  }, [step.targetSelector]);

  useEffect(() => {
    if (!tourOpen) return;
    // 首帧后测量一次（setState 在回调中执行）；目标可能在引导打开后才完成布局，低频轮询兜底
    const raf = requestAnimationFrame(measure);
    const interval = setInterval(measure, 500);
    window.addEventListener('resize', measure);
    return () => {
      cancelAnimationFrame(raf);
      clearInterval(interval);
      window.removeEventListener('resize', measure);
    };
  }, [tourOpen, measure]);

  const finish = useCallback(() => {
    completeTour();
  }, [completeTour]);

  const next = useCallback(() => {
    if (isLast) finish();
    else setStepIndex((i) => i + 1);
  }, [isLast, finish]);

  const prev = useCallback(() => {
    setStepIndex((i) => Math.max(0, i - 1));
  }, []);

  // DEV-081：进入新步前执行 prepare（展开右栏）；离开该步时执行 cleanup。
  // ai-dock 步：进入前快照 dockVisible；若原本收起则展开；离开时若仍是引导展开的则收起，
  // 否则尊重用户的本步内手动改动（与工单 §6 边界一致）。
  useEffect(() => {
    if (!tourOpen) return;
    let snapshot: { dockVisible: boolean } | null = null;
    if (step.id === 'ai-dock') {
      const ui = useUiStore.getState();
      snapshot = { dockVisible: ui.dockVisible };
      if (!ui.dockVisible) ui.setDockVisible(true);
    }
    return () => {
      if (step.id !== 'ai-dock' || snapshot === null) return;
      const ui = useUiStore.getState();
      // 仅当本次引导确实把它从 false 改成 true 时才恢复；保留用户本步内手动收起的状态。
      if (snapshot.dockVisible === false && ui.dockVisible) ui.setDockVisible(false);
    };
  }, [tourOpen, step.id]);

  useEffect(() => {
    if (!tourOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        finish();
      } else if (e.key === 'ArrowRight' || e.key === 'Enter') {
        e.preventDefault();
        next();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        prev();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tourOpen, finish, next, prev]);

  if (!tourOpen || !step) return null;

  const hasSpotlight = targetFound && rect !== null;

  // 卡片定位：有目标时贴着目标（优先下方，空间不足放上方）；无目标时居中
  let tooltipStyle: React.CSSProperties;
  if (hasSpotlight && rect) {
    const left = Math.min(
      Math.max(rect.left + rect.width / 2 - TOOLTIP_WIDTH / 2, VIEWPORT_MARGIN),
      Math.max(window.innerWidth - TOOLTIP_WIDTH - VIEWPORT_MARGIN, VIEWPORT_MARGIN),
    );
    const placeBelow = rect.bottom + 12 + 170 < window.innerHeight;
    tooltipStyle = placeBelow
      ? { top: rect.bottom + 12, left }
      : {
          top: Math.max(rect.top - 12, 182 + VIEWPORT_MARGIN),
          left,
          transform: 'translateY(-100%)',
        };
  } else {
    tooltipStyle = { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' };
  }

  return (
    <div
      data-testid="guided-tour"
      role="dialog"
      aria-modal="true"
      aria-label="新手引导"
      className="fixed inset-0 z-[60]"
    >
      {/* 阻断底层交互；有 spotlight 时由其 box-shadow 负责变暗，否则整层变暗 */}
      <div
        className={cn('absolute inset-0', !hasSpotlight && 'bg-black/50')}
        onClick={finish}
        aria-hidden
      />
      {hasSpotlight && rect && (
        <div
          data-testid="tour-spotlight"
          aria-hidden
          className="pointer-events-none absolute rounded-lg ring-2 ring-primary/80"
          style={{
            top: rect.top - SPOTLIGHT_PAD,
            left: rect.left - SPOTLIGHT_PAD,
            width: rect.width + SPOTLIGHT_PAD * 2,
            height: rect.height + SPOTLIGHT_PAD * 2,
            boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.5)',
          }}
        />
      )}
      <div
        data-testid="tour-card"
        role="document"
        style={{ width: TOOLTIP_WIDTH, ...tooltipStyle }}
        className="absolute rounded-lg border bg-card p-4 text-card-foreground shadow-xl"
      >
        <div className="mb-1 flex items-center justify-between gap-2">
          <h2 data-testid="tour-title" className="text-sm font-semibold">
            {step.title}
          </h2>
          <span className="text-[11px] text-muted-foreground">
            {stepIndex + 1} / {TOUR_STEPS.length}
          </span>
        </div>
        <p data-testid="tour-description" className="text-xs leading-relaxed text-muted-foreground">
          {step.description}
        </p>
        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            data-testid="tour-skip"
            onClick={finish}
            className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            跳过引导
          </button>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              data-testid="tour-prev"
              disabled={stepIndex === 0}
              onClick={prev}
              className="rounded border px-2.5 py-1 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-40 hover:bg-accent"
            >
              上一步
            </button>
            <button
              type="button"
              data-testid="tour-next"
              onClick={next}
              className="rounded bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90"
            >
              {isLast ? '完成' : '下一步'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
