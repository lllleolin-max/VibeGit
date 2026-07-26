import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS, type VibeGitApi } from '@vibegit/shared'

const api: VibeGitApi = {
  health: () => ipcRenderer.invoke(IPC_CHANNELS.health),
  selectProjectDirectory: () => ipcRenderer.invoke(IPC_CHANNELS.selectProjectDirectory),
  listProjects: () => ipcRenderer.invoke(IPC_CHANNELS.listProjects),
  addProject: (input) => ipcRenderer.invoke(IPC_CHANNELS.addProject, input),
  removeProject: (projectId) => ipcRenderer.invoke(IPC_CHANNELS.removeProject, projectId),
  refreshProject: (projectId) => ipcRenderer.invoke(IPC_CHANNELS.refreshProject, projectId),
  initializeProtection: (projectId) => ipcRenderer.invoke(IPC_CHANNELS.initializeProtection, projectId),
  listCheckpoints: (projectId) => ipcRenderer.invoke(IPC_CHANNELS.listCheckpoints, projectId),
  createCheckpoint: (input) => ipcRenderer.invoke(IPC_CHANNELS.createCheckpoint, input),
  renameCheckpoint: (checkpointId, title) => ipcRenderer.invoke(IPC_CHANNELS.renameCheckpoint, checkpointId, title),
  deleteCheckpoint: (checkpointId) => ipcRenderer.invoke(IPC_CHANNELS.deleteCheckpoint, checkpointId),
  getCheckpointDiff: (checkpointId) => ipcRenderer.invoke(IPC_CHANNELS.getCheckpointDiff, checkpointId),
  prepareRestore: (projectId, checkpointId) => ipcRenderer.invoke(IPC_CHANNELS.prepareRestore, projectId, checkpointId),
  executeRestore: (token) => ipcRenderer.invoke(IPC_CHANNELS.executeRestore, token),
  undoRestore: (restoreId) => ipcRenderer.invoke(IPC_CHANNELS.undoRestore, restoreId),
  failedRestoreForToken: (token) => ipcRenderer.invoke(IPC_CHANNELS.failedRestoreForToken, token),
  listFailedRestores: (projectId) => ipcRenderer.invoke(IPC_CHANNELS.listFailedRestores, projectId),
  openRecoveryDirectory: (restoreId) => ipcRenderer.invoke(IPC_CHANNELS.openRecoveryDirectory, restoreId),
  listShelves: (projectId) => ipcRenderer.invoke(IPC_CHANNELS.listShelves, projectId),
  createShelf: (projectId, title) => ipcRenderer.invoke(IPC_CHANNELS.createShelf, projectId, title),
  retrieveShelf: (shelfId) => ipcRenderer.invoke(IPC_CHANNELS.retrieveShelf, shelfId),
  githubStatus: () => ipcRenderer.invoke(IPC_CHANNELS.githubStatus),
  githubAuthorize: () => ipcRenderer.invoke(IPC_CHANNELS.githubAuthorize),
  githubScan: (projectId) => ipcRenderer.invoke(IPC_CHANNELS.githubScan, projectId),
  githubCreatePrivate: (input) => ipcRenderer.invoke(IPC_CHANNELS.githubCreatePrivate, input),
  githubConnect: (input) => ipcRenderer.invoke(IPC_CHANNELS.githubConnect, input),
  githubPush: (projectId) => ipcRenderer.invoke(IPC_CHANNELS.githubPush, projectId),
  githubIgnoreRisk: (projectId, risk) => ipcRenderer.invoke(IPC_CHANNELS.githubIgnoreRisk, projectId, risk),
  minimizeWindow: () => ipcRenderer.invoke(IPC_CHANNELS.minimizeWindow),
  toggleMaximizeWindow: () => ipcRenderer.invoke(IPC_CHANNELS.toggleMaximizeWindow),
  closeWindow: () => ipcRenderer.invoke(IPC_CHANNELS.closeWindow),
  agentStatus: () => ipcRenderer.invoke(IPC_CHANNELS.agentStatus),
  listAgentEvents: (projectId) => ipcRenderer.invoke(IPC_CHANNELS.listAgentEvents, projectId),
  getSettings: () => ipcRenderer.invoke(IPC_CHANNELS.getSettings),
  selectDataDirectory: () => ipcRenderer.invoke(IPC_CHANNELS.selectDataDirectory),
  setDataDirectory: (path) => ipcRenderer.invoke(IPC_CHANNELS.setDataDirectory, path),
  checkEnvironment: () => ipcRenderer.invoke(IPC_CHANNELS.checkEnvironment)
}

contextBridge.exposeInMainWorld('vibegit', api)
