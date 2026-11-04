import type { OutlineItem } from '../core/outline'

export interface OutlinePanelProps {
  items: OutlineItem[]
  /** 是否展开侧栏 */
  open: boolean
  onToggle: () => void
  onSelect: (pos: number) => void
}

/**
 * 大纲侧栏。
 *
 * 大纲放在侧边栏，点击标题即可跳转；
 * 这里的数据直接来自文档树，所以永远和正文一致。
 */
export function OutlinePanel(props: OutlinePanelProps) {
  const { items, open, onToggle, onSelect } = props

  if (!open) {
    return (
      <button className="tfn-outline-toggle" onClick={onToggle} title="显示大纲">
        ☰
      </button>
    )
  }

  return (
    <aside className="tfn-outline">
      <div className="tfn-outline__head">
        <span>大纲</span>
        <button className="tfn-outline__close" onClick={onToggle} title="收起大纲">
          ×
        </button>
      </div>
      {items.length === 0 ? (
        <div className="tfn-outline__empty">本文档没有标题</div>
      ) : (
        <ul className="tfn-outline__list">
          {items.map((item, index) => (
            <li
              key={`${item.pos}-${index}`}
              className={`tfn-outline__item tfn-outline__item--h${item.level}${item.active ? ' is-active' : ''}`}
            >
              <button onClick={() => onSelect(item.pos)} title={item.text}>
                {item.text || '（无标题）'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </aside>
  )
}
