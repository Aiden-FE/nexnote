import { describe, expect, it } from 'vitest';
import { createSseParser } from '../src/ai/provider/sse';

describe('SSE 增量解析器', () => {
  it('解析单事件', () => {
    const events: string[] = [];
    const p = createSseParser((d) => events.push(d));
    p.feed('data: {"a":1}\n\n');
    p.flush();
    expect(events).toEqual(['{"a":1}']);
  });

  it('一个 feed 中多个事件', () => {
    const events: string[] = [];
    const p = createSseParser((d) => events.push(d));
    p.feed('data: one\n\ndata: two\n\ndata: [DONE]\n\n');
    p.flush();
    expect(events).toEqual(['one', 'two', '[DONE]']);
  });

  it('跨 chunk 边界的事件（半个 JSON 分两段到达）', () => {
    const events: string[] = [];
    const p = createSseParser((d) => events.push(d));
    p.feed('data: {"text":"hel');
    p.feed('lo wor');
    p.feed('ld"}\n');
    p.feed('\ndata: next\n\n');
    p.flush();
    expect(events).toEqual(['{"text":"hello world"}', 'next']);
  });

  it('多行 data: 按 \\n 拼接；注释与非 data 行被忽略', () => {
    const events: string[] = [];
    const p = createSseParser((d) => events.push(d));
    p.feed(': heartbeat\n event: x\ndata: line1\ndata: line2\n\n');
    p.flush();
    expect(events).toEqual(['line1\nline2']);
  });

  it('无尾空行的末尾事件由 flush 冲刷', () => {
    const events: string[] = [];
    const p = createSseParser((d) => events.push(d));
    p.feed('data: [DONE]');
    expect(events).toEqual([]);
    p.flush();
    expect(events).toEqual(['[DONE]']);
  });

  it('CRLF 分隔符兼容', () => {
    const events: string[] = [];
    const p = createSseParser((d) => events.push(d));
    p.feed('data: a\r\n\r\ndata: b\r\n\r\n');
    p.flush();
    expect(events).toEqual(['a', 'b']);
  });
});
