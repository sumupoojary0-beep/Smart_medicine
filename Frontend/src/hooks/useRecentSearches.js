/**
 * Recent searches, saved on this device only (localStorage).
 * Real data: only things this user actually searched for.
 */
import { useCallback, useState } from 'react'

const KEY = 'sms_recent_searches'
const MAX = 8

function read() {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) || '[]')
    return Array.isArray(list) ? list.filter((x) => typeof x === 'string') : []
  } catch {
    return []
  }
}

function write(list) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list))
  } catch {
    /* storage blocked: recent searches simply are not saved */
  }
}

/** Call from anywhere (e.g. the results page) when a search returned results. */
export function addRecentSearch(query) {
  const text = (query || '').trim()
  if (text.length < 2) return
  const next = [text, ...read().filter((q) => q.toLowerCase() !== text.toLowerCase())].slice(0, MAX)
  write(next)
}

export default function useRecentSearches() {
  const [items, setItems] = useState(read)

  const remove = useCallback((query) => {
    setItems((prev) => {
      const next = prev.filter((q) => q !== query)
      write(next)
      return next
    })
  }, [])

  const clear = useCallback(() => {
    write([])
    setItems([])
  }, [])

  return { items, remove, clear }
}