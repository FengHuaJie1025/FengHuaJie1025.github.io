import { defineConfig } from 'astro/config';

// 双平台部署：EdgeOne Pages（主） + GitHub Pages（副）
// - EdgeOne Pages：关联 Git 仓库，push 到 main 自动构建部署
// - GitHub Pages：通过 GitHub Actions 自动构建部署
export default defineConfig({
  site: 'https://fenghuajie-jhqvudgl.edgeone.dev',
  trailingSlash: 'ignore',
});
