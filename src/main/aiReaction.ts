import { app, dialog, type BrowserWindow } from 'electron'
import Database from 'better-sqlite3'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AiReactionProgress, ReactionSpec, Settings, TaggedComment } from './types'
import { recordLlmOperation } from './llmCache'

const MAX_REFERENCE_BYTES = 5 * 1024 * 1024
const MAX_REFERENCE_PIXELS = 16 * 1024 * 1024
const REFERENCE_FILE = 'reference.png'
const CACHE_LIMIT = 10
const REQUEST_TIMEOUT_MS = 180_000
const IMAGE_EDIT_PATH = '/images/edits'
const REACTION_SCHEMA = `CREATE TABLE IF NOT EXISTS reaction_cache (cache_key TEXT PRIMARY KEY, comment_id TEXT NOT NULL, reference_hash TEXT NOT NULL, prompt_version INTEGER NOT NULL, visual_prompt TEXT NOT NULL, image_png BLOB NOT NULL, created_at TEXT NOT NULL)`

function directory(): string { return join(app.getPath('userData'), 'ai-reactions') }
function referencePath(): string { return join(directory(), REFERENCE_FILE) }
function packagedReferencePath(): string { return join(process.resourcesPath, 'demo-reference.png') }
export function getReferencePath(settings: Settings): string | null {
  if (settings.aiReaction.referenceFile !== REFERENCE_FILE) return null
  for (const path of [referencePath(), packagedReferencePath()]) {
    try { if (statSync(path).isFile()) return path } catch { /* try next location */ }
  }
  return null
}
export function getReferenceUrl(settings: Settings): string | null {
  const path = getReferencePath(settings)
  if (!path) return null
  return `pet-skin://ai-reference?v=${statSync(path).mtimeMs}`
}

function isStaticPng(bytes: Buffer): boolean {
  if (bytes.length < 8 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return false
  let offset = 8
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset)
    if (offset + length + 12 > bytes.length) return false
    if (bytes.subarray(offset + 4, offset + 8).toString() === 'acTL') return false
    if (bytes.subarray(offset + 4, offset + 8).toString() === 'IHDR' && length >= 8) {
      const width = bytes.readUInt32BE(offset + 8)
      const height = bytes.readUInt32BE(offset + 12)
      if (!width || !height || width * height > MAX_REFERENCE_PIXELS) return false
    }
    offset += length + 12
  }
  return true
}

export async function chooseAiReference(parent: BrowserWindow): Promise<string | null> {
  const result = await dialog.showOpenDialog(parent, { title: '选择 AI 动作参考图', properties: ['openFile'], filters: [{ name: '静态 PNG', extensions: ['png'] }] })
  if (result.canceled || !result.filePaths[0]) return null
  const bytes = readFileSync(result.filePaths[0])
  if (bytes.length === 0 || bytes.length > MAX_REFERENCE_BYTES || !isStaticPng(bytes)) {
    throw new Error('请选择 5 MB 以内的静态 PNG（不支持 APNG）')
  }
  mkdirSync(directory(), { recursive: true })
  writeFileSync(referencePath(), bytes)
  clearReactionCache()
  return REFERENCE_FILE
}

export function deleteAiReference(): void {
  try { unlinkSync(referencePath()) } catch { /* already absent */ }
  clearReactionCache()
}

