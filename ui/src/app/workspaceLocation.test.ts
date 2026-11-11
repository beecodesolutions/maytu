import type { MouseEvent } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import {
  migrateWorkspaceHash,
  navigateWorkspace,
  settingsTabFromPath,
  settingsTabHref,
  workspaceHref,
  workspaceSectionFromPath,
} from './workspaceLocation'

afterEach(() => vi.unstubAllGlobals())

it.each([
  ['/hoy', 'home'],
  ['/estadias', 'stays'],
  ['/estadias/', 'stays'],
  ['/reservas', 'reservations'],
  ['/configuracion', 'settings'],
  ['/configuracion/alojamientos', 'settings'],
  ['/configuracion/general', 'settings'],
  ['/configuracion/extras/', 'settings'],
  ['/mas', 'settings'],
  ['/', 'home'],
] as const)('resolves direct route %s', (path, section) => {
  expect(workspaceSectionFromPath(path)).toBe(section)
  expect(workspaceHref(section)).not.toContain('#')
})

it.each(['accommodations', 'general', 'extras'] as const)(
  'resolves the settings tab %s from its URL',
  (tab) => {
    expect(settingsTabFromPath(`${settingsTabHref(tab)}/`)).toBe(tab)
  },
)

it.each(['/configuracion', '/mas'])('opens the default tab at %s', (path) => {
  expect(settingsTabFromPath(path)).toBe('accommodations')
})

it('migrates bookmarked hash URLs without adding a history entry or losing query/state', () => {
  const replaceState = vi.fn()
  vi.stubGlobal('window', {
    location: { hash: '#/reservas', search: '?demo=1' },
    history: { state: { saved: true }, replaceState },
  })
  migrateWorkspaceHash()
  expect(replaceState).toHaveBeenCalledWith(
    { saved: true },
    '',
    '/reservas?demo=1',
  )
})

it('leaves clean URLs unchanged', () => {
  const replaceState = vi.fn()
  vi.stubGlobal('window', { location: { hash: '' }, history: { replaceState } })
  migrateWorkspaceHash()
  expect(replaceState).not.toHaveBeenCalled()
})

function linkEvent(overrides: Partial<MouseEvent<HTMLAnchorElement>> = {}) {
  // Minimal event fixture: only fields consumed by the navigation handler.
  return {
    defaultPrevented: false,
    button: 0,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    currentTarget: {
      href: 'http://localhost/estadias',
      target: '',
      hasAttribute: () => false,
    },
    preventDefault: vi.fn(),
    ...overrides,
  } as MouseEvent<HTMLAnchorElement>
}

it('navigates without reloading and notifies route/dialog subscribers', () => {
  const pushState = vi.fn(),
    dispatchEvent = vi.fn(),
    scrollTo = vi.fn()
  vi.stubGlobal('window', {
    location: { pathname: '/hoy' },
    history: { pushState },
    dispatchEvent,
    scrollTo,
  })
  vi.stubGlobal('document', { getElementById: () => null })
  const event = linkEvent()
  navigateWorkspace(event)
  expect(event.preventDefault).toHaveBeenCalledOnce()
  expect(pushState).toHaveBeenCalledWith(null, '', '/estadias')
  expect(dispatchEvent.mock.calls[0]?.[0].type).toBe('popstate')
  expect(scrollTo).toHaveBeenCalledOnce()
})

it.each([
  { ctrlKey: true },
  { metaKey: true },
  { shiftKey: true },
  { altKey: true },
  { button: 1 },
  { defaultPrevented: true },
])('preserves native modified click behavior: %j', (modifier) => {
  const event = linkEvent(modifier)
  navigateWorkspace(event)
  expect(event.preventDefault).not.toHaveBeenCalled()
})
