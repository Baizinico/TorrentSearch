/**
 * FlareSolverr 适配层
 * 通过 FlareSolverr 服务解锁 Cloudflare 保护的站点。
 * 文档：https://github.com/FlareSolverr/FlareSolverr
 */

import axios from 'axios';

export interface FlareSolverrSolution {
  cookies: Array<{ name: string; value: string; domain: string }>;
  userAgent: string;
}

/**
 * 调用 FlareSolverr 求解指定 URL 的 Cloudflare 挑战。
 * 成功返回 cookies（含 cf_clearance）与 User-Agent。
 */
export async function solveWithFlareSolverr(
  flareSolverrUrl: string,
  targetUrl: string,
  maxTimeoutMs = 60000,
): Promise<FlareSolverrSolution> {
  const endpoint = flareSolverrUrl.replace(/\/$/, '') + '/v1';
  const resp = await axios.post(
    endpoint,
    {
      cmd: 'request.get',
      url: targetUrl,
      maxTimeout: maxTimeoutMs,
    },
    {
      headers: { 'Content-Type': 'application/json' },
      timeout: maxTimeoutMs + 5000,
      validateStatus: () => true,
    },
  );

  if (resp.status >= 400) {
    throw new Error(`FlareSolverr HTTP ${resp.status}: ${JSON.stringify(resp.data)}`);
  }

  const data = resp.data;
  // FlareSolverr 返回 { status: 'ok', solution: { cookies, userAgent } }
  if (data?.status !== 'ok') {
    throw new Error(
      `FlareSolverr failed: ${data?.message ?? data?.status ?? 'unknown error'}`,
    );
  }

  const solution = data?.solution;
  if (!solution || !Array.isArray(solution.cookies) || !solution.userAgent) {
    throw new Error('FlareSolverr returned malformed solution');
  }

  return {
    cookies: solution.cookies.map((c: { name: string; value: string; domain?: string }) => ({
      name: c.name,
      value: c.value,
      domain: c.domain ?? '',
    })),
    userAgent: solution.userAgent as string,
  };
}