function cacheKey(comment: TaggedComment, settings: Settings): string {
  const ref = getReferencePath(settings)
  const hash = ref ? createHash('sha256').update(readFileSync(ref)).digest('hex').slice(0, 16) : 'none'
  return createHash('sha256').update(`${hash}|${comment.id}|v2`).digest('hex')
}
function cachePath(key: string): string { return join(directory(), `reaction-${key}.png`) }
function packagedDbPath(): string { return join(process.resourcesPath, 'collections.sqlite') }
function writableDbPath(): string { return app.isPackaged ? join(app.getPath('userData'), 'collections.sqlite') : join(__dirname, '../../local-data/collections.sqlite') }
function collectionDbPaths(): string[] { return app.isPackaged ? [writableDbPath(), packagedDbPath()] : [writableDbPath()] }
function writeReactionDb(key: string, comment: TaggedComment, settings: Settings, bytes: Buffer): void {
  try {
    const dbPath = writableDbPath()
    mkdirSync(join(dbPath, '..'), { recursive: true })
    const db = new Database(dbPath)
    db.exec(REACTION_SCHEMA)
    const ref = getReferencePath(settings)
    const referenceHash = ref ? createHash('sha256').update(readFileSync(ref)).digest('hex').slice(0, 16) : 'none'
    db.prepare('INSERT OR REPLACE INTO reaction_cache (cache_key, comment_id, reference_hash, prompt_version, visual_prompt, image_png, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(key, comment.id, referenceHash, 2, comment.reaction?.visualPrompt ?? '', bytes, new Date().toISOString())
    db.close()
  } catch (err) { console.warn('[ai-reaction] SQLite cache write failed:', err) }
}
export function getReactionDbImage(key: string): Buffer | null {
  if (!/^[a-f0-9]{64}$/i.test(key)) return null
  for (const dbPath of collectionDbPaths()) {
    if (!existsSync(dbPath)) continue
    try {
      const db = new Database(dbPath, { readonly: true, fileMustExist: true })
      try {
        const row = db.prepare('SELECT image_png FROM reaction_cache WHERE cache_key = ?').get(key) as { image_png?: Buffer } | undefined
        if (row?.image_png) return row.image_png
      } finally { db.close() }
    } catch { /* an older collection database may not have reaction_cache yet */ }
  }
  return null
}
export function getReactionPath(fileName: string): string | null {
  if (!/^reaction-[a-f0-9]{64}\.png$/i.test(fileName)) return null
  const path = join(directory(), fileName)
  try { return statSync(path).isFile() ? path : null } catch { return null }
}

export function clearReactionCache(): void {
  try {
    for (const name of readdirSync(directory())) if (name.startsWith('reaction-') && name.endsWith('.png')) unlinkSync(join(directory(), name))
  } catch { /* directory may not exist */ }
  try {
    const dbPath = writableDbPath()
    if (existsSync(dbPath)) {
      const db = new Database(dbPath)
      db.exec(REACTION_SCHEMA)
      db.exec('DELETE FROM reaction_cache')
      db.close()
    }
  } catch (err) { console.warn('[ai-reaction] SQLite cache clear failed:', err) }
}
export function getReactionUrl(comment: TaggedComment, settings: Settings): string | null {
  if (!settings.aiReaction.enabled || !getReferencePath(settings)) return null
  const key = cacheKey(comment, settings)
  const path = cachePath(key)
  try {
    if (statSync(path).isFile()) return `pet-skin://reaction/${key}.png?v=${statSync(path).mtimeMs}`
  } catch { /* check SQLite cache below */ }
  return getReactionDbImage(key) ? `pet-skin://reaction/${key}.png?v=db` : null
}

function buildPrompt(spec: ReactionSpec): string {
  return ['Use the same character from the reference image.', 'Keep the character identity, face, hair, clothes, colors, and art style.', `Visual direction: ${spec.visualPrompt}`, 'Single complete character with transparent background.', 'Allow only small props or local environmental elements related to the action.', 'Do not generate text, watermark, logo, extra people, rectangular background, sky, distant scenery, border, or checkerboard pattern.'].join('\n')
}

async function generateOne(comment: TaggedComment, settings: Settings, apiKey: string): Promise<void> {
  const ref = getReferencePath(settings)
  if (!ref || !comment.reaction?.shouldGenerate || getReactionUrl(comment, settings)) return
  const prompt = buildPrompt(comment.reaction)
  const form = new FormData()
  form.append('model', 'gpt-image-2')
  form.append('prompt', prompt)
  form.append('size', '1024x1024')
  form.append('background', 'transparent')
  form.append('output_format', 'png')
  form.append('image', new Blob([readFileSync(ref)], { type: 'image/png' }), 'reference.png')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const res = await fetch(`${settings.llm.baseURL.replace(/\/$/, '')}${IMAGE_EDIT_PATH}`, { method: 'POST', headers: { Authorization: `Bearer ${apiKey}` }, body: form, signal: controller.signal })
    const json = await res.json() as { error?: { message?: string }; data?: Array<{ b64_json?: string }> }
    if (!res.ok) throw new Error(`image edit HTTP ${res.status}: ${json.error?.message ?? 'unknown error'}`)
    const value = json.data?.[0]?.b64_json
    if (!value) throw new Error('image edit returned no image')
    const bytes = Buffer.from(value, 'base64')
    if (!isStaticPng(bytes)) throw new Error('generated image is not a valid static PNG')
    mkdirSync(directory(), { recursive: true })
    const key = cacheKey(comment, settings)
    writeFileSync(cachePath(key), bytes)
    writeReactionDb(key, comment, settings, bytes)
    recordLlmOperation({ operation: 'image-generation', model: 'gpt-image-2', comments: [comment], prompt, result: { cacheKey: key, bytes: bytes.length, outputFormat: 'png', background: 'transparent' } })
  } catch (err) {
    recordLlmOperation({ operation: 'image-generation', model: 'gpt-image-2', comments: [comment], prompt, error: err })
    throw err
  } finally { clearTimeout(timer) }
}

export async function prefetchReactionImages(comments: TaggedComment[], settings: Settings, apiKey: string, onProgress?: (progress: AiReactionProgress) => void): Promise<void> {
  if (!settings.aiReaction.enabled || !getReferencePath(settings) || !apiKey) return
  const targets = comments.filter((c) => c.reaction?.shouldGenerate).slice(0, CACHE_LIMIT)
  let completed = 0
  let failed = 0
  onProgress?.({ phase: 'generating', completed, total: targets.length, failed })
  for (const comment of targets) {
    try { await generateOne(comment, settings, apiKey) } catch (err) { failed++; console.warn('[ai-reaction] generation failed:', err) }
    completed++
    onProgress?.({ phase: 'generating', completed, total: targets.length, failed })
  }
}
