/**
 * 构建时生成笔记索引脚本
 * 读取 src/content/notes/*.md，提取元数据和文本，输出两份索引：
 *   1. public/notes-index.json   —— 保留 entries（整篇，供旧版 EdgeOne ask.ts 兼容）
 *   2. scf/notes-index.json      —— 新增 chunks（按句分块，供 SCF BM25 检索打包进函数）
 */
import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = join(fileURLToPath(import.meta.url), '..')
const notesDir = join(__dirname, '..', 'src', 'content', 'notes')
const publicDir = join(__dirname, '..', 'public')
const scfDir = join(__dirname, '..', 'scf')

function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/)
  if (!match) return { meta: {}, body: content }
  const fm = match[1]
  const body = content.slice(match[0].length).trim()
  const meta = {}
  for (const line of fm.split('\n')) {
    const idx = line.indexOf(':')
    if (idx === -1) continue
    const key = line.slice(0, idx).trim()
    let val = line.slice(idx + 1).trim()
    if (val.startsWith('[') && val.endsWith(']')) {
      val = val.slice(1, -1).split(',').map(s => s.trim().replace(/["']/g, ''))
    } else {
      val = val.replace(/["']/g, '')
    }
    meta[key] = val
  }
  return { meta, body }
}

function stripMarkdown(text) {
  return text
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`]+`/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '')
    .replace(/#{1,6}\s+/g, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/\|[^]*?\|/g, '')
    .replace(/\n{2,}/g, '\n')
    .trim()
}

const CHUNK_SIZE = 600 // 单块目标字数（中文）
const OVERLAP = 150 // 块间重叠字数

/**
 * 按「行 → 句子」切分，遇到 markdown 标题记录当前小节名，
 * 累积到接近 CHUNK_SIZE 时落块，块首带【小节名】上下文。
 * 返回 [{ content }]，再补上 id/slug 等元数据。
 */
function chunkText(slug, title, tags, date, text) {
  const lines = text.split('\n')
  let heading = ''
  const units = [] // { heading, text }
  for (let line of lines) {
    line = line.trim()
    if (!line) continue
    if (/^#{1,6}\s/.test(line)) {
      heading = line.replace(/^#{1,6}\s+/, '')
      continue
    }
    const parts = line.match(/[^。！？；]+[。！？；]?/g) || [line]
    for (const p of parts) {
      const t = p.trim()
      if (t) units.push({ heading, text: t })
    }
  }

  const chunks = []
  let buf = ''
  let curHeading = ''
  const flush = () => {
    const content = (curHeading ? '【' + curHeading + '】\n' : '') + buf.trim()
    if (content.trim()) chunks.push({ content: content.trim() })
    buf = buf.length > OVERLAP ? buf.slice(-OVERLAP) : buf
  }

  for (const u of units) {
    if (buf && buf.length + u.text.length + 1 > CHUNK_SIZE) {
      flush()
      curHeading = u.heading
      buf = u.text
    } else {
      buf = buf ? buf + u.text : u.text
      if (u.heading) curHeading = u.heading
    }
  }
  if (buf.trim()) flush()

  return chunks.map((c, idx) => ({
    id: `${slug}#${idx + 1}`,
    slug,
    title,
    tags: Array.isArray(tags) ? tags : [],
    date,
    chunkIndex: idx + 1,
    totalChunks: chunks.length,
    content: c.content,
  }))
}

async function main() {
  await mkdir(publicDir, { recursive: true })
  await mkdir(scfDir, { recursive: true })

  const files = await readdir(notesDir)
  const entries = []
  const chunks = []

  for (const file of files) {
    if (!file.endsWith('.md')) continue
    const content = await readFile(join(notesDir, file), 'utf-8')
    const { meta, body } = parseFrontmatter(content)
    const plainText = stripMarkdown(body)

    const slug = file.replace('.md', '')
    const title = meta.title || file
    const tags = Array.isArray(meta.tags) ? meta.tags : []
    const date = meta.date || ''

    entries.push({
      slug,
      title,
      summary: meta.summary || '',
      tags,
      date,
      content: plainText,
    })

    const noteChunks = chunkText(slug, title, tags, date, plainText)
    chunks.push(...noteChunks)
  }

  const publicIndex = {
    generatedAt: new Date().toISOString(),
    total: entries.length,
    entries,
    chunks, // 供前端「浏览器直连」模式做客户端 BM25 检索（与 scf 同源数据）
  }
  const scfIndex = {
    generatedAt: new Date().toISOString(),
    totalNotes: entries.length,
    totalChunks: chunks.length,
    entries, // 保留整篇，兼容旧 EdgeOne ask.ts
    chunks, // 分块，供 SCF BM25 检索
  }

  await writeFile(join(publicDir, 'notes-index.json'), JSON.stringify(publicIndex, null, 2), 'utf-8')
  await writeFile(join(scfDir, 'notes-index.json'), JSON.stringify(scfIndex, null, 2), 'utf-8')
  console.log(
    `已生成 ${entries.length} 篇笔记 + ${chunks.length} 个分块\n  -> public/notes-index.json (entries)\n  -> scf/notes-index.json (entries + chunks)`
  )
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
