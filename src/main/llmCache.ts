import { app } from 'electron'
import Database from 'better-sqlite3'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Comment, CommentTag, ReactionSpec } from './types'

const SCHEMA = `
CREATE TABLE IF NOT EXISTS llm_classification_cache (
  cache_key TEXT PRIMARY KEY,
  comment_id TEXT NOT NULL,
  text_hash TEXT NOT NULL,
  model TEXT NOT NULL,
  result_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS reaction_analysis_cache (
  cache_key TEXT PRIMARY KEY,
  comment_id TEXT NOT NULL,
  text_hash TEXT NOT NULL,
  model TEXT NOT NULL,
  result_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS llm_operation_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  operation TEXT NOT NULL,
  model TEXT NOT NULL,
  comment_ids_json TEXT NOT NULL,
  input_json TEXT NOT NULL,
  prompt TEXT NOT NULL,
  result_json TEXT NOT NULL,
  error TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
`

export interface LlmOperationLog {
  id: number
  operation: string
  model: string
  commentIds: string[]
  input: string
  prompt: string
  result: string
  error: string
  createdAt: string
}

function resourceDbPath(): string { return join(process.resourcesPath, 'collections.sqlite') }
function writableDbPath(): string { return app.isPackaged ? join(app.getPath('userData'), 'collections.sqlite') : join(__dirname, '../../local-data/collections.sqlite') }
function dbPaths(): string[] { return app.isPackaged ? [writableDbPath(), resourceDbPath()] : [writableDbPath()] }
function textHash(text: string): string { return createHash('sha256').update(text).digest('hex').slice(0, 16) }
function cacheKey(kind: string, comment: Comment, model: string): string {
  return createHash('sha256').update(`${kind}|v1|${model}|${comment.id}|${textHash(comment.text)}`).digest('hex')
}

function withWritable<T>(fn: (db: Database.Database) => T): T | null {
  try {
    const path = writableDbPath()
    mkdirSync(join(path, '..'), { recursive: true })
    const db = new Database(path)
    db.exec(SCHEMA)
    try { return fn(db) } finally { db.close() }
  } catch (err) {
    console.warn('[llm-cache] SQLite operation failed:', err)
    return null
  }
}

function fromReadable<T>(fn: (db: Database.Database) => T): T | undefined {
  for (const path of dbPaths()) {
    if (!existsSync(path)) continue
    try {
      const db = new Database(path, { readonly: true, fileMustExist: true })
      try {
        const value = fn(db)
        if (value !== undefined) return value
      } finally { db.close() }
    } catch { /* old or incomplete database; try the next source */ }
  }
  return undefined
}

export function getCachedClassification(comment: Comment, model: string): CommentTag | null | undefined {
  const key = cacheKey('classification', comment, model)
  const value = fromReadable((db) => {
    const row = db.prepare('SELECT result_json FROM llm_classification_cache WHERE cache_key = ?').get(key) as { result_json?: string } | undefined
    return row ? JSON.parse(row.result_json ?? '{}') as { tag?: CommentTag | null } : undefined
  })
  return value === undefined ? undefined : value?.tag ?? null
}

export function saveClassification(comment: Comment, model: string, tag: CommentTag | null): void {
  const key = cacheKey('classification', comment, model)
  withWritable((db) => db.prepare('INSERT OR REPLACE INTO llm_classification_cache (cache_key, comment_id, text_hash, model, result_json, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
    key, comment.id, textHash(comment.text), model, JSON.stringify({ tag }), new Date().toISOString()
  ))
}

export function getCachedReaction(comment: Comment, model: string): ReactionSpec | null | undefined {
  const key = cacheKey('reaction', comment, model)
  return fromReadable((db) => {
    const row = db.prepare('SELECT result_json FROM reaction_analysis_cache WHERE cache_key = ?').get(key) as { result_json?: string } | undefined
    return row ? JSON.parse(row.result_json ?? 'null') as ReactionSpec | null : undefined
  })
}

export function saveReaction(comment: Comment, model: string, reaction: ReactionSpec | null): void {
  const key = cacheKey('reaction', comment, model)
  withWritable((db) => db.prepare('INSERT OR REPLACE INTO reaction_analysis_cache (cache_key, comment_id, text_hash, model, result_json, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
    key, comment.id, textHash(comment.text), model, JSON.stringify(reaction), new Date().toISOString()
  ))
}

export function recordLlmOperation(input: {
  operation: string
  model: string
  comments: Comment[]
  prompt: string
  result?: unknown
  error?: unknown
}): void {
  withWritable((db) => {
    db.prepare('INSERT INTO llm_operation_logs (operation, model, comment_ids_json, input_json, prompt, result_json, error, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
      input.operation,
      input.model,
      JSON.stringify(input.comments.map((comment) => comment.id)),
      JSON.stringify(input.comments.map((comment) => ({ id: comment.id, text: comment.text }))),
      input.prompt,
      JSON.stringify(input.result ?? null),
      input.error instanceof Error ? input.error.message : input.error ? String(input.error) : '',
      new Date().toISOString()
    )
    db.exec('DELETE FROM llm_operation_logs WHERE id NOT IN (SELECT id FROM llm_operation_logs ORDER BY id DESC LIMIT 1000)')
  })
}

export function listLlmOperationLogs(limit = 200): LlmOperationLog[] {
  const rows: Array<Record<string, unknown>> = []
  for (const path of dbPaths()) {
    if (!existsSync(path)) continue
    try {
      const db = new Database(path, { readonly: true, fileMustExist: true })
      try {
        rows.push(...db.prepare('SELECT id, operation, model, comment_ids_json, input_json, prompt, result_json, error, created_at FROM llm_operation_logs ORDER BY id DESC LIMIT ?').all(Math.max(1, Math.min(1000, limit))) as Array<Record<string, unknown>>)
      } finally { db.close() }
    } catch { /* old database without the log table */ }
  }
  return rows
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')) || Number(b.id) - Number(a.id))
    .slice(0, Math.max(1, Math.min(1000, limit)))
    .map((row) => ({
    id: Number(row.id),
    operation: String(row.operation),
    model: String(row.model),
    commentIds: JSON.parse(String(row.comment_ids_json || '[]')) as string[],
    input: String(row.input_json || '[]'),
    prompt: String(row.prompt || ''),
    result: String(row.result_json || 'null'),
    error: String(row.error || ''),
    createdAt: String(row.created_at || '')
  }))
}
