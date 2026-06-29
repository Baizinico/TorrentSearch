/**
 * HttpClient — 基于 axios 的 HTTP 客户端
 * 对应原 Kotlin network/HttpClient.kt
 *
 * 能力：
 * - 默认 UA + 自定义 headers
 * - Cookie jar（按实例隔离，便于按 provider 域名管理）
 * - 超时（connect 10s / response 20s）
 * - 重试（5xx / 超时，最多 3 次指数退避）
 * - Cloudflare 挑战检测（cf-mitigated / 403 / 503）
 * - FlareSolverr 解锁（命中挑战时调用，注入 cookie + UA 后重试一次）
 */

import axios, { type AxiosInstance, type AxiosRequestConfig, type AxiosResponse } from 'axios';
import { wrapper } from 'axios-cookiejar-support';
import { CookieJar } from 'tough-cookie';
import { config } from '../config.js';
import { solveWithFlareSolverr } from './FlareSolverr.js';

/** Cloudflare 挑战异常 */
export class CloudflareChallengeError extends Error {
  readonly url: string;
  constructor(url: string, message = 'Cloudflare challenge detected') {
    super(message);
    this.name = 'CloudflareChallengeError';
    this.url = url;
  }
}

export interface HttpClientOptions {
  /** FlareSolverr 地址（未配置则 CF 命中直接抛错） */
  flareSolverrUrl?: string;
  /** 默认 User-Agent */
  userAgent?: string;
  /** 自定义 axios 配置 */
  axiosConfig?: AxiosRequestConfig;
}

export class HttpClient {
  private readonly jar: CookieJar;
  private readonly instance: AxiosInstance;
  private readonly flareSolverrUrl: string;
  private readonly userAgent: string;
  /** 域名 → UA 映射（FlareSolverr 解锁后该域名用返回的 UA） */
  private readonly unlockedUAMap = new Map<string, string>();

