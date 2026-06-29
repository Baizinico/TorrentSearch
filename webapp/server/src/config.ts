/**
 * 服务端配置：从环境变量读取，提供合理默认值。
 */
export const config = {
  /** 监听端口：开发模式默认 3001，可被 PORT 覆盖 */
  port: Number(process.env.PORT ?? (process.env.NODE_ENV === 'production' ? 3000 : 3001)),
  /** FlareSolverr 地址（可选），用于解锁 Cloudflare 保护的 provider */
  flareSolverrUrl: process.env.FLARESOLVERR_URL ?? '',
  /** 默认 User-Agent，模拟桌面 Chrome */
  userAgent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  /** 是否为生产模式 */
  isProd: process.env.NODE_ENV === 'production',
  /** 前端静态资源目录（相对 server/dist 编译产物位置） */
  webDistPath: '../../web/dist',
} as const;
