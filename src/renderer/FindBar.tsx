import { useEffect, useRef, useState } from 'react'

export interface FindBarProps {
  open: boolean
  onClose: () => void
  /** 执行查找，返回命中数量 */
  onSearch: (needle: string, caseSensitive: boolean) => number
  /** 跳到第 index 个命中 */
  onGoTo: (index: number) => void
  /** 替换当前选区 */
  onReplaceOne: (text: string) => void
  /** 全部替换 */
  onReplaceAll: (text: string) => number
}

/**
 * 查找 / 替换栏。
 *
 * 用 Ctrl+F 唤起；「上一个 / 下一个」按命中顺序循环。
 */
export function FindBar(props: FindBarProps) {
  const { open, onClose, onSearch, onGoTo, onReplaceOne, onReplaceAll } = props

  const [needle, setNeedle] = useState('')
  const [replacement, setReplacement] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [hits, setHits] = useState(0)
  const [cursor, setCursor] = useState(0)

  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (open) requestAnimationFrame(() => inputRef.current?.focus())
  }, [open])

  const runSearch = (text: string, cs: boolean) => {
    const count = onSearch(text, cs)
    setHits(count)
    setCursor(count > 0 ? 0 : 0)
    if (count > 0) onGoTo(0)
  }

  if (!open) return null

  const step = (delta: number) => {
    if (hits === 0) return
    const next = (cursor + delta + hits) % hits
    setCursor(next)
    onGoTo(next)
  }

  return (
    <div className="tfn-findbar">
      <div className="tfn-findbar__row">
        <input
          ref={inputRef}
          className="tfn-findbar__input"
          placeholder="查找"
          value={needle}
          onChange={(e) => {
            setNeedle(e.target.value)
            runSearch(e.target.value, caseSensitive)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              step(e.shiftKey ? -1 : 1)
            } else if (e.key === 'Escape') {
              e.preventDefault()
              onClose()
            }
          }}
        />
        <span className="tfn-findbar__count">
          {needle ? (hits === 0 ? '无结果' : `${cursor + 1}/${hits}`) : ''}
        </span>
        <button className="tfn-findbar__btn" onClick={() => step(-1)} title="上一个 (Shift+Enter)">
          ↑
        </button>
        <button className="tfn-findbar__btn" onClick={() => step(1)} title="下一个 (Enter)">
          ↓
        </button>
        <label className="tfn-findbar__case">
          <input
            type="checkbox"
            checked={caseSensitive}
            onChange={(e) => {
              setCaseSensitive(e.target.checked)
              runSearch(needle, e.target.checked)
            }}
          />
          Aa
        </label>
        <button className="tfn-findbar__btn" onClick={onClose} title="关闭 (Esc)">
          ×
        </button>
      </div>

      <div className="tfn-findbar__row">
        <input
          className="tfn-findbar__input"
          placeholder="替换为"
          value={replacement}
          onChange={(e) => setReplacement(e.target.value)}
        />
        <button className="tfn-findbar__btn" onClick={() => onReplaceOne(replacement)} disabled={hits === 0}>
          替换
        </button>
        <button
          className="tfn-findbar__btn"
          onClick={() => {
            const n = onReplaceAll(replacement)
            setHits(0)
            setCursor(0)
            void n
          }}
          disabled={hits === 0}
        >
          全部替换
        </button>
      </div>
    </div>
  )
}
