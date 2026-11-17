export interface TabBarTab {
  id: string
  title: string
  /** 有未保存的改动 */
  dirty: boolean
}

export interface TabBarProps {
  tabs: TabBarTab[]
  activeId: string
  onSelect: (id: string) => void
  onClose: (id: string) => void
  onNew: () => void
}

/**
 * 窗口内的标签栏。
 *
 * v0.2 起「一个窗口一个文档」的记事本式模型换成了标签页：
 * 多个文档在一个窗口里并排开着，切换标签页互不干扰。
 */
export function TabBar({ tabs, activeId, onSelect, onClose, onNew }: TabBarProps) {
  return (
    <div className="tfn-tabbar" role="tablist" aria-label="打开的文档">
      {tabs.map((tab) => (
        <div
          key={tab.id}
          role="tab"
          aria-selected={tab.id === activeId}
          title={tab.title}
          className={`tfn-tab${tab.id === activeId ? ' is-active' : ''}`}
          onClick={() => onSelect(tab.id)}
          onAuxClick={(e) => {
            // 中键关闭
            if (e.button !== 1) return
            e.preventDefault()
            onClose(tab.id)
          }}
        >
          <span className="tfn-tab__title">{tab.title}</span>
          {tab.dirty && <span className="tfn-tab__dot" aria-label="有未保存的改动" />}
          <button
            className="tfn-tab__close"
            aria-label={`关闭 ${tab.title}`}
            onClick={(e) => {
              e.stopPropagation()
              onClose(tab.id)
            }}
          >
            ×
          </button>
        </div>
      ))}
      <button className="tfn-tab__new" title="新建标签页 (Ctrl+T)" aria-label="新建标签页" onClick={onNew}>
        +
      </button>
    </div>
  )
}
