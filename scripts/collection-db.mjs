import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

const SCHEMA = `
CREATE TABLE IF NOT EXISTS videos (
  bvid TEXT PRIMARY KEY,
  aid TEXT NOT NULL,
  title TEXT NOT NULL,
  pubdate TEXT NOT NULL,
  last_collected_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS video_pages (
  bvid TEXT NOT NULL REFERENCES videos(bvid) ON DELETE CASCADE,
  page INTEGER NOT NULL,
  cid TEXT NOT NULL,
  part TEXT NOT NULL,
  duration INTEGER NOT NULL,
  PRIMARY KEY (bvid, page)
);

CREATE TABLE IF NOT EXISTS comments (
  bvid TEXT NOT NULL REFERENCES videos(bvid) ON DELETE CASCADE,
  platform_id TEXT NOT NULL,
  author TEXT NOT NULL,
  author_id TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL,
  like_count INTEGER NOT NULL DEFAULT 0,
  reply_count INTEGER NOT NULL DEFAULT 0,
  sub_reply_count INTEGER NOT NULL DEFAULT 0,
  state INTEGER NOT NULL DEFAULT 0,
  invisible INTEGER NOT NULL DEFAULT 0,
  published_at TEXT NOT NULL,
  first_collected_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  PRIMARY KEY (bvid, platform_id)
);

CREATE INDEX IF NOT EXISTS idx_comments_video_published
  ON comments(bvid, published_at);

CREATE INDEX IF NOT EXISTS idx_comments_video_reply_count
  ON comments(bvid, reply_count);

CREATE TABLE IF NOT EXISTS danmaku (
  bvid TEXT NOT NULL REFERENCES videos(bvid) ON DELETE CASCADE,
  platform_id TEXT NOT NULL,
  page INTEGER NOT NULL,
  cid TEXT NOT NULL,
  author_hash TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL,
  published_at TEXT NOT NULL,
  progress_ms INTEGER NOT NULL DEFAULT 0,
  mode INTEGER NOT NULL DEFAULT 0,
  segment_index INTEGER NOT NULL,
  first_collected_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  PRIMARY KEY (bvid, platform_id)
);

CREATE INDEX IF NOT EXISTS idx_danmaku_video_published
  ON danmaku(bvid, published_at);

CREATE INDEX IF NOT EXISTS idx_danmaku_video_progress
  ON danmaku(bvid, progress_ms);

CREATE TABLE IF NOT EXISTS collection_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bvid TEXT NOT NULL REFERENCES videos(bvid) ON DELETE CASCADE,
  collected_at TEXT NOT NULL,
  comment_count INTEGER NOT NULL,
  danmaku_count INTEGER NOT NULL,
  comment_pages INTEGER NOT NULL,
  danmaku_pages_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reaction_cache (
  cache_key TEXT PRIMARY KEY,
  comment_id TEXT NOT NULL,
  reference_hash TEXT NOT NULL,
  prompt_version INTEGER NOT NULL,
  visual_prompt TEXT NOT NULL,
  image_png BLOB NOT NULL,
  created_at TEXT NOT NULL
);

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

export function openCollectionDatabase(dbPath) {
  mkdirSync(dirname(dbPath), { recursive: true })
  const db = new Database(dbPath)
  db.pragma('foreign_keys = ON')
  // DELETE（经典 rollback）而非 WAL：本库作为只读快照打进 dmg，
  // WAL 库即便只读打开也要在旁创建 -wal/-shm 边车文件，在只读的 Resources 目录会失败。
  db.pragma('journal_mode = DELETE')
  db.exec(SCHEMA)

  const upsertVideo = db.prepare(`
    INSERT INTO videos (bvid, aid, title, pubdate, last_collected_at)
    VALUES (@bvid, @aid, @title, @pubdate, @collectedAt)
    ON CONFLICT (bvid) DO UPDATE SET
      aid = excluded.aid,
      title = excluded.title,
      pubdate = excluded.pubdate,
      last_collected_at = excluded.last_collected_at
  `)

  const upsertPage = db.prepare(`
    INSERT INTO video_pages (bvid, page, cid, part, duration)
    VALUES (@bvid, @page, @cid, @part, @duration)
    ON CONFLICT (bvid, page) DO UPDATE SET
      cid = excluded.cid,
      part = excluded.part,
      duration = excluded.duration
  `)

  const upsertComment = db.prepare(`
    INSERT INTO comments (
      bvid, platform_id, author, author_id, content, like_count,
      reply_count, sub_reply_count, state, invisible,
      published_at, first_collected_at, last_seen_at
    ) VALUES (
      @bvid, @platformId, @author, @authorId, @text, @likeCount,
      @replyCount, @subReplyCount, @state, @invisible,
      @publishedAt, @collectedAt, @collectedAt
    )
    ON CONFLICT (bvid, platform_id) DO UPDATE SET
      author = excluded.author,
      author_id = excluded.author_id,
      content = excluded.content,
      like_count = excluded.like_count,
      reply_count = excluded.reply_count,
      sub_reply_count = excluded.sub_reply_count,
      state = excluded.state,
      invisible = excluded.invisible,
      published_at = excluded.published_at,
      last_seen_at = excluded.last_seen_at
  `)

  const upsertDanmaku = db.prepare(`
    INSERT INTO danmaku (
      bvid, platform_id, page, cid, author_hash, content, published_at,
      progress_ms, mode, segment_index, first_collected_at, last_seen_at
    ) VALUES (
      @bvid, @platformId, @sourcePage, @sourceCid, @author, @text, @publishedAt,
      @progressMs, @mode, @segmentIndex, @collectedAt, @collectedAt
    )
    ON CONFLICT (bvid, platform_id) DO UPDATE SET
      page = excluded.page,
      cid = excluded.cid,
      author_hash = excluded.author_hash,
      content = excluded.content,
      published_at = excluded.published_at,
      progress_ms = excluded.progress_ms,
      mode = excluded.mode,
      segment_index = excluded.segment_index,
      last_seen_at = excluded.last_seen_at
  `)

  const insertRun = db.prepare(`
    INSERT INTO collection_runs (
      bvid, collected_at, comment_count, danmaku_count, comment_pages, danmaku_pages_json
    ) VALUES (@bvid, @collectedAt, @commentCount, @danmakuCount, @commentPages, @danmakuPagesJson)
  `)

  const saveCollection = db.transaction(({ video, comments, danmaku, collectedAt, commentResult, danmakuResult }) => {
    const pubdate = new Date(Number(video.pubdate) * 1000).toISOString()
    upsertVideo.run({
      bvid: video.bvid,
      aid: String(video.aid),
      title: video.title,
      pubdate,
      collectedAt
    })

    for (const page of video.pages) {
      upsertPage.run({
        bvid: video.bvid,
        page: page.page,
        cid: String(page.cid),
        part: page.part || '',
        duration: Number(page.duration || 0)
      })
    }

    for (const comment of comments) {
      upsertComment.run({ ...comment, bvid: video.bvid, collectedAt })
    }

    for (const item of danmaku) {
      upsertDanmaku.run({ ...item, bvid: video.bvid, collectedAt })
    }

    insertRun.run({
      bvid: video.bvid,
      collectedAt,
      commentCount: comments.length,
      danmakuCount: danmaku.length,
      commentPages: commentResult.pageCount,
      danmakuPagesJson: JSON.stringify(danmakuResult.pages)
    })
  })

  const getCounts = (bvid) => db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM comments WHERE bvid = @bvid) AS comments,
      (SELECT COUNT(*) FROM danmaku WHERE bvid = @bvid) AS danmaku,
      (SELECT COUNT(*) FROM collection_runs WHERE bvid = @bvid) AS runs
  `).get({ bvid })

  return {
    saveCollection,
    getCounts,
    close: () => db.close()
  }
}
