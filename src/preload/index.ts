import { contextBridge, ipcRenderer } from 'electron'
import type {
  AutosaveEvent,
  AutosavePush,
  ExportPayload,
  ImageSaveRequest,
  TabState,
  TrifluisnoteApi,
} from '../shared/types'

const api: TrifluisnoteApi = {
  openFile: () => ipcRenderer.invoke('dialog:open'),
  readFile: (filePath) => ipcRenderer.invoke('file:read', filePath),
  saveFile: (filePath, content, encoding) =>
    ipcRenderer.invoke('file:save', filePath, content, encoding),
  saveFileAs: (content, suggestedName, encoding) =>
    ipcRenderer.invoke('file:saveAs', content, suggestedName, encoding),
  newWindow: () => ipcRenderer.invoke('window:new'),
  getStartupState: () => ipcRenderer.invoke('startup:get'),
  syncTabs: (tabs: TabState[], activeTabId: string) =>
    ipcRenderer.invoke('tabs:sync', tabs, activeTabId),
  autosavePush: (payload: AutosavePush) => ipcRenderer.invoke('autosave:push', payload),
  setAutoSave: (enabled: boolean) => ipcRenderer.invoke('settings:autoSave', enabled),
  listRecovery: () => ipcRenderer.invoke('recovery:list'),
  resolveRecovery: (id: string, action: 'restore' | 'discard') =>
    ipcRenderer.invoke('recovery:resolve', id, action),
  confirm: (message: string, detail?: string) =>
    ipcRenderer.invoke('dialog:confirm', message, detail),
  saveImage: (request: ImageSaveRequest) => ipcRenderer.invoke('image:save', request),
  baseUrl: (filePath: string | null) => ipcRenderer.invoke('image:baseUrl', filePath),
  getAppInfo: () => ipcRenderer.invoke('app:info'),
  revealInFolder: (filePath) => ipcRenderer.invoke('shell:reveal', filePath),
  exportHtml: (payload: ExportPayload, suggestedName: string) =>
    ipcRenderer.invoke('export:html', payload, suggestedName),
  exportPdf: (payload: ExportPayload, suggestedName: string) =>
    ipcRenderer.invoke('export:pdf', payload, suggestedName),
  listThemes: () => ipcRenderer.invoke('theme:list'),
  onAutosave: (cb: (event: AutosaveEvent) => void) => {
    const handler = (_event: unknown, payload: AutosaveEvent) => cb(payload)
    ipcRenderer.on('autosave:event', handler)
    return () => ipcRenderer.off('autosave:event', handler)
  },
}

contextBridge.exposeInMainWorld('tfn', api)

// 菜单命令转发
contextBridge.exposeInMainWorld('tfnMenu', {
  onCommand: (cb: (command: string, payload?: unknown) => void) => {
    const handler = (_event: unknown, command: string, payload?: unknown) => cb(command, payload)
    ipcRenderer.on('menu:command', handler)
    return () => ipcRenderer.off('menu:command', handler)
  },
})
