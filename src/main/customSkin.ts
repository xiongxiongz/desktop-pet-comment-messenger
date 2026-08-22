import { app, dialog, nativeImage, type BrowserWindow } from 'electron'
import { mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { basename, extname, join } from 'node:path'
import type { CandidateSkinView, CustomSkin } from './types'

const MAX_SKIN_BYTES = 5 * 1024 * 1024
const MAX_SKIN_PIXELS = 16 * 1024 * 1024
const WHITE_THRESHOLD = 245
const CANDIDATE_FILES = ['candidate-skin.png', 'candidate-skin.gif', 'candidate-skin.webp'] as const
const MIME_BY_EXTENSION: Record<string, CustomSkin['mimeType']> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif'
}

function skinDirectory(): string {
  return join(app.getPath('userData'), 'skins')
}

function extensionOf(path: string): string {
  return extname(path).toLowerCase()
}

function candidateFileNameFor(extension: string): (typeof CANDIDATE_FILES)[number] {
  return extension === '.gif' ? 'candidate-skin.gif' : extension === '.webp' ? 'candidate-skin.webp' : 'candidate-skin.png'
}

/** 只允许应用生成的库文件名或旧版本文件名，避免配置被利用以读取任意本机文件。 */
export function isSafeCustomSkinFile(fileName: string): boolean {
  return /^(?:skin-[0-9a-f-]{36}|custom-skin)\.(png|jpe?g|webp|gif)$/i.test(fileName)
}

export function getCustomSkinPath(fileName: string): string | null {
  if (!isSafeCustomSkinFile(fileName)) return null
  const path = join(skinDirectory(), fileName)
  try {
    return statSync(path).isFile() ? path : null
  } catch {
    return null
  }
}

export function getCustomSkinMimeType(fileName: string): CustomSkin['mimeType'] | null {
  return MIME_BY_EXTENSION[extensionOf(fileName)] ?? null
}

export function getLibrarySkinUrl(id: string, item: CustomSkin): string | null {
  const path = getCustomSkinPath(item.fileName)
  if (!path || !/^[a-zA-Z0-9-]{1,80}$/.test(id)) return null
  try {
    return `pet-skin://library/${encodeURIComponent(id)}?v=${statSync(path).mtimeMs}`
  } catch {
    return null
  }
}

function getCandidateFileName(): (typeof CANDIDATE_FILES)[number] | null {
  for (const fileName of CANDIDATE_FILES) {
    try {
      if (statSync(join(skinDirectory(), fileName)).isFile()) return fileName
    } catch {
      // Continue searching known temporary filenames.
    }
  }
  return null
}

export function getCandidateSkinPath(): string | null {
  const fileName = getCandidateFileName()
  return fileName ? join(skinDirectory(), fileName) : null
}

export function getCandidateSkinMimeType(): CustomSkin['mimeType'] | null {
  const fileName = getCandidateFileName()
  return fileName ? MIME_BY_EXTENSION[extensionOf(fileName)] ?? null : null
}

export function getCandidateSkinUrl(): string | null {
  const fileName = getCandidateFileName()
  const path = getCandidateSkinPath()
  if (!fileName || !path) return null
  try {
    return `pet-skin://candidate?v=${statSync(path).mtimeMs}`
  } catch {
    return null
  }
}

export function discardCustomSkinCandidate(): void {
  for (const fileName of CANDIDATE_FILES) {
    try {
      const path = join(skinDirectory(), fileName)
      if (statSync(path).isFile()) unlinkSync(path)
    } catch {
      // Candidate does not exist.
    }
  }
}

function hasExpectedImageSignature(bytes: Buffer, extension: string): boolean {
  if (extension === '.png') {
    return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  }
  if (extension === '.jpg' || extension === '.jpeg') {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  }
  if (extension === '.gif') return bytes.length >= 6 && ['GIF87a', 'GIF89a'].includes(bytes.subarray(0, 6).toString())
  return bytes.length >= 12 && bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP'
}

