import { defineConfig } from 'astro/config';

// 双平台部署：EdgeOne Pages（主，国内访问） + GitHub Pages（副）
// - GitHub Pages：通过 GitHub Actions 自动构建部署
// - EdgeOne Pages：通过腾讯云控制台关联此仓库，或 CLI 手动上传
export default defineConfig({
  // 部署到 EdgeOne 且绑定自定义域名后，改为你的正式域名
  site: 'https://FengHuaJie1025.github.io',
  trailingSlash: 'ignore',
});
