// 内置皮肤：内联 SVG，零图片资源依赖。
// 做成可插拔 provider：MVP 只实现内置 SVG；后续自定义/Live2D 作为新 provider 接入。

export type SkinId = 'cat' | 'dog' | 'robot'

export interface SkinProvider {
  render(): string // 返回 SVG 字符串
}

const cat: SkinProvider = {
  render: () => `
  <svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg">
    <ellipse cx="60" cy="72" rx="40" ry="38" fill="#ffd9a0"/>
    <path d="M28 42 L20 18 L46 34 Z" fill="#ffd9a0"/>
    <path d="M92 42 L100 18 L74 34 Z" fill="#ffd9a0"/>
    <path d="M30 40 L26 26 L40 34 Z" fill="#ff9ec2"/>
    <path d="M90 40 L94 26 L80 34 Z" fill="#ff9ec2"/>
    <circle cx="46" cy="66" r="6" fill="#3a2c22"/>
    <circle cx="74" cy="66" r="6" fill="#3a2c22"/>
    <circle cx="48" cy="64" r="2" fill="#fff"/>
    <circle cx="76" cy="64" r="2" fill="#fff"/>
    <path d="M56 78 Q60 82 64 78" stroke="#3a2c22" stroke-width="2" fill="none" stroke-linecap="round"/>
    <ellipse cx="42" cy="80" rx="6" ry="4" fill="#ffb3c6" opacity="0.6"/>
    <ellipse cx="78" cy="80" rx="6" ry="4" fill="#ffb3c6" opacity="0.6"/>
    <path d="M60 74 l-3 4 h6 z" fill="#ff9ec2"/>
  </svg>`
}

const dog: SkinProvider = {
  render: () => `
  <svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg">
    <ellipse cx="60" cy="74" rx="40" ry="36" fill="#e8c9a0"/>
    <ellipse cx="26" cy="60" rx="12" ry="22" fill="#a9793f"/>
    <ellipse cx="94" cy="60" rx="12" ry="22" fill="#a9793f"/>
    <circle cx="47" cy="68" r="6" fill="#3a2c22"/>
    <circle cx="73" cy="68" r="6" fill="#3a2c22"/>
    <circle cx="49" cy="66" r="2" fill="#fff"/>
    <circle cx="75" cy="66" r="2" fill="#fff"/>
    <ellipse cx="60" cy="82" rx="8" ry="6" fill="#fff"/>
    <ellipse cx="60" cy="80" rx="5" ry="4" fill="#3a2c22"/>
    <path d="M60 84 V92 M60 92 Q52 92 52 88 M60 92 Q68 92 68 88" stroke="#3a2c22" stroke-width="2" fill="none" stroke-linecap="round"/>
  </svg>`
}

const robot: SkinProvider = {
  render: () => `
  <svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg">
    <rect x="28" y="40" width="64" height="56" rx="14" fill="#9fd3e8"/>
    <line x1="60" y1="40" x2="60" y2="26" stroke="#7fb0c6" stroke-width="3"/>
    <circle cx="60" cy="22" r="6" fill="#ff6699"/>
    <rect x="38" y="56" width="16" height="16" rx="8" fill="#22333b"/>
    <rect x="66" y="56" width="16" height="16" rx="8" fill="#22333b"/>
    <circle cx="46" cy="64" r="3" fill="#7fe0ff"/>
    <circle cx="74" cy="64" r="3" fill="#7fe0ff"/>
    <rect x="48" y="82" width="24" height="6" rx="3" fill="#22333b"/>
    <rect x="20" y="60" width="8" height="20" rx="4" fill="#7fb0c6"/>
    <rect x="92" y="60" width="8" height="20" rx="4" fill="#7fb0c6"/>
  </svg>`
}

const PROVIDERS: Record<SkinId, SkinProvider> = { cat, dog, robot }

export function getSkinSvg(id: SkinId): string {
  return (PROVIDERS[id] ?? cat).render()
}
