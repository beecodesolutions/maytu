import { useLayoutEffect, useSyncExternalStore, type MouseEvent } from 'react'
import { scrollWorkspaceToTop } from './workspaceScroll'

const sectionPaths = {
  home: '/hoy',
  stays: '/estadias',
  reservations: '/reservas',
  settings: '/configuracion',
} as const

const settingsTabPaths = {
  accommodations: `${sectionPaths.settings}/alojamientos`,
  general: `${sectionPaths.settings}/general`,
  extras: `${sectionPaths.settings}/extras`,
} as const

type SettingsTab = keyof typeof settingsTabPaths

export function settingsTabHref(tab: SettingsTab) {
  return settingsTabPaths[tab]
}

function findSettingsTab(path: string): SettingsTab | undefined {
  return (Object.keys(settingsTabPaths) as SettingsTab[]).find(
    (tab) => settingsTabHref(tab) === path,
  )
}

export function settingsTabFromPath(pathname: string): SettingsTab {
  return findSettingsTab(pathname.replace(/\/$/, '')) ?? 'accommodations'
}

export type WorkspaceSection = keyof typeof sectionPaths

export function workspaceHref(section: WorkspaceSection) {
  return sectionPaths[section]
}

export function workspaceSectionFromPath(pathname: string): WorkspaceSection {
  const path = pathname.replace(/\/$/, '')
  if (path === '/mas' || findSettingsTab(path)) return 'settings'
  for (const section of Object.keys(sectionPaths) as WorkspaceSection[]) {
    if (workspaceHref(section) === path) return section
  }
  return 'home'
}

export function migrateWorkspaceHash() {
  if (!window.location.hash.startsWith('#/')) return
  const path = window.location.hash.slice(1).replace(/\/$/, '')
  const tab = findSettingsTab(path)
  const href = tab
    ? settingsTabHref(tab)
    : workspaceHref(workspaceSectionFromPath(path))
  window.history.replaceState(
    window.history.state,
    '',
    `${href}${window.location.search}`,
  )
}

export function navigateWorkspace(event: MouseEvent<HTMLAnchorElement>) {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey ||
    event.currentTarget.target === '_blank' ||
    event.currentTarget.hasAttribute('download')
  )
    return
  event.preventDefault()
  const target = new URL(event.currentTarget.href)
  if (target.pathname !== window.location.pathname) {
    window.history.pushState(null, '', target.pathname + target.search)
    window.dispatchEvent(new Event('popstate'))
  }
  scrollWorkspaceToTop()
}

function subscribe(onChange: () => void) {
  window.addEventListener('popstate', onChange)
  return () => window.removeEventListener('popstate', onChange)
}

export function useWorkspaceSection() {
  const section = useSyncExternalStore(
    subscribe,
    () => workspaceSectionFromPath(window.location.pathname),
    () => 'home' as const,
  )
  useLayoutEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' })
  }, [section])
  return section
}

export function useSettingsTab() {
  return useSyncExternalStore(
    subscribe,
    () => settingsTabFromPath(window.location.pathname),
    () => 'accommodations' as const,
  )
}
