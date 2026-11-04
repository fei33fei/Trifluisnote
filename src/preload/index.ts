import { contextBridge, ipcRenderer } from 'electron'
import type { DocState, ExportPayload, TrifluisnoteApi } from '../shared/types'

const api: TrifluisnoteApi = {
  openFile: () => ipcRenderer.invoke('dialog:open'),
  readFile: (filePath) => ipcRenderer.invoke('file:read', filePath),
  saveFile: (filePath, content) => ipcRenderer.invoke('file:save', filePath, content),
  saveFileAs: (content, suggestedName) => ipcRenderer.invoke('file:saveAs', content, suggestedName),
  newWindow: () => ipcRenderer.invoke('window:new'),
  getDocState: () => ipcRenderer.invoke('docstate:get'),
  setDocState: (patch) => ipcRenderer.invoke('docstate:set', patch),
  getAppInfo: () => ipcRenderer.invoke('app:info'),
  revealInFolder: (filePath) => ipcRenderer.invoke('shell:reveal', filePath),
  exportHtml: (payload: ExportPayload, suggestedName: string) =>
    ipcRenderer.invoke('export:html', payload, suggestedName),
  exportPdf: (payload: ExportPayload, suggestedName: string) =>
    ipcRenderer.invoke('export:pdf', payload, suggestedName),
  listThemes: () => ipcRenderer.invoke('theme:list'),
  onDocState: (cb) => {
    const handler = (_event: unknown, state: DocState) => cb(state)
    ipcRenderer.on('docstate:changed', handler)
    return () => ipcRenderer.off('docstate:changed', handler)
  },
}

contextBridge.exposeInMainWorld('tfn', api)

// 菜单命令转发
contextBridge.exposeInMainWorld('tfnMenu', {
  onCommand: (cb: (command: string) => void) => {
    const handler = (_event: unknown, command: string) => cb(command)
    ipcRenderer.on('menu:command', handler)
    return () => ipcRenderer.off('menu:command', handler)
  },
})
