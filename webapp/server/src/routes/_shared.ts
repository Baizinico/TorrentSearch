/**
 * 路由共享工具：
 * - gateway 单例（FlareSolverr URL 通过 config 读取）
 * - SSE 写入辅助
 * - 通用 query 解析
 */

import type { Response } from 'express';
import { config } from '../config.js';
import { SearchProvidersGateway } from '../gateway/SearchProvidersGateway.js';
import type { Category, TorznabConfig } from '../types.js';
import { ALL_CATEGORIES } from '../types.js';

/** 全局 Gateway 单例（FlareSolverr URL 从 config 读取） */
export const gateway = new SearchProvidersGateway({
  flareSolverrUrl: config.flareSolverrUrl || undefined,
});

/** 已知 Category 集合（用于校验） */
const CATEGORY_SET = new Set<Category>(ALL_CATEGORIES);

/** 校验并归一化类别参数 */
export function parseCategory(value: unknown, fallback: Category = 'All'): Category {
  if (typeof value === 'string' && CATEGORY_SET.has(value as Category)) {
    return value as Category;
  }
  return fallback;
}

/** 解析 providerIds：支持重复 query key（?id=a&id=b）或 JSON 字符串 */
export function parseProviderIds(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === 'string');
  }
  if (typeof value === 'string') {
    if (!value) return [];
    // 尝试 JSON 解析
    if (value.startsWith('[')) {
      try {
        const arr = JSON.parse(value);
        if (Array.isArray(arr)) {
          return arr.filter((v): v is string => typeof v === 'string');
        }
      } catch {
        // 退化到逗号分隔
      }
    }
    return value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

/** 解析 torznabConfigs（JSON 字符串） */
export function parseTorznabConfigs(value: unknown): TorznabConfig[] {
  if (Array.isArray(value)) {
    return value.filter((v): v is TorznabConfig => typeof v === 'object' && v !== null);
  }
  if (typeof value !== 'string' || !value) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is TorznabConfig => typeof v === 'object' && v !== null);
  } catch {
    return [];
  }
}

/** 解析 cloudflareUnlocked（JSON 字符串或数组） */
export function parseUnlockedIds(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === 'string');
  }
  if (typeof value !== 'string' || !value) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed.filter((v): v is string => typeof v === 'string');
    }
  } catch {
    // 退化到逗号分隔
    return value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

/** 写入 SSE 事件 */
export function writeSseEvent(res: Response, data: unknown): void {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

/** 设置 SSE 响应头 */
export function setSseHeaders(res: Response): void {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  // 禁用 Nagle 算法，降低小包延迟
  // (Node http 没有直接 API，依赖 no-transform + flush)
  res.flushHeaders?.();
}
