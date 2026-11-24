export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Omit<Partial<HTMLElementTagNameMap[K]>, 'style'> & {
    class?: string;
    style?: string;
    dataset?: Record<string, string>;
  } = {} as Omit<Partial<HTMLElementTagNameMap[K]>, 'style'> & {
    class?: string;
    style?: string;
    dataset?: Record<string, string>;
  },
  ...children: Array<Node | string | null | undefined | false>
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = String(value);
    else if (key === 'style') node.style.cssText = String(value);
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
    } else if (key === 'html') {
      node.innerHTML = String(value);
    } else {
      (node as unknown as Record<string, unknown>)[key] = value;
    }
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(child));
  }
  return node;
}

export function clear(node: HTMLElement): void {
  node.replaceChildren();
}

export function fmt1(n: number | undefined | null): string {
  return n === undefined || n === null || Number.isNaN(n) ? '—' : n.toFixed(1);
}

export function fmt2(n: number | undefined | null): string {
  return n === undefined || n === null || Number.isNaN(n) ? '—' : n.toFixed(2);
}

export function downloadText(filename: string, text: string, type = 'text/plain;charset=utf-8'): void {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function readImageFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = reject;
    img.src = url;
  });
}

export function imageToRaster(img: HTMLImageElement, maxWidth = 520): { width: number; height: number; data: Uint8ClampedArray } {
  const scale = Math.min(1, maxWidth / img.naturalWidth);
  const width = Math.max(1, Math.round(img.naturalWidth * scale));
  const height = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, width, height);
  return ctx.getImageData(0, 0, width, height);
}
