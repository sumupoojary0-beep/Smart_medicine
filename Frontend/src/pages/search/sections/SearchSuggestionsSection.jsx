/**
 * Component: SearchSuggestionsSection
 *
 * Purpose:
 *   Displays an intelligent suggestion dropdown / list below the search
 *   bar as the user types. Provides fast access to common medicines
 *   without requiring full typing.
 *
 * Responsibilities:
 *   - Render a scrollable list of SuggestionItem components
 *   - Support keyboard navigation (ArrowUp / ArrowDown / Enter / Escape)
 *   - Highlight the active/hovered suggestion visually
 *   - Support mouse hover selection
 *   - Accept placeholder data (will be replaced by API data in Module 7B)
 *
 * Props:
 *   query       {string}   — current search query (filters suggestions)
 *   onSelect    {Function} — called with the selected medicine name
 *   onClose     {Function} — called when Escape or outside click
 *
 * Dependencies:
 *   - React useState, useEffect, useRef, useCallback
 *   - React Icons (hi2, md)
 *
 * Backend readiness:
 *   - SUGGESTIONS placeholder → GET /api/v1/medicines/suggest?q={query}
 *   - Replace the filtered local array with debounced API call in Module 7B.
 *
 * Accessibility:
 *   - role="listbox" on container
 *   - role="option" + aria-selected on each item
 *   - aria-activedescendant on the input (parent should wire this)
 *   - Keyboard: ArrowDown/Up moves activeIndex, Enter selects, Escape closes
 */

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import useDebounce from '../../../hooks/useDebounce'
import medicineService from '../../../services/medicineService'
import {
  HiOutlineMagnifyingGlass,
  HiOutlineClock,
  HiOutlineArrowUpRight,
} from 'react-icons/hi2'
import { MdMedication } from 'react-icons/md'

// ======================================
// SuggestionItem sub-component
// ======================================
function SuggestionItem({ item, isActive, onSelect, onHover }) {
  return (
    <li
      id={`suggestion-${item.id}`}
      role="option"
      aria-selected={isActive}
      onClick={() => onSelect(item.name)}
      onMouseEnter={() => onHover(item.id)}
      className={[
        'flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors duration-100',
        isActive ? 'bg-primary-50' : 'hover:bg-slate-50',
      ].join(' ')}
    >
      {/* Medicine icon */}
      <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-primary-100 shrink-0">
        <MdMedication size={14} className="text-primary-600" aria-hidden="true" />
      </div>

      {/* Text */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-slate-800 truncate">{item.name}</p>
        <p className="text-[11px] text-slate-400 truncate">{item.generic} · {item.category}</p>
      </div>

      {/* Active indicator */}
      {isActive && (
        <HiOutlineArrowUpRight
          size={13}
          className="text-primary-500 shrink-0"
          aria-hidden="true"
        />
      )}
    </li>
  )
}

// ======================================
// Search Suggestions Section
// ======================================
function SearchSuggestionsSection({ query = '', onSelect, onClose }) {
  const [activeId, setActiveId] = useState(null)

  // Real suggestions from the medicines catalogue (debounced)
  const debounced = useDebounce(query.trim(), 250)
  const { data } = useQuery({
    queryKey: ['medicines', 'suggest', debounced],
    queryFn: async () => (await medicineService.suggest(debounced, 8)).data,
    enabled: debounced.length >= 2,
    staleTime: 5 * 60 * 1000,
  })
  const filtered = useMemo(
    () => (debounced.length >= 2 ? (data?.suggestions ?? []) : []),
    [debounced, data],
  )

  // activeId auto-resolves: if the id no longer exists in filtered
  // after a query change, findIndex returns -1 and keyboard nav restarts.

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e) => {
      if (!filtered.length) return
      const currentIndex = filtered.findIndex((s) => s.id === activeId)

      if (e.key === 'ArrowDown') {
        e.preventDefault()
        const next = currentIndex < filtered.length - 1 ? currentIndex + 1 : 0
        setActiveId(filtered[next].id)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        const prev = currentIndex > 0 ? currentIndex - 1 : filtered.length - 1
        setActiveId(filtered[prev].id)
      } else if (e.key === 'Enter' && activeId) {
        const selected = filtered.find((s) => s.id === activeId)
        if (selected) onSelect?.(selected.name)
      } else if (e.key === 'Escape') {
        onClose?.()
      }
    },
    [filtered, activeId, onSelect, onClose],
  )

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  if (!filtered.length) return null

  return (
    <div
      className="bg-white rounded-xl border border-slate-200 shadow-lg overflow-hidden"
      role="listbox"
      aria-label="Medicine suggestions"
    >
      {/* List header */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-slate-100 bg-slate-50">
        <HiOutlineMagnifyingGlass size={13} className="text-slate-400" aria-hidden="true" />
        <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
          {`Suggestions for "${query.trim()}"`}
        </span>
        <span className="ml-auto text-[10px] text-slate-400">
          {filtered.length} found
        </span>
      </div>

      {/* Scrollable suggestion list */}
      <ul
        className="max-h-64 overflow-y-auto divide-y divide-slate-50"
        aria-live="polite"
        aria-atomic="false"
      >
        {filtered.map((item) => (
          <SuggestionItem
            key={item.id}
            item={item}
            isActive={item.id === activeId}
            onSelect={onSelect}
            onHover={setActiveId}
          />
        ))}
      </ul>

      {/* Footer hint */}
      <div className="flex items-center justify-between px-4 py-2 bg-slate-50 border-t border-slate-100">
        <div className="flex items-center gap-3 text-[10px] text-slate-400">
          <span className="flex items-center gap-1">
            <kbd className="px-1 py-0.5 rounded border border-slate-200 bg-white font-mono text-[9px]">↑↓</kbd>
            Navigate
          </span>
          <span className="flex items-center gap-1">
            <kbd className="px-1 py-0.5 rounded border border-slate-200 bg-white font-mono text-[9px]">↵</kbd>
            Select
          </span>
          <span className="flex items-center gap-1">
            <kbd className="px-1 py-0.5 rounded border border-slate-200 bg-white font-mono text-[9px]">Esc</kbd>
            Close
          </span>
        </div>
        <span className="text-[10px] text-slate-400 flex items-center gap-1">
          <HiOutlineClock size={10} aria-hidden="true" />
          From the medicine catalogue
        </span>
      </div>
    </div>
  )
}

export default SearchSuggestionsSection