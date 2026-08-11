import { defineConfig } from 'astro/config';

// GitHub Pages 部署（主）
// 通过 .github/workflows/deploy-gh-pages.yml 自动构建部署
export default defineConfig({
  site: 'https://fenghuajie1025.github.io',
  trailingSlash: 'ignore',
});
