import type { EngineResult } from './importers/transcription';

export interface EngineStatus {
  installed: boolean;
  needsUpdate: boolean;
  dir: string;
}

export interface EngineEvent {
  type: 'progress' | 'done' | 'error' | 'ok';
  step?: string;
  progress?: number;
  message?: string;
}

export const isDesktop = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(command, args);
}

export function engineStatus(): Promise<EngineStatus> {
  return invoke('engine_status');
}

export function installEngine(): Promise<void> {
  return invoke('engine_install');
}

export async function transcribe(source: string, lyrics: boolean): Promise<EngineResult> {
  const json = await invoke<string>('engine_transcribe', { source, lyrics });
  return JSON.parse(json) as EngineResult;
}

export function cancelEngine(): Promise<void> {
  return invoke('engine_cancel');
}

export async function onEngineEvent(handler: (event: EngineEvent) => void): Promise<() => void> {
  const { listen } = await import('@tauri-apps/api/event');
  return listen<EngineEvent>('engine-event', (e) => handler(e.payload));
}

export async function pickAudioFile(): Promise<string | null> {
  const { open } = await import('@tauri-apps/plugin-dialog');
  const path = await open({
    multiple: false,
    filters: [{ name: 'Audio', extensions: ['mp3', 'wav', 'flac', 'm4a', 'ogg', 'opus', 'aac', 'webm'] }],
  });
  return typeof path === 'string' ? path : null;
}

export function describeSource(source: string): 'youtube' | 'spotify' | 'file' | 'unknown' {
  if (/^https?:\/\/(www\.|m\.|music\.)?(youtube\.com|youtu\.be)\//i.test(source)) return 'youtube';
  if (/^https?:\/\/open\.spotify\.com\/(intl-[a-z]+\/)?track\//i.test(source)) return 'spotify';
  if (/^[a-z]:\\|^\//i.test(source)) return 'file';
  return 'unknown';
}
