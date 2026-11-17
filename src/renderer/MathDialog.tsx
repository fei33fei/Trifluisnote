import { useEffect, useRef, useState } from 'react'
import { renderMathHtml } from '../core/math'

export interface MathDialogProps {
  /** 公式当前的 LaTeX 源码 */
  value: string
  onCancel: () => void
  onApply: (value: string) => void
}

/**
 * 公式编辑框。
 *
 * 所见即所得模式下公式是「渲染好的一坨」，没法直接改；
 * 双击它就弹这个框改 LaTeX 源码，底下有实时预览。
 */
export function MathDialog({ value, onCancel, onApply }: MathDialogProps) {
  const [text, setText] = useState(value)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  return (
    <div className="tfn-modal" onMouseDown={onCancel}>
      <div className="tfn-modal__panel" onMouseDown={(e) => e.stopPropagation()}>
        <div className="tfn-modal__title">编辑公式</div>
        <textarea
          ref={inputRef}
          className="tfn-modal__input"
          value={text}
          spellCheck={false}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault()
              onCancel()
            } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault()
              onApply(text)
            }
          }}
        />
        <div className="tfn-modal__preview">
          <div
            className="tfn-math tfn-math--block"
            // 内容来自 KaTeX 自己的渲染结果（不是用户输入的 HTML）
            dangerouslySetInnerHTML={{ __html: renderMathHtml(text, true) }}
          />
        </div>
        <div className="tfn-modal__actions">
          <button className="tfn-btn" onClick={onCancel}>
            取消
          </button>
          <button className="tfn-btn tfn-btn--primary" onClick={() => onApply(text)}>
            确定
          </button>
        </div>
      </div>
    </div>
  )
}
