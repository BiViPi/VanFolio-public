// ─────────────────────────────────────────────────────────────────────────────
// docsModal.ts — Documentation Modal
// Triggered by: Help → Documentation
// ─────────────────────────────────────────────────────────────────────────────

import MarkdownIt from 'markdown-it'
import { getLocale } from '../shared/i18n'

// Lightweight renderer — independent instance, not shared with preview.ts
const md = new MarkdownIt({ html: false, breaks: true, linkify: false, typographer: true })

// Section slug order — drives nav list rendering
const SECTION_ORDER = [
  'getting-started',
  'writing-and-tabs',
  'markdown-and-media',
  'preview-and-layout',
  'export',
  'collections-and-vault',
  'settings-and-typography',
  'archive-and-safety',
] as const

type SectionSlug = typeof SECTION_ORDER[number]

// Nav labels per locale — extend as locales are translated
const SECTION_LABELS: Record<string, Record<SectionSlug, string>> = {
  en: {
    'getting-started':         'Getting Started',
    'writing-and-tabs':        'Writing & Tabs',
    'markdown-and-media':      'Markdown & Media',
    'preview-and-layout':      'Preview & Layout',
    'export':                  'Export',
    'collections-and-vault':   'Collections & Vault',
    'settings-and-typography': 'Settings & Typography',
    'archive-and-safety':      'Archive & Safety',
  },
  vi: {
    'getting-started':         'Bắt đầu',
    'writing-and-tabs':        'Viết & Tab',
    'markdown-and-media':      'Markdown & Media',
    'preview-and-layout':      'Preview & Layout',
    'export':                  'Xuất file',
    'collections-and-vault':   'Collections & Vault',
    'settings-and-typography': 'Cài đặt & Typography',
    'archive-and-safety':      'Lưu trữ & Bảo toàn',
  },
  ja: {
    'getting-started':         'はじめに',
    'writing-and-tabs':        '執筆とタブ',
    'markdown-and-media':      'Markdownとメディア',
    'preview-and-layout':      'プレビューとレイアウト',
    'export':                  'エクスポート',
    'collections-and-vault':   'コレクションとVault',
    'settings-and-typography': '設定とタイポグラフィ',
    'archive-and-safety':      'アーカイブと安全性',
  },
  ko: {
    'getting-started':         '시작하기',
    'writing-and-tabs':        '작성 및 탭',
    'markdown-and-media':      'Markdown 및 미디어',
    'preview-and-layout':      '미리보기 및 레이아웃',
    'export':                  '내보내기',
    'collections-and-vault':   'Collections & Vault',
    'settings-and-typography': '설정 및 타이포그래피',
    'archive-and-safety':      '아카이브 및 안전',
  },
  de: {
    'getting-started':         'Erste Schritte',
    'writing-and-tabs':        'Schreiben & Tabs',
    'markdown-and-media':      'Markdown & Medien',
    'preview-and-layout':      'Vorschau & Layout',
    'export':                  'Export',
    'collections-and-vault':   'Sammlungen & Vault',
    'settings-and-typography': 'Einstellungen & Typografie',
    'archive-and-safety':      'Archiv & Sicherheit',
  },
  'zh-CN': {
    'getting-started':         '开始使用',
    'writing-and-tabs':        '写作与标签',
    'markdown-and-media':      'Markdown与媒体',
    'preview-and-layout':      '预览与布局',
    'export':                  '导出',
    'collections-and-vault':   '集合与Vault',
    'settings-and-typography': '设置与排版',
    'archive-and-safety':      '归档与安全',
  },
  'pt-BR': {
    'getting-started':         'Primeiros Passos',
    'writing-and-tabs':        'Escrita & Abas',
    'markdown-and-media':      'Markdown & Mídia',
    'preview-and-layout':      'Prévia & Layout',
    'export':                  'Exportar',
    'collections-and-vault':   'Coleções & Vault',
    'settings-and-typography': 'Configurações & Tipografia',
    'archive-and-safety':      'Arquivo & Segurança',
  },
  fr: {
    'getting-started':         'Démarrage',
    'writing-and-tabs':        'Écriture & Onglets',
    'markdown-and-media':      'Markdown & Médias',
    'preview-and-layout':      'Aperçu & Mise en page',
    'export':                  'Exporter',
    'collections-and-vault':   'Collections & Vault',
    'settings-and-typography': 'Paramètres & Typographie',
    'archive-and-safety':      'Archive & Sécurité',
  },
  ru: {
    'getting-started':         'Начало работы',
    'writing-and-tabs':        'Написание и вкладки',
    'markdown-and-media':      'Markdown и медиа',
    'preview-and-layout':      'Предпросмотр и макет',
    'export':                  'Экспорт',
    'collections-and-vault':   'Коллекции и Vault',
    'settings-and-typography': 'Настройки и типографика',
    'archive-and-safety':      'Архив и безопасность',
  },
  es: {
    'getting-started':         'Primeros pasos',
    'writing-and-tabs':        'Escritura y pestañas',
    'markdown-and-media':      'Markdown y medios',
    'preview-and-layout':      'Vista previa y diseño',
    'export':                  'Exportar',
    'collections-and-vault':   'Colecciones y Vault',
    'settings-and-typography': 'Ajustes y tipografía',
    'archive-and-safety':      'Archivo y seguridad',
  },
}

