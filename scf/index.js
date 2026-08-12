/**
 * 腾讯云 SCF Web 函数：POST /api/ask （零依赖版，仅用 Node 内置模块）
 *
 * 流程：
 *   1. 启动时从同目录 notes-index.json 构建 BM25 索引（chunk 级）
 *   2. 接收 { question, conversation }，BM25 检索相关分块
 *   3. 拼接系统提示 + 上下文，调用 Agnes（stream:true）
 *   4. 以自定义 SSE 协议流式回传 {type:'sources'|'delta'|'done'|'error'}
 *
 * 部署：打包整个 scf/ 目录上传为 Web 函数，监听 0.0.0.0:9000。
 * 环境变量：AGNES_API_KEY（必填）、AGNES_MODEL（默认 agnes-2.0-flash）、AGNES_BASE_URL（默认 https://apihub.agnes-ai.com/v1）。
 *
 * 注意：本版本不依赖 express，运行时无需 npm install，规避 Windows 上传后依赖安装失败的问题。
 */
'use strict'

const http = require('http')
const fs = require('fs')
const path = require('path')
const { buildIndex, search } = require('./search.js')

// 索引构建（冷启动一次）
let INDEX = null
try {
  const raw = fs.readFileSync(path.join(__dirname, 'notes-index.json'), 'utf-8')
  INDEX = buildIndex(JSON.parse(raw).chunks)
  console.log(`[ask] BM25 索引就绪：${INDEX.N} 个分块`)
} catch (e) {
  console.error('[ask] 索引加载失败：', e)
}

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj)
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Content-Length', Buffer.byteLength(body))
  res.end(body)
}

function readBody(req, limit = 1e6) {
  return new Promise((resolve, reject) => {
    let data = ''
    let tooBig = false
    req.on('data', (chunk) => {
      data += chunk
      if (data.length > limit && !tooBig) {
        tooBig = true
        req.destroy()
      }
    })
    req.on('end', () => (tooBig ? reject(new Error('body too large')) : resolve(data)))
    req.on('error', reject)
  })
}

function sendEvent(res, obj) {
  res.write(`data: ${JSON.stringify(obj)}\n\n`)
}

