import { defineConfig } from 'astro/config';

// 静态站点部署在 GitHub Pages（主）；
// /api/ask 后端已迁至腾讯云 SCF 云函数（见 scf/），前端通过 PUBLIC_ASK_API 跨域调用。
// 若将来备案自定义域名，可改回 EdgeOne Pages（functions/api/ask.ts 为备用版）。
export default defineConfig({
  site: 'https://fenghuajie1025.github.io',
  trailingSlash: 'ignore',
  // 构建时由 .env 注入 PUBLIC_ASK_API（SCF 的 APIGW 地址）
});