  constructor(opts: HttpClientOptions = {}) {
    this.jar = new CookieJar();
    this.flareSolverrUrl = opts.flareSolverrUrl ?? config.flareSolverrUrl;
    this.userAgent = opts.userAgent ?? config.userAgent;
    this.instance = wrapper(axios.create({
      jar: this.jar,
      withCredentials: true,
      timeout: 20000, // response timeout
      maxRedirects: 5,
      headers: {
        'User-Agent': this.userAgent,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.7',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      validateStatus: (s) => s < 500, // 5xx 抛错由重试处理
      ...opts.axiosConfig,
    }));
  }

  /** 获取 cookie jar（部分 provider 需直接操作，如 Eztv 的 layout cookie） */
  getCookieJar(): CookieJar {
    return this.jar;
  }

  /** 设置 cookie（手动注入，如 layout=def_wlinks） */
  async setCookie(url: string, name: string, value: string): Promise<void> {
    await this.jar.setCookie(`${name}=${value}; path=/`, url);
  }

  /** 获取当前 UA（可能被 FlareSolverr 替换） */
  getUserAgent(url?: string): string {
    if (url) {
      const host = this.getHost(url);
      const unlocked = this.unlockedUAMap.get(host);
      if (unlocked) return unlocked;
    }
    return this.userAgent;
  }

  /** GET 请求，返回 HTML/文本。自动 CF 检测与解锁。 */
  async get(url: string, headers?: Record<string, string>): Promise<string> {
    return this.requestWithCFHandling('GET', url, undefined, headers);
  }

  /** GET 请求返回 Buffer（用于下载 .torrent 文件） */
  async getBuffer(url: string, headers?: Record<string, string>): Promise<Buffer> {
    const resp = await this.instance.get(url, {
      headers: { ...this.buildHeaders(url, headers) },
      responseType: 'arraybuffer',
    });
    return Buffer.from(resp.data as ArrayBuffer);
  }

  /** GET 并解析 JSON */
  async getJson<T = unknown>(url: string, headers?: Record<string, string>): Promise<T | null> {
    const resp = await this.instance.get(url, {
      headers: { ...this.buildHeaders(url, headers), Accept: 'application/json' },
    });
    if (!resp.data) return null;
    return resp.data as T;
  }

  /** POST JSON 并解析响应 JSON */
  async postJson<T = unknown>(
    url: string,
    body: unknown,
    headers?: Record<string, string>,
  ): Promise<T | null> {
    const resp = await this.instance.post(url, body, {
      headers: { ...this.buildHeaders(url, headers), 'Content-Type': 'application/json', Accept: 'application/json' },
    });
    if (!resp.data) return null;
    return resp.data as T;
  }

  /** POST 表单并返回响应文本 */
  async postForm(
    url: string,
    formData: Record<string, string>,
    headers?: Record<string, string>,
  ): Promise<string | null> {
    const resp = await this.instance.post(url, new URLSearchParams(formData).toString(), {
      headers: {
        ...this.buildHeaders(url, headers),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });
    return resp.data ? String(resp.data) : null;
  }

  /** 预检：URL 是否被 Cloudflare 挑战 */
  async isUrlChallenged(url: string): Promise<boolean> {
    try {
      const resp = await this.instance.get(url, {
        headers: this.buildHeaders(url),
        validateStatus: () => true,
      });
      return this.isResponseChallenged(resp);
    } catch {
      return false;
    }
  }

  // ============== 内部实现 ==============

  private getHost(url: string): string {
    try {
      return new URL(url).hostname.toLowerCase();
    } catch {
      return '';
    }
  }

  private buildHeaders(url?: string, extra?: Record<string, string>): Record<string, string> {
    const ua = url ? this.getUserAgent(url) : this.userAgent;
    return { 'User-Agent': ua, ...(extra ?? {}) };
  }

  /** 检测响应是否为 Cloudflare 挑战页 */
  private isResponseChallenged(resp: AxiosResponse): boolean {
    // cf-mitigated: challenge
    const mitigated = resp.headers['cf-mitigated'];
    if (typeof mitigated === 'string' && mitigated.toLowerCase().includes('challenge')) {
      return true;
    }
    // 403 / 503 + cloudflare 标识
    if (resp.status === 403 || resp.status === 503) {
      const server = resp.headers['server'];
      if (typeof server === 'string' && server.toLowerCase().includes('cloudflare')) {
        return true;
      }
    }
    return false;
  }

  /** 带 CF 检测与重试的请求 */
  private async requestWithCFHandling(
    method: 'GET' | 'POST',
    url: string,
    body: unknown,
    headers?: Record<string, string>,
  ): Promise<string> {
    const maxRetries = 3;
    let lastError: unknown;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const resp =
          method === 'GET'
            ? await this.instance.get(url, { headers: this.buildHeaders(url, headers) })
            : await this.instance.post(url, body, { headers: this.buildHeaders(url, headers) });

        if (this.isResponseChallenged(resp)) {
          // 尝试 FlareSolverr 解锁
          if (this.flareSolverrUrl) {
            const solved = await this.tryFlareSolverr(url);
            if (solved) {
              // 重试一次
              continue;
            }
          }
          throw new CloudflareChallengeError(url);
        }

        return typeof resp.data === 'string' ? resp.data : String(resp.data ?? '');
      } catch (err) {
        // CF 错误直接抛
        if (err instanceof CloudflareChallengeError) throw err;
        lastError = err;
        // 判断是否可重试（5xx / 超时 / 网络错误）
        if (axios.isAxiosError(err)) {
          const status = err.response?.status ?? 0;
          const isRetryable =
            status >= 500 ||
            err.code === 'ECONNABORTED' ||
            err.code === 'ETIMEDOUT' ||
            err.code === 'ECONNRESET' ||
            err.code === 'ENOTFOUND' && attempt < maxRetries;
          if (isRetryable && attempt < maxRetries) {
            await sleep(2 ** attempt * 500); // 500ms, 1s, 2s 指数退避
            continue;
          }
        }
        throw err;
      }
    }
    throw lastError instanceof Error ? lastError : new Error('Request failed');
  }

  /** 调用 FlareSolverr 解锁，注入 cookies + UA，返回是否成功 */
  private async tryFlareSolverr(url: string): Promise<boolean> {
    try {
      const solution = await solveWithFlareSolverr(this.flareSolverrUrl, url);
      // 注入 cookies 到 jar
      for (const c of solution.cookies) {
        const cookieUrl = c.domain ? `https://${c.domain.replace(/^\./, '')}` : url;
        await this.jar.setCookie(`${c.name}=${c.value}; path=/`, cookieUrl);
      }
      // 记录该域名的新 UA
      const host = this.getHost(url);
      if (host) this.unlockedUAMap.set(host, solution.userAgent);
      return true;
    } catch (err) {
      console.warn(`[HttpClient] FlareSolverr failed for ${url}:`, err instanceof Error ? err.message : err);
      return false;
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** 全局默认 HttpClient 实例（向后兼容，部分 provider 静态方法可用） */
let _defaultClient: HttpClient | null = null;
export function getDefaultHttpClient(): HttpClient {
  if (!_defaultClient) _defaultClient = new HttpClient();
  return _defaultClient;
}
