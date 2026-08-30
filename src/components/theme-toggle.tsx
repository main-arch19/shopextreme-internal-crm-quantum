'use client'

import { useEffect, useState } from 'react'

type Theme = 'light' | 'dark' | 'system'

const STORAGE_KEY = 'inventory.theme'

/**
 * Light/dark toggle, remembered per browser.
 *
 * Three states rather than two: an explicit choice stamps `data-theme` on the
 * root element and wins over the OS in both directions; "system" removes the
 * attribute and lets `prefers-color-scheme` decide. Without the third state a
 * user whose OS is dark cannot choose light and have it stick.
 *
 * Every storage access is wrapped — private browsing and blocked site data
 * throw on read as well as write, and a theme toggle must never be the reason
 * a page fails to render.
 */
function readStoredTheme(): Theme {
  if (typeof window === 'undefined') return 'system'
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    return saved === 'light' || saved === 'dark' ? saved : 'system'
  } catch {
    return 'system'
  }
}

function applyTheme(theme: Theme) {
  const root = document.documentElement
  if (theme === 'system') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', theme)
}

export function ThemeToggle() {
  // Lazy initializer, not an effect: reading in an effect renders the wrong
  // icon first and swaps it, which reads as a glitch.
  const [theme, setTheme] = useState<Theme>(readStoredTheme)

  // Keeps the DOM in step when the value changes. The inline script in the
  // root layout handles the first paint, so this only covers later toggles.
  useEffect(() => {
    applyTheme(theme)
    try {
      if (theme === 'system') localStorage.removeItem(STORAGE_KEY)
      else localStorage.setItem(STORAGE_KEY, theme)
    } catch {
      // Storage unavailable — the choice applies for this page view only.
    }
  }, [theme])

  const isDark =
    theme === 'dark' ||
    (theme === 'system' &&
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-color-scheme: dark)').matches)

  return (
    <button
      type="button"
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      title={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      className="flex h-9 w-9 items-center justify-center rounded-full border border-line text-text-secondary transition-colors hover:bg-surface-subtle"
    >
      {isDark ? (
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      ) : (
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z" />
        </svg>
      )}
    </button>
  )
}