function isAnimatedPng(bytes: Buffer): boolean {
  for (let offset = 8; offset + 12 <= bytes.length; ) {
    const length = bytes.readUInt32BE(offset)
    if (offset + 12 + length > bytes.length) return false
    if (bytes.subarray(offset + 4, offset + 8).toString() === 'acTL') return true
    offset += length + 12
  }
  return false
}

function isAnimatedWebp(bytes: Buffer): boolean {
  for (let offset = 12; offset + 8 <= bytes.length; ) {
    const length = bytes.readUInt32LE(offset + 4)
    if (bytes.subarray(offset, offset + 4).toString() === 'ANIM') return true
    offset += 8 + length + (length % 2)
  }
  return false
}

function isAnimatedImage(bytes: Buffer, extension: string): boolean {
  return extension === '.gif' || (extension === '.png' && isAnimatedPng(bytes)) || (extension === '.webp' && isAnimatedWebp(bytes))
}

function validateImageDimensions(bytes: Buffer): void {
  const image = nativeImage.createFromBuffer(bytes)
  const { width, height } = image.getSize()
  if (image.isEmpty() || width < 1 || height < 1) throw new Error('无法读取这张图片，请换一张完整的图片')
  if (width * height > MAX_SKIN_PIXELS) throw new Error('图片分辨率过大，请选择 1600 万像素以内的图片')
}

/** 清理与画布边缘相连的白色区域，保留角色内部的白色细节。 */
function removeConnectedWhiteBackground(bitmap: Buffer, width: number, height: number): void {
  const pixels = width * height
  const visited = new Uint8Array(pixels)
  const queue = new Int32Array(pixels)
  let head = 0
  let tail = 0
  const isBackgroundPixel = (index: number): boolean => {
    const offset = index * 4
    const alpha = bitmap[offset + 3]
    if (alpha === 0) return true
    const blue = Math.min(255, Math.round((bitmap[offset] * 255) / alpha))
    const green = Math.min(255, Math.round((bitmap[offset + 1] * 255) / alpha))
    const red = Math.min(255, Math.round((bitmap[offset + 2] * 255) / alpha))
    return red >= WHITE_THRESHOLD && green >= WHITE_THRESHOLD && blue >= WHITE_THRESHOLD
  }
  const enqueueIfBackground = (index: number): void => {
    if (visited[index] || !isBackgroundPixel(index)) return
    visited[index] = 1
    queue[tail++] = index
  }
  for (let x = 0; x < width; x++) {
    enqueueIfBackground(x)
    enqueueIfBackground((height - 1) * width + x)
  }
  for (let y = 1; y < height - 1; y++) {
    enqueueIfBackground(y * width)
    enqueueIfBackground(y * width + width - 1)
  }
  while (head < tail) {
    const index = queue[head++]
    const offset = index * 4
    bitmap[offset] = 0
    bitmap[offset + 1] = 0
    bitmap[offset + 2] = 0
    bitmap[offset + 3] = 0
    const x = index % width
    if (x > 0) enqueueIfBackground(index - 1)
    if (x < width - 1) enqueueIfBackground(index + 1)
    if (index >= width) enqueueIfBackground(index - width)
    if (index < pixels - width) enqueueIfBackground(index + width)
  }
}

function cropTransparentPadding(bitmap: Buffer, width: number, height: number): { bitmap: Buffer; width: number; height: number } {
  let left = width
  let top = height
  let right = -1
  let bottom = -1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (bitmap[(y * width + x) * 4 + 3] === 0) continue
      left = Math.min(left, x)
      top = Math.min(top, y)
      right = Math.max(right, x)
      bottom = Math.max(bottom, y)
    }
  }
  if (right < left || bottom < top || (left === 0 && top === 0 && right === width - 1 && bottom === height - 1)) {
    return { bitmap, width, height }
  }
  const croppedWidth = right - left + 1
  const croppedHeight = bottom - top + 1
  const cropped = Buffer.alloc(croppedWidth * croppedHeight * 4)
  for (let y = 0; y < croppedHeight; y++) {
    const sourceStart = ((top + y) * width + left) * 4
    bitmap.copy(cropped, y * croppedWidth * 4, sourceStart, sourceStart + croppedWidth * 4)
  }
  return { bitmap: cropped, width: croppedWidth, height: croppedHeight }
}

