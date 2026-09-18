export function pickFile(accept: string): { promise: Promise<File | null>; abort: () => void } {
  let settled = false;
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = accept;
  input.style.display = 'none';
  let resolvePick: (file: File | null) => void = () => undefined;
  const abort = () => {
    if (settled) return;
    settled = true;
    input.remove();
    resolvePick(null);
  };
  const promise = new Promise<File | null>((resolve) => {
    resolvePick = resolve;
    const done = (file: File | null) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(file);
    };
    input.addEventListener('change', () => done(input.files?.[0] ?? null));
    input.addEventListener('cancel', () => done(null));
    document.body.append(input);
    // 放在任务队列尾部触发 click，确保 DOM 已就绪（部分浏览器要求 input 已挂载）
    queueMicrotask(() => {
      if (settled) return;
      try {
        input.click();
      } catch {
        done(null);
      }
    });
  });
  return { promise, abort };
}

export async function readFileAsBase64(file: File): Promise<string> {
  // 渲染进程无 Node Buffer；分块转 binary string 避免大文件栈溢出
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export function attachmentTargetPath(file: File, currentPagePath: string): string {
  // 附件存到当前页面同级的 assets 目录；跨平台统一正斜杠，主进程再做 path.normalize 与沙箱校验
  const dir = currentPagePath.includes('/')
    ? currentPagePath.slice(0, currentPagePath.lastIndexOf('/'))
    : '';
  const folder = dir ? `${dir}/assets` : 'assets';
  return `${folder}/${file.name}`;
}
