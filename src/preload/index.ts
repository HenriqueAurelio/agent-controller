import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron';
import {
  COMMAND_CHANNELS,
  EVENT_CHANNELS,
  type CommandChannel,
  type EventChannel,
  type RendererApi,
} from '@shared/ipc';

const commands = new Set<string>(COMMAND_CHANNELS);
const events = new Set<string>(EVENT_CHANNELS);

// The only thing the renderer can reach: channels of the contract, nothing of Node or Electron.
const api: RendererApi = {
  invoke(channel: CommandChannel, ...args: unknown[]) {
    if (!commands.has(channel)) return Promise.reject(new Error(`Canal desconhecido: ${channel}`));
    return ipcRenderer.invoke(channel, ...args);
  },
  on(channel: EventChannel, listener: (...args: never[]) => void) {
    if (!events.has(channel)) throw new Error(`Canal desconhecido: ${channel}`);
    const wrapped = (_event: IpcRendererEvent, ...args: unknown[]) =>
      (listener as (...a: unknown[]) => void)(...args);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  },
  pathForFile: (file: File) => webUtils.getPathForFile(file),
} as RendererApi;

contextBridge.exposeInMainWorld('api', api);