// ── Module state ─────────────────────────────────────────────────────────────
let parsedSections: Partial<Record<SectionSlug, string>> = {}
let activeSection: SectionSlug = SECTION_ORDER[0]
let isBound = false

// ── Public API ────────────────────────────────────────────────────────────────
export async function openDocsModal(): Promise<void> {
  await loadLocale(getLocale())
  renderNav()
  renderSection(activeSection)
  document.getElementById('docs-overlay')?.classList.add('open')
}

export function closeDocsModal(): void {
  document.getElementById('docs-overlay')?.classList.remove('open')
}

export function initDocsModal(): void {
  if (isBound) return
  isBound = true

  document.getElementById('docs-close')?.addEventListener('click', closeDocsModal)

  document.getElementById('docs-overlay')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeDocsModal()
  })

  window.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      const overlay = document.getElementById('docs-overlay')
      if (overlay?.classList.contains('open')) {
        e.stopPropagation()
        closeDocsModal()
      }
    }
  })

  // Reload content when locale changes
  window.addEventListener('i18n:changed', () => {
    if (!document.getElementById('docs-overlay')?.classList.contains('open')) return
    loadLocale(getLocale()).then(() => {
      renderNav()
      // Keep current section if it still has content, else reset to first
      if (!parsedSections[activeSection]) activeSection = SECTION_ORDER[0]
      renderSection(activeSection)
    }).catch(console.error)
  })
}

// ── Internal ──────────────────────────────────────────────────────────────────
async function loadLocale(locale: string): Promise<void> {
  try {
    const raw = await loadMarkdownFile(locale)
    parsedSections = parseSections(raw)
  } catch {
    // Fallback to English
    try {
      const raw = await loadMarkdownFile('en')
      parsedSections = parseSections(raw)
    } catch (err) {
      console.error('[docsModal] Failed to load docs content:', err)
      parsedSections = {}
    }
  }
}

async function loadMarkdownFile(locale: string): Promise<string> {
  // Dynamic import with Vite raw suffix — bundled at build time
  const localeMap: Record<string, () => Promise<{ default: string }>> = {
    'en':    () => import('./docs/content/en.md?raw') as Promise<{ default: string }>,
    'vi':    () => import('./docs/content/vi.md?raw') as Promise<{ default: string }>,
    'ja':    () => import('./docs/content/ja.md?raw') as Promise<{ default: string }>,
    'ko':    () => import('./docs/content/ko.md?raw') as Promise<{ default: string }>,
    'de':    () => import('./docs/content/de.md?raw') as Promise<{ default: string }>,
    'zh-CN': () => import('./docs/content/zh-CN.md?raw') as Promise<{ default: string }>,
    'pt-BR': () => import('./docs/content/pt-BR.md?raw') as Promise<{ default: string }>,
    'fr':    () => import('./docs/content/fr.md?raw') as Promise<{ default: string }>,
    'ru':    () => import('./docs/content/ru.md?raw') as Promise<{ default: string }>,
    'es':    () => import('./docs/content/es.md?raw') as Promise<{ default: string }>,
  }
  const loader = localeMap[locale] ?? localeMap['en']
  const module = await loader()
  return module.default
}

function parseSections(markdown: string): Partial<Record<SectionSlug, string>> {
  const result: Partial<Record<SectionSlug, string>> = {}
  // Split on <!-- section:slug --> markers
  const parts = markdown.split(/^<!-- section:([\w-]+) -->$/m)
  for (let i = 1; i < parts.length; i += 2) {
    const slug = parts[i].trim() as SectionSlug
    const content = parts[i + 1]?.trim() ?? ''
    if (SECTION_ORDER.includes(slug)) {
      result[slug] = content
    }
  }
  return result
}

function renderNav(): void {
  const locale = getLocale()
  const labels = SECTION_LABELS[locale] ?? SECTION_LABELS['en']
  const list = document.getElementById('docs-nav-list')
  if (!list) return

  list.innerHTML = ''
  for (const slug of SECTION_ORDER) {
    const li = document.createElement('li')
    li.className = 'docs-nav-item' + (slug === activeSection ? ' active' : '')
    li.setAttribute('data-section', slug)
    li.textContent = labels[slug]
    li.addEventListener('click', () => {
      activeSection = slug
      renderNav()
      renderSection(slug)
    })
    list.appendChild(li)
  }
}

function renderSection(slug: SectionSlug): void {
  const content = parsedSections[slug] ?? ''
  const el = document.getElementById('docs-content')
  if (el) el.innerHTML = md.render(content)
}
