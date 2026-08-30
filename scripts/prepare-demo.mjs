import Database from 'better-sqlite3'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const dbPath = join(projectRoot, 'local-data', 'collections.sqlite')
const defaultReference = join(projectRoot, 'local-data', 'demo-reference.png')
const apiBase = process.env.BILI_LLM_BASE_URL || 'http://llmapi.bilibili.co/v1'
const apiKey = process.env.BILI_LLM_KEY || ''
const model = process.env.BILI_LLM_MODEL || 'glm-5.2'
const limit = Number(process.env.DEMO_REACTION_LIMIT || 12)
const classificationLimit = Number(process.env.DEMO_CLASSIFY_LIMIT || 30)

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
const effectiveKey = process.env.BILI_LLM_KEY || apiKey
const referenceArg = process.argv.find((arg) => arg.startsWith('--reference='))?.slice('--reference='.length)
const referencePath = resolve(referenceArg || defaultReference)

if (!effectiveKey) throw new Error('缺少 BILI_LLM_KEY')
if (!existsSync(dbPath)) throw new Error(`找不到采集库：${dbPath}`)
if (!existsSync(referencePath)) throw new Error(`找不到 AI 动作参考图：${referencePath}`)

const referenceBytes = readFileSync(referencePath)
if (!referenceBytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error('参考图必须是 PNG')
const referenceHash = createHash('sha256').update(referenceBytes).digest('hex').slice(0, 16)
const db = new Database(dbPath)
db.exec(`
CREATE TABLE IF NOT EXISTS reaction_cache (cache_key TEXT PRIMARY KEY, comment_id TEXT NOT NULL, reference_hash TEXT NOT NULL, prompt_version INTEGER NOT NULL, visual_prompt TEXT NOT NULL, image_png BLOB NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS llm_classification_cache (cache_key TEXT PRIMARY KEY, comment_id TEXT NOT NULL, text_hash TEXT NOT NULL, model TEXT NOT NULL, result_json TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS reaction_analysis_cache (cache_key TEXT PRIMARY KEY, comment_id TEXT NOT NULL, text_hash TEXT NOT NULL, model TEXT NOT NULL, result_json TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS llm_operation_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, operation TEXT NOT NULL, model TEXT NOT NULL, comment_ids_json TEXT NOT NULL, input_json TEXT NOT NULL, prompt TEXT NOT NULL, result_json TEXT NOT NULL, error TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL);
`)

const rows = db.prepare(`
  SELECT platform_id AS id, content AS text, like_count AS likeCount
  FROM comments
  WHERE trim(content) <> ''
  ORDER BY like_count DESC, published_at DESC
  LIMIT 100
`).all()
if (!rows.length) throw new Error('采集库中没有可用评论')

async function requestJson(path, body) {
  const response = await fetch(`${apiBase.replace(/\/$/, '')}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${effectiveKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  const json = await response.json()
  if (!response.ok) throw new Error(`${path} HTTP ${response.status}: ${json.error?.message || 'unknown error'}`)
  return json
}

function textHash(text) { return createHash('sha256').update(text).digest('hex').slice(0, 16) }
function cacheKey(kind, row) { return createHash('sha256').update(`${kind}|v1|${model}|${row.id}|${textHash(row.text)}`).digest('hex') }
const insertClassification = db.prepare('INSERT OR REPLACE INTO llm_classification_cache (cache_key, comment_id, text_hash, model, result_json, created_at) VALUES (?, ?, ?, ?, ?, ?)')
const insertReaction = db.prepare('INSERT OR REPLACE INTO reaction_analysis_cache (cache_key, comment_id, text_hash, model, result_json, created_at) VALUES (?, ?, ?, ?, ?, ?)')
const insertLog = db.prepare('INSERT INTO llm_operation_logs (operation, model, comment_ids_json, input_json, prompt, result_json, error, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
function saveLog(operation, selectedRows, prompt, result, error = '') {
  insertLog.run(operation, model, JSON.stringify(selectedRows.map((row) => row.id)), JSON.stringify(selectedRows.map((row) => ({ id: row.id, text: row.text }))), prompt, JSON.stringify(result ?? null), error, new Date().toISOString())
}

const list = rows.map((row) => `${row.id}\t${String(row.text).replace(/\s+/g, ' ').slice(0, 160)}`).join('\n')
const classificationRows = rows.slice(0, classificationLimit)
const classificationPrompt = [
  '你是一个 B 站 UP 主的评论分类助手。请把每条评论归入以下类别之一：鼓励与认可、有趣互动、选题建议、内容改进意见。',
  '无关评论的 tag 返回 null。只输出 JSON：{"results":[{"id":"...","tag":"..."}]}',
  '', '评论列表（每行 id<TAB>文本）：', classificationRows.map((row) => `${row.id}\t${String(row.text).replace(/\s+/g, ' ').slice(0, 120)}`).join('\n')
].join('\n')
const classification = await requestJson('/chat/completions', {
  model,
  response_format: { type: 'json_object' },
  messages: [{ role: 'user', content: classificationPrompt }]
})
const classificationResult = parseContent(classification.choices?.[0]?.message?.content)
const validTags = new Set(['鼓励与认可', '有趣互动', '选题建议', '内容改进意见'])
const classificationMap = new Map((classificationResult.results || []).map((item) => [String(item.id), validTags.has(item.tag) ? item.tag : null]))
for (const row of classificationRows) insertClassification.run(cacheKey('classification', row), row.id, textHash(row.text), model, JSON.stringify({ tag: classificationMap.get(row.id) ?? null }), new Date().toISOString())
saveLog('classification', classificationRows, classificationPrompt, classificationResult)

const analysis = await requestJson('/chat/completions', {
  model,
  response_format: { type: 'json_object' },
  messages: [{ role: 'user', content: [
    '你是桌宠动作设计助手。筛选出最适合做 Demo 的评论：必须包含明确动作、情绪、表情、庆祝、场景或互动。',
    '为每条命中的评论给出 shouldGenerate=true，并用中文 visualPrompt 描述单个角色的姿势、表情、道具和局部环境；不要文字，最多 180 字。',
    `最多返回 ${limit} 条，按适合演示程度排序。只输出 JSON：{"results":[{"id":"...","shouldGenerate":true,"visualPrompt":"..."}]}`, '',
    '评论列表（每行 id<TAB>文本）：', list
  ].join('\n') }]
})

function parseContent(value) {
  const text = String(value || '').replace(/^```json\s*/i, '').replace(/\s*```$/, '')
  try {
    const parsed = JSON.parse(text)
    return Array.isArray(parsed) ? { results: parsed } : parsed
  } catch { return { results: [] } }
}
const results = parseContent(analysis.choices?.[0]?.message?.content).results || []
const targets = results.filter((item) => item?.id && item?.shouldGenerate && item?.visualPrompt).slice(0, limit)
const reactionMap = new Map(targets.map((item) => [String(item.id), { shouldGenerate: true, intents: item.intents || [], visualPrompt: String(item.visualPrompt).slice(0, 180) }]))
for (const row of rows) insertReaction.run(cacheKey('reaction', row), row.id, textHash(row.text), model, JSON.stringify(reactionMap.get(row.id) ?? null), new Date().toISOString())
saveLog('reaction-analysis', rows, [
  '你是桌宠动作设计助手。筛选出最适合做 Demo 的评论：必须包含明确动作、情绪、表情、庆祝、场景或互动。',
  '为每条命中的评论给出 shouldGenerate=true，并用中文 visualPrompt 描述单个角色的姿势、表情、道具和局部环境；不要文字，最多 180 字。',
  `最多返回 ${limit} 条，按适合演示程度排序。只输出 JSON：{"results":[{"id":"...","shouldGenerate":true,"visualPrompt":"..."}]}`, '',
  '评论列表（每行 id<TAB>文本）：', list
].join('\n'), parseContent(analysis.choices?.[0]?.message?.content))
const insert = db.prepare('INSERT OR REPLACE INTO reaction_cache (cache_key, comment_id, reference_hash, prompt_version, visual_prompt, image_png, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
const hasImage = db.prepare('SELECT 1 FROM reaction_cache WHERE cache_key = ?')
let generated = 0
let failed = 0
for (const item of targets) {
  const cacheKey = createHash('sha256').update(`${referenceHash}|${item.id}|v2`).digest('hex')
  if (hasImage.get(cacheKey)) {
    generated++
    console.log(`复用已有动作图 ${generated}/${targets.length}: ${item.id}`)
    continue
  }
  try {
    const imagePrompt = [
      'Use the same character from the reference image. Keep identity, face, clothes, colors, and art style.',
      `Visual direction: ${String(item.visualPrompt).slice(0, 180)}`,
      'Single complete character with transparent background. Allow only small props or local environmental elements.',
      'No text, watermark, logo, extra people, rectangular background, distant scenery, border, or checkerboard pattern.'
    ].join('\n')
    const form = new FormData()
    form.append('model', 'gpt-image-2')
    form.append('prompt', imagePrompt)
    form.append('size', '1024x1024')
    form.append('background', 'transparent')
    form.append('output_format', 'png')
    form.append('image', new Blob([referenceBytes], { type: 'image/png' }), 'reference.png')
    const response = await fetch(`${apiBase.replace(/\/$/, '')}/images/edits`, { method: 'POST', headers: { Authorization: `Bearer ${effectiveKey}` }, body: form })
    const json = await response.json()
    if (!response.ok || !json.data?.[0]?.b64_json) throw new Error(json.error?.message || `HTTP ${response.status}`)
    const bytes = Buffer.from(json.data[0].b64_json, 'base64')
    insert.run(cacheKey, String(item.id), referenceHash, 2, String(item.visualPrompt).slice(0, 180), bytes, new Date().toISOString())
    saveLog('image-generation', [rows.find((row) => String(row.id) === String(item.id)) || { id: item.id, text: '' }], imagePrompt, { cacheKey, bytes: bytes.length, outputFormat: 'png', background: 'transparent' })
    generated++
    console.log(`已生成 ${generated}/${targets.length}: ${item.id}`)
  } catch (error) {
    failed++
    saveLog('image-generation', [rows.find((row) => String(row.id) === String(item.id)) || { id: item.id, text: '' }], `Visual direction: ${String(item.visualPrompt).slice(0, 180)}`, null, error instanceof Error ? error.message : String(error))
    console.warn(`生成失败 ${item.id}:`, error instanceof Error ? error.message : error)
  }
}
db.close()
console.log(`Demo 预热完成：成功 ${generated} 张，失败 ${failed} 张，候选 ${rows.length} 条。`)
