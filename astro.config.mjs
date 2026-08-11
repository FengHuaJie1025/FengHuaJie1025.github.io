import { defineConfig } from 'astro/config';

// 静态站点，部署到 EdgeOne Pages（static + 二期 Edge Functions）
export default defineConfig({
  // 部署到 EdgeOne 后改为你的域名，如 https://yoursite.edgeone.app
  site: 'https://example.edgeone.app',
  trailingSlash: 'ignore',
});
