// 补分类：把有动作图但缺少分类缓存的评论补上 tag，写入 llm_classification_cache。
// 解决 prepare-demo 分类(top-按点赞) 与图片(top-按适合演示) 覆盖不同批导致的 Demo 模式筛不出带图评论的问题。
import Database from 'better-sqlite3'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const dbPath = join(projectRoot, 'local-data', 'collections.sqlite')
const apiBase = process.env.BILI_LLM_BASE_URL || 'http://llmapi.bilibili.co/v1'
const model = process.env.BILI_LLM_MODEL || 'glm-5.2'

function parseEnv(text) {
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const index = trimmed.indexOf('=')
    if (index <= 0) continue
    const key = trimmed.slice(0, index).trim()
    let value = trimmed.slice(index + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1)
    if (key === 'BILI_LLM_KEY' && !process.env.BILI_LLM_KEY) process.env.BILI_LLM_KEY = value
  }
}
for (const envFile of ['.env', '.env.example']) {
  try { parseEnv(readFileSync(join(projectRoot, envFile), 'utf8')) } catch { /* optional */ }
}
const apiKey = process.env.BILI_LLM_KEY || ''
if (!apiKey) throw new Error('缺少 BILI_LLM_KEY')

const db = new Database(dbPath)

// 对所有有动作图的评论重新分类（覆盖），确保图与分类同一批
const rows = db.prepare(`
  SELECT DISTINCT c.platform_id AS id, c.content AS text
  FROM reaction_cache r
  JOIN comments c ON c.platform_id = r.comment_id
  WHERE trim(c.content) <> ''
`).all()

if (!rows.length) {
  console.log('没有需要补分类的评论，全部已分类。')
  db.close()
  process.exit(0)
}

function textHash(text) { return createHash('sha256').update(text).digest('hex').slice(0, 16) }
function cacheKey(row) { return createHash('sha256').update(`classification|v1|${model}|${row.id}|${textHash(row.text)}`).digest('hex') }

async function requestJson(path, body) {
  const response = await fetch(`${apiBase.replace(/\/$/, '')}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  const json = await response.json()
  if (!response.ok) throw new Error(`${path} HTTP ${response.status}: ${json.error?.message || 'unknown error'}`)
  return json
}
function parseContent(value) {
  const text = String(value || '').replace(/^```json\s*/i, '').replace(/\s*```$/, '')
  try {
    const parsed = JSON.parse(text)
    return Array.isArray(parsed) ? { results: parsed } : parsed
  } catch { return { results: [] } }
}

const validTags = new Set(['鼓励与认可', '有趣互动', '选题建议', '内容改进意见'])
const list = rows.map((row) => `${row.id}\t${String(row.text).replace(/\s+/g, ' ').slice(0, 120)}`).join('\n')
const prompt = [
  '你是一个 B 站 UP 主的评论分类助手。请把每条评论归入以下类别之一：鼓励与认可、有趣互动、选题建议、内容改进意见。',
  '无关评论的 tag 返回 null。只输出 JSON：{"results":[{"id":"...","tag":"..."}]}',
  '', '评论列表（每行 id<TAB>文本）：', list
].join('\n')

const res = await requestJson('/chat/completions', {
  model,
  response_format: { type: 'json_object' },
  messages: [{ role: 'user', content: prompt }]
})
const map = new Map((parseContent(res.choices?.[0]?.message?.content).results || [])
  .map((item) => [String(item.id), validTags.has(item.tag) ? item.tag : null]))

const ins = db.prepare('INSERT OR REPLACE INTO llm_classification_cache (cache_key, comment_id, text_hash, model, result_json, created_at) VALUES (?, ?, ?, ?, ?, ?)')
let tagged = 0
let nulled = 0
for (const row of rows) {
  const tag = map.get(row.id) ?? null
  ins.run(cacheKey(row), row.id, textHash(row.text), model, JSON.stringify({ tag }), new Date().toISOString())
  if (tag) tagged++; else nulled++
}
db.close()
console.log(`补分类完成：${rows.length} 条，有效 tag ${tagged} 条，null ${nulled} 条。`)
