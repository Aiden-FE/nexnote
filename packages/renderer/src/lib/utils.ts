import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** shadcn/ui 标准工具：合并 tailwind 类名。 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