const server = http.createServer(async (req, res) => {
  setCors(res)

  // 预检
  if (req.method === 'OPTIONS') {
    res.statusCode = 204
    return res.end()
  }

  // 健康检查 / 索引状态
  if (req.url === '/api/ask' && req.method === 'GET') {
    return sendJson(res, 200, {
      service: 'ask',
      status: INDEX ? 'ok' : 'index_missing',
      note: 'POST { question, conversation? } 以流式获取回答。',
    })
  }

  if (req.url !== '/api/ask') {
    return sendJson(res, 404, { error: 'not found' })
  }
  if (req.method !== 'POST') {
    return sendJson(res, 405, { error: 'method not allowed' })
  }

  const apiKey = process.env.AGNES_API_KEY
  if (!apiKey) return sendJson(res, 500, { error: '服务端未配置 AGNES_API_KEY' })
  if (!INDEX) return sendJson(res, 500, { error: '知识库索引加载失败' })

  let body
  try {
    body = JSON.parse(await readBody(req))
  } catch {
    return sendJson(res, 400, { error: '请求体格式错误' })
  }
  const { question, conversation = [] } = body || {}
  if (!question || !question.trim()) return sendJson(res, 400, { error: '请输入问题' })

  // SSE 头
  res.statusCode = 200
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no') // 防止中间层缓冲
  if (typeof res.flushHeaders === 'function') res.flushHeaders()

  try {
    // 1) 检索
    const top = search(INDEX, question, 6)
    const references = []
    const contextParts = []
    const seen = new Set()
    for (const { chunk } of top) {
      const ctx = `[${references.length + 1}] ${chunk.title} (${chunk.slug})\n${chunk.content}`
      if (!seen.has(chunk.slug)) {
        seen.add(chunk.slug)
        references.push({
          title: chunk.title,
          slug: chunk.slug,
          chunkIndex: chunk.chunkIndex,
          totalChunks: chunk.totalChunks,
        })
      }
      contextParts.push(ctx)
    }
    const context = contextParts.join('\n\n---\n\n')

    // 2) 通知前端使用了哪些来源
    sendEvent(res, { type: 'sources', references })

    // 3) 系统提示
    const systemPrompt = [
      '你是一个乐于助人的技术助手，基于以下「知识库」内容回答用户问题。',
      '要求：',
      '1. 优先依据知识库内容作答，并在回答中标注引用编号（如 [1]、[2]）。',
      '2. 若知识库未涵盖该问题，请如实说明“知识库中暂未收录该内容”，并建议用户访问 /notes 浏览全部文章。',
      '3. 使用中文，简洁清晰；不要编造知识库之外的事实。',
      '',
      '以下是相关知识库内容：',
      context,
    ].join('\n')

    const messages = [
      { role: 'system', content: systemPrompt },
      ...conversation
        .filter((m) => m && m.role && m.content)
        .map((m) => ({ role: m.role, content: m.content })),
      { role: 'user', content: question },
    ]

    // 4) 调 Agnes（OpenAI 兼容 /chat/completions，流式）
    const model = process.env.AGNES_MODEL || 'agnes-2.0-flash'
    const baseUrl = (process.env.AGNES_BASE_URL || 'https://apihub.agnes-ai.com/v1').replace(/\/$/, '')
    const upstream = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        stream: true,
        max_tokens: 2048,
        temperature: 0.7,
      }),
    })

    if (!upstream.ok) {
      const errText = await upstream.text()
      sendEvent(res, { type: 'error', message: `模型服务错误：${errText.slice(0, 300)}` })
      return res.end()
    }

    // 5) 解析 SSE 并转发 delta（Node 18+ Web Streams；Node 16 回退）
    const reader = upstream.body && typeof upstream.body.getReader === 'function' ? upstream.body.getReader() : null
    const writeDelta = async (content) => {
      const ok = res.write(`data: ${JSON.stringify({ type: 'delta', content })}\n\n`)
      if (!ok) await new Promise((r) => res.once('drain', r)) // 背压：写入缓冲满则等待排空
      if (typeof res.flush === 'function') res.flush()        // 尽量实时推送（无 flush 方法时忽略）
    }
    if (reader) {
      const decoder = new TextDecoder()
      let buffer = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let nl
        while ((nl = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, nl).trim()
          buffer = buffer.slice(nl + 1)
          if (!line.startsWith('data:')) continue
          const data = line.slice(5).trim()
          if (!data || data === '[DONE]') continue
          try {
            const json = JSON.parse(data)
            const delta = json.choices && json.choices[0] && json.choices[0].delta
            if (delta && delta.content) await writeDelta(delta.content)
          } catch (_) {
            /* 忽略非 JSON 行 */
          }
        }
      }
    } else {
      // Node 16 回退：upstream.body 为 Node 可读流
      await new Promise((resolve, reject) => {
        let buffer = ''
        upstream.body.on('data', (chunk) => {
          buffer += chunk.toString()
          let nl
          while ((nl = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, nl).trim()
            buffer = buffer.slice(nl + 1)
            if (!line.startsWith('data:')) continue
            const data = line.slice(5).trim()
            if (!data || data === '[DONE]') continue
            try {
              const json = JSON.parse(data)
              const delta = json.choices && json.choices[0] && json.choices[0].delta
              if (delta && delta.content) res.write(`data: ${JSON.stringify({ type: 'delta', content: delta.content })}\n\n`)
            } catch (_) {}
          }
        })
        upstream.body.on('end', resolve)
        upstream.body.on('error', reject)
      })
    }

    sendEvent(res, { type: 'done', references })
  } catch (e) {
    sendEvent(res, { type: 'error', message: `服务异常：${String(e && e.message ? e.message : e)}` })
  } finally {
    res.end()
  }
})

const PORT = process.env.PORT || 9000
server.listen(PORT, '0.0.0.0', () => {
  console.log(`[ask] listening on 0.0.0.0:${PORT}`)
})
