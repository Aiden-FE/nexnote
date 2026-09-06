/**
 * 增量 SSE 解析器（按 Server-Sent Events 规范的子集实现）：
 * - feed() 可被任意 chunk 边界切割调用，跨 chunk 的事件自动缓冲
 * - 事件以空行（\\n\\n / \\r\\n\\r\\n）分隔；data: 可多行拼接
 * - 忽略注释（: heartbeat）与非 data 字段
 */
export interface SseParser {
  feed(chunk: string): void;
  /** 流结束时冲刷残留（无尾空行的最后一个事件） */
  flush(): void;
}

export function createSseParser(onData: (data: string) => void): SseParser {
  let buffer = '';

  const emitBlock = (block: string): void => {
    // 一个事件块内可能有多个 data: 行，按规范以 \n 连接
    const dataLines: string[] = [];
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith(':')) continue;
      if (line.startsWith('data:')) {
        // "data: x" 与 "data:x" 均合法（冒号后单个空格被剥除）
        const value = line.slice(5);
        dataLines.push(value.startsWith(' ') ? value.slice(1) : value);
      }
    }
    if (dataLines.length > 0) onData(dataLines.join('\n'));
  };

  return {
    feed(chunk) {
      buffer += chunk;
      // 循环剥出完整事件块（\n\n 或 \r\n\r\n）
      let idx: number;
      while ((idx = buffer.search(/\r?\n\r?\n/)) !== -1) {
        const block = buffer.slice(0, idx);
        buffer = buffer.slice(idx).replace(/^\r?\n\r?\n/, '');
        emitBlock(block);
      }
    },
    flush() {
      if (buffer.length > 0) {
        emitBlock(buffer);
        buffer = '';
      }
    },
  };
}
