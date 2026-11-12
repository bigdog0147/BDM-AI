import { existsSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

export const JARVIS_STORAGE_PATH = "E:\\AI\\Shared\\Memory\\bigdog-jarvis-memory.json";

export interface JarvisMemoryRecord {
  id: string;
  text: string;
  category?: string;
  createdAt: string;
}

export interface JarvisTaskRecord {
  id: string;
  title: string;
  status: "pending" | "in_progress" | "completed";
  createdAt: string;
}

export interface JarvisLearningRecord {
  id: string;
  userText: string;
  assistantText: string;
  toolsUsed: string[];
  summary: string;
  timestamp: string;
}

export interface JarvisStoreData {
  version: number;
  identity: {
    name: string;
    alias: string;
    wakeWords: string[];
    storageLocation: string;
    memoryModel: string;
  };
  memories: JarvisMemoryRecord[];
  tasks: JarvisTaskRecord[];
  continuousLearning: JarvisLearningRecord[];
  updatedAt: string;
}

export function readJarvisExternalStore(): { ok: boolean; data: JarvisStoreData | null; path: string; error?: string } {
  try {
    if (!existsSync(JARVIS_STORAGE_PATH)) {
      return { ok: false, data: null, path: JARVIS_STORAGE_PATH, error: "External memory file not found on E: drive" };
    }
    const raw = readFileSync(JARVIS_STORAGE_PATH, "utf-8");
    const parsed = JSON.parse(raw) as JarvisStoreData;
    return { ok: true, data: parsed, path: JARVIS_STORAGE_PATH };
  } catch (err: any) {
    return { ok: false, data: null, path: JARVIS_STORAGE_PATH, error: err.message };
  }
}

export function appendLearningToJarvis(learning: { userText: string; assistantText: string; toolsUsed?: string[] }): boolean {
  try {
    const store = readJarvisExternalStore();
    if (!store.ok || !store.data) return false;

    const newRecord: JarvisLearningRecord = {
      id: `bdm_learn_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      userText: learning.userText,
      assistantText: learning.assistantText,
      toolsUsed: learning.toolsUsed ?? ["bdm_ai"],
      summary: `Asked: "${learning.userText.slice(0, 100)}" -> Answered: "${learning.assistantText.slice(0, 100)}"`,
      timestamp: new Date().toISOString()
    };

    store.data.continuousLearning = [newRecord, ...(store.data.continuousLearning || [])].slice(0, 500);
    store.data.updatedAt = new Date().toISOString();

    writeFileSync(JARVIS_STORAGE_PATH, JSON.stringify(store.data, null, 2), "utf-8");
    return true;
  } catch {
    return false;
  }
}

export function appendMemoryToJarvis(text: string, category: string = "general"): boolean {
  try {
    const store = readJarvisExternalStore();
    if (!store.ok || !store.data) return false;

    const newMemory: JarvisMemoryRecord = {
      id: `mem_bdm_${Date.now().toString(36)}`,
      text,
      category,
      createdAt: new Date().toISOString()
    };

    store.data.memories = [newMemory, ...(store.data.memories || [])];
    store.data.updatedAt = new Date().toISOString();

    writeFileSync(JARVIS_STORAGE_PATH, JSON.stringify(store.data, null, 2), "utf-8");
    return true;
  } catch {
    return false;
  }
}
