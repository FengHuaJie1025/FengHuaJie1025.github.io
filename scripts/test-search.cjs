/**
 * 本地验证：生成 scf/notes-index.json 后，跑几个中文查询看 BM25 召回是否合理。
 * 用法：node scripts/generate-index.js && node scripts/test-search.cjs
 */
'use strict'
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const { buildIndex, search } = require('../scf/search.js')

const index = JSON.parse(readFileSync(join(__dirname, '..', 'scf', 'notes-index.json'), 'utf-8'))
const built = buildIndex(index.chunks)

console.log(`语料： ${built.N} 个分块 / ${index.totalNotes} 篇笔记\n`)

const queries = ['什么是 RAG', '怎么做 prompt 工程', 'MCP 是什么', '如何微调大模型', '上下文工程']
for (const q of queries) {
  const top = search(built, q, 3)
  console.log(`查询：「${q}」`)
  if (top.length === 0) {
    console.log('  (无命中)')
  } else {
    for (const { chunk, score } of top) {
      console.log(
        `  [${score.toFixed(2)}] ${chunk.title} #${chunk.chunkIndex}/${chunk.totalChunks}  (${chunk.slug})`
      )
    }
  }
  console.log('')
}
