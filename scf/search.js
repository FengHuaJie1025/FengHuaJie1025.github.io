/**
 * SCF 检索逻辑：中文分词 + BM25
 * 纯函数，无外部依赖，可被 scf/index.js 与本地测试复用。
 */
'use strict'

const K1 = 1.5
const B = 0.75

// 查询侧停用词：中文功能词 / 疑问词 + 常见英文冠词，避免稀释打分
const STOPWORDS = new Set([
  '的', '了', '是', '在', '从', '到', '和', '与', '或', '吗', '呢', '啊', '吧', '呀',
  '我', '你', '他', '她', '它', '我们', '你们', '他们', '这', '那', '这个', '那个',
  '一个', '一种', '可以', '需要', '应该', '为什么', '怎么', '如何', '什么', '哪些',
  '能', '会', '要', '想', '有', '没有', '做', '用', '对', '给', '让', '把', '被',
  'a', 'an', 'the', 'how', 'what', 'why', 'is', 'are', 'do', 'does',
])

// 标题 / tag 精确命中加权（还原旧 ask.ts 的 +title / +tag 设计意图）
const TITLE_BOOST = 1.4
const TAG_BOOST = 1.8

/**
 * 分词：
 * - 中日韩统一表意文字（CJK）取「单字 + 相邻双字」作为 unigram / bigram
 * - 拉丁字母与数字连续串作为一个 token（如 rag、mcp、embedding）
 * 这样中文靠字/词共现召回，英文 tag / 术语可精确匹配。
 */
function tokenize(text) {
  const tokens = []
  const lower = String(text).toLowerCase()
  for (let i = 0; i < lower.length; i++) {
    const ch = lower[i]
    if (/[一-鿿]/.test(ch)) {
      tokens.push(ch)
      if (i + 1 < lower.length && /[一-鿿]/.test(lower[i + 1])) {
        tokens.push(ch + lower[i + 1])
      }
    } else if (/[a-z0-9]/.test(ch)) {
      let j = i
      let w = ''
      while (j < lower.length && /[a-z0-9]/.test(lower[j])) {
        w += lower[j]
        j++
      }
      if (w) tokens.push(w)
      i = j - 1
    }
  }
  return tokens
}

/**
 * 构建 BM25 索引（在 SCF 冷启动 / 本地测试时调用一次）。
 * 以「块」为文档单元，标题与 tag 加权进文档内容。
 */
function buildIndex(chunks) {
  const docTokens = chunks.map(c =>
    tokenize(`${c.title} ${c.title} ${(c.tags || []).join(' ')} ${c.content}`)
  )
  const tf = docTokens.map(tokens => {
    const m = new Map()
    for (const t of tokens) m.set(t, (m.get(t) || 0) + 1)
    return m
  })
  const df = new Map()
  for (const m of tf) {
    for (const t of m.keys()) df.set(t, (df.get(t) || 0) + 1)
  }
  const avgdl = docTokens.reduce((s, d) => s + d.length, 0) / (docTokens.length || 1)
  return { chunks, docTokens, tf, df, avgdl, N: docTokens.length }
}

/**
 * 检索 topK 块（按 BM25 打分 + 标题/标签精确命中加权）。
 * 返回 [{ chunk, score }]，分数 > 0。
 */
function search(index, query, topK = 6) {
  const q = tokenize(query).filter(t => !STOPWORDS.has(t))
  if (q.length === 0) return []

  const scored = index.docTokens.map((_tokens, i) => {
    const dl = index.docTokens[i].length
    let score = 0
    for (const t of q) {
      const f = index.tf[i].get(t) || 0
      if (!f) continue
      const df = index.df.get(t) || 0
      const idf = Math.log(1 + (index.N - df + 0.5) / (df + 0.5))
      score += idf * ((f * (K1 + 1)) / (f + K1 * (1 - B + B * (dl / index.avgdl))))
    }
    if (score <= 0) return { i, score: 0 }

    // 标题 / tag 精确命中加权
    const chunk = index.chunks[i]
    const titleLower = chunk.title.toLowerCase()
    const tagsLower = (chunk.tags || []).map(t => String(t).toLowerCase())
    if (q.some(t => tagsLower.includes(t))) score *= TAG_BOOST
    else if (q.some(t => titleLower.includes(t))) score *= TITLE_BOOST

    return { i, score }
  })

  return scored
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map(x => ({ chunk: index.chunks[x.i], score: x.score }))
}

module.exports = { tokenize, buildIndex, search, K1, B }
