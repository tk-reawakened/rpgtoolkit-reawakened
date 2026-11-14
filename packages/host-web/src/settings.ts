import type { FileSystemService, SettingValue, SettingsLayer, SettingsService } from "@tk-reawakened/platform-services";
import { platformError, platformOk } from "@tk-reawakened/platform-services";

/** Where the project layer of the editor settings lives: a plain JSON file in the project, so it can be committed (ADR 0022 D6.3). */
export const PROJECT_SETTINGS_PATH = ".tkr/editor-settings.json";

/** The part of the browser's `Storage` the user layer needs. */
export interface UserSettingsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const USER_PREFIX = "tkr.setting.";

const parse = (text: string | null): SettingValue | null => {
  if (text === null) return null;
  try {
    return JSON.parse(text) as SettingValue;
  } catch {
    // A value that is not JSON is carried to the model as text, which then refuses it by name (ADR 0022 D6.2).
    return text;
  }
};

/**
 * The browser host's `settings` service. The user layer lives in browser storage when the page has it, else in memory
 * for the life of the page. The project layer is `PROJECT_SETTINGS_PATH` in the project: one JSON object of setting ids
 * to values, rewritten whole. A project file that is not an object of that shape reads as holding nothing.
 */
export function createWebSettings(fs: Pick<FileSystemService, "read" | "write">, storage: UserSettingsStorage | null, projectWritable: boolean): SettingsService {
  const memory = new Map<string, SettingValue>();
  const readProject = async (): Promise<Record<string, SettingValue>> => {
    const read = await fs.read(PROJECT_SETTINGS_PATH);
    if (!read.ok) return {};
    try {
      const value: unknown = JSON.parse(new TextDecoder().decode(read.value));
      return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, SettingValue>) : {};
    } catch {
      return {};
    }
  };
  return {
    async get(layer: SettingsLayer, id) {
      if (layer === "project") return platformOk((await readProject())[id] ?? null);
      return platformOk(storage === null ? (memory.get(id) ?? null) : parse(storage.getItem(USER_PREFIX + id)));
    },
    async set(layer: SettingsLayer, id, value) {
      if (layer === "user") {
        if (storage === null) {
          if (value === null) memory.delete(id); else memory.set(id, value);
        } else if (value === null) storage.removeItem(USER_PREFIX + id);
        else storage.setItem(USER_PREFIX + id, JSON.stringify(value));
        return platformOk(undefined);
      }
      if (!projectWritable) return platformError("unavailable", "This project cannot be written to, so its settings cannot be saved.");
      const current = await readProject();
      if (value === null) delete current[id]; else current[id] = value;
      return fs.write(PROJECT_SETTINGS_PATH, new TextEncoder().encode(`${JSON.stringify(current, null, 2)}\n`));
    },
  };
}
