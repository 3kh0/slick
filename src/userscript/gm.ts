export type GMApi = {
  get<T>(key: string, fallback: T): T;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
  list(): string[];
  watch(key: string, callback: (key: string, oldValue: unknown, value: unknown, remote: boolean) => void): number;
  unwatch(id: number): void;
  menu(label: string, callback: () => void): void;
  request(options: {
    url: string;
    method: string;
    headers: Record<string, string>;
    data?: string;
    anonymous: boolean;
    timeout: number;
    onload(response: { status: number; responseText: string }): void;
    onerror(): void;
    ontimeout(): void;
  }): void;
};

declare const GM_getValue: GMApi['get'];
declare const GM_listValues: GMApi['list'];
declare const GM_addValueChangeListener: GMApi['watch'];
declare const GM_removeValueChangeListener: GMApi['unwatch'];
declare const GM_xmlhttpRequest: GMApi['request'];
declare const GM_registerMenuCommand: (label: string, callback: () => void) => unknown;
declare const GM: { setValue: GMApi['set']; deleteValue: GMApi['delete'] };

export function violentmonkeyApi(): GMApi {
  return {
    get: GM_getValue,
    set: (key, value) => GM.setValue(key, value),
    delete: (key) => GM.deleteValue(key),
    list: GM_listValues,
    watch: GM_addValueChangeListener,
    unwatch: GM_removeValueChangeListener,
    menu: (label, callback) => {
      GM_registerMenuCommand(label, callback);
    },
    request: GM_xmlhttpRequest,
  };
}