/** 静态图片去掉边缘白底并输出透明 PNG；动态图绝不调用此方法，保证动画不被转码破坏。 */
function makeTransparentSkin(bytes: Buffer): Buffer {
  const image = nativeImage.createFromBuffer(bytes)
  const { width, height } = image.getSize()
  validateImageDimensions(bytes)
  const bitmap = Buffer.from(image.toBitmap())
  removeConnectedWhiteBackground(bitmap, width, height)
  const cropped = cropTransparentPadding(bitmap, width, height)
  return nativeImage.createFromBitmap(cropped.bitmap, { width: cropped.width, height: cropped.height, scaleFactor: 1 }).toPNG()
}

function displayNameFor(sourcePath: string): string {
  const name = basename(sourcePath, extname(sourcePath)).trim().replace(/[\u0000-\u001f]/g, '')
  return (name || '我的皮肤').slice(0, 24)
}

function normalizedName(name: string): string {
  const normalized = name.trim().replace(/[\u0000-\u001f]/g, '').slice(0, 24)
  if (!normalized) throw new Error('请填写 1 到 24 个字符的皮肤名称')
  return normalized
}

/** 显示选图并创建临时候选。动态图原样保存，静态图才做去白边处理。 */
export async function chooseCustomSkinCandidate(parent: BrowserWindow): Promise<CandidateSkinView | null> {
  const result = await dialog.showOpenDialog(parent, {
    title: '选择桌宠皮肤',
    properties: ['openFile'],
    filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }]
  })
  if (result.canceled || result.filePaths.length === 0) return null
  const sourcePath = result.filePaths[0]
  const extension = extensionOf(sourcePath)
  if (!MIME_BY_EXTENSION[extension]) throw new Error('仅支持 PNG、JPG、JPEG、WebP 或 GIF 图片')
  const sourceInfo = statSync(sourcePath)
  if (!sourceInfo.isFile()) throw new Error('请选择一个图片文件')
  if (sourceInfo.size === 0 || sourceInfo.size > MAX_SKIN_BYTES) throw new Error('图片大小需介于 1 字节和 5 MB 之间')
  const bytes = readFileSync(sourcePath)
  if (!hasExpectedImageSignature(bytes, extension)) throw new Error('图片格式与文件扩展名不匹配')
  validateImageDimensions(bytes)
  const animated = isAnimatedImage(bytes, extension)
  const finalExtension = animated ? extension : '.png'
  const candidateFileName = candidateFileNameFor(finalExtension)
  const output = animated ? bytes : makeTransparentSkin(bytes)
  mkdirSync(skinDirectory(), { recursive: true })
  discardCustomSkinCandidate()
  writeFileSync(join(skinDirectory(), candidateFileName), output)
  const url = getCandidateSkinUrl()
  if (!url) throw new Error('暂存图片失败，请重试')
  return { url, defaultName: displayNameFor(sourcePath), animated }
}

/** 将候选文件加入皮肤库；应用生成随机文件名，且每张皮肤都有自己的安全 ID。 */
export function commitCustomSkinCandidate(name: string): CustomSkin | null {
  const candidateFileName = getCandidateFileName()
  const candidatePath = getCandidateSkinPath()
  if (!candidateFileName || !candidatePath) return null
  // 先校验名称，再移动候选文件，避免无效名称留下无法在皮肤库访问的孤立文件。
  const safeName = normalizedName(name)
  const extension = extensionOf(candidateFileName)
  const mimeType = MIME_BY_EXTENSION[extension]
  if (!mimeType) return null
  const bytes = readFileSync(candidatePath)
  const id = `skin-${randomUUID()}`
  const fileName = `${id}${extension}`
  renameSync(candidatePath, join(skinDirectory(), fileName))
  return { id, name: safeName, folderId: '', shape: 'square', fileName, mimeType, animated: isAnimatedImage(bytes, extension), createdAt: new Date().toISOString() }
}
