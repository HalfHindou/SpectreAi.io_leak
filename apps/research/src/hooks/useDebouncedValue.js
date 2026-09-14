import { useEffect, useState } from 'react'

/**
 * Debounce a fast-changing value (search input, slider) so downstream
 * memos / network calls only react to the settled value.
 *
 * @param {*} value
 * @param {number} delay ms (default 150)
 */
export default function useDebouncedValue(value, delay = 150) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(id)
  }, [value, delay])
  return debounced
}
