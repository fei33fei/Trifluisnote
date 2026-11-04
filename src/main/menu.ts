import { app, BrowserWindow, Menu, shell } from 'electron'
import type { MenuItemConstructorOptions } from 'electron'

/** 把菜单动作转发给渲染层，由渲染层决定如何执行。 */
function send(command: string): void {
  const win = BrowserWindow.getFocusedWindow()
  win?.webContents.send('menu:command', command)
}

export function buildMenu(): Menu {
  const template: MenuItemConstructorOptions[] = [
    {
      label: '文件',
      submenu: [
        {
          label: '新建窗口',
          accelerator: 'CmdOrCtrl+N',
          click: () => send('file.newWindow'),
        },
        {
          label: '新建文件',
          accelerator: 'CmdOrCtrl+Alt+N',
          click: () => send('file.newFile'),
        },
        { type: 'separator' },
        {
          label: '打开…',
          accelerator: 'CmdOrCtrl+O',
          click: () => send('file.open'),
        },
        { type: 'separator' },
        {
          label: '保存',
          accelerator: 'CmdOrCtrl+S',
          click: () => send('file.save'),
        },
        {
          label: '另存为…',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => send('file.saveAs'),
        },
        { type: 'separator' },
        {
          label: '导出为 HTML…',
          click: () => send('file.exportHtml'),
        },
        {
          label: '导出为 PDF…',
          click: () => send('file.exportPdf'),
        },
        { type: 'separator' },
        {
          label: '在文件管理器中显示',
          click: () => send('file.reveal'),
        },
        { type: 'separator' },
        {
          label: '关闭窗口',
          accelerator: 'CmdOrCtrl+W',
          click: () => BrowserWindow.getFocusedWindow()?.close(),
        },
        {
          label: '退出',
          accelerator: 'CmdOrCtrl+Q',
          click: () => app.quit(),
        },
      ],
    },
    {
      label: '编辑',
      submenu: [
        { label: '撤销', accelerator: 'CmdOrCtrl+Z', click: () => send('edit.undo') },
        { label: '重做', accelerator: 'CmdOrCtrl+Shift+Z', click: () => send('edit.redo') },
        { type: 'separator' },
        { label: '剪切', accelerator: 'CmdOrCtrl+X', click: () => send('edit.cut') },
        { label: '复制', accelerator: 'CmdOrCtrl+C', click: () => send('edit.copy') },
        { label: '粘贴', accelerator: 'CmdOrCtrl+V', click: () => send('edit.paste') },
        { type: 'separator' },
        { label: '全选', accelerator: 'CmdOrCtrl+A', click: () => send('edit.selectAll') },
        { type: 'separator' },
        { label: '查找…', accelerator: 'CmdOrCtrl+F', click: () => send('edit.find') },
        { type: 'separator' },
        {
          label: '源码模式',
          accelerator: 'CmdOrCtrl+/',
          click: () => send('view.toggleSourceMode'),
        },
      ],
    },
    {
      label: '视图',
      submenu: [
        {
          label: '大纲',
          accelerator: 'CmdOrCtrl+Shift+O',
          click: () => send('view.toggleOutline'),
        },
        {
          label: '切换主题',
          accelerator: 'CmdOrCtrl+Shift+T',
          click: () => send('view.cycleTheme'),
        },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { role: 'reload' },
        { role: 'toggleDevTools' },
      ],
    },
    {
      label: '帮助',
      submenu: [
        {
          label: '关于 Trifluisnote',
          click: () => {
            void shell.openExternal('https://github.com/')
          },
        },
      ],
    },
  ]

  return Menu.buildFromTemplate(template)
}
