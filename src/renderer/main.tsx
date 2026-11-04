import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { THEME_CSS } from '../shared/theme-css'
import './styles.css'

const container = document.getElementById('root')
if (!container) throw new Error('#root not found')

// 文档内容样式（主题、排版、代码高亮配色）以字符串形式注入，
// 这样主进程导出 HTML/PDF 时能复用完全相同的一份样式。
const style = document.createElement('style')
style.id = 'tfn-content-style'
style.textContent = THEME_CSS
document.head.appendChild(style)

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
