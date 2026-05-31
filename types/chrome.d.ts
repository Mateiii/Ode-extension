type ChromeMessageListener = (
  message: any,
  sender: {
    tab?: {
      id?: number;
      title?: string;
      url?: string;
    };
  },
  sendResponse: (response?: unknown) => void,
) => void | boolean;

declare const chrome: {
  runtime: {
    onInstalled: {
      addListener(listener: () => void): void;
    };
    onStartup: {
      addListener(listener: () => void): void;
    };
    onMessage: {
      addListener(listener: ChromeMessageListener): void;
      removeListener(listener: ChromeMessageListener): void;
    };
    sendMessage(message: unknown, callback?: () => void): void;
    lastError: { message?: string } | undefined;
  };
  tabs: {
    query(queryInfo: { active?: boolean; currentWindow?: boolean }, callback: (tabs: Array<{ id?: number; title?: string; url?: string }>) => void): void;
    sendMessage(tabId: number, message: unknown, callback: (response?: unknown) => void): void;
  };
  storage: {
    local: {
      get(
        keys: string[] | string | Record<string, unknown> | null,
        callback: (items: Record<string, unknown>) => void,
      ): void;
      set(items: Record<string, unknown>, callback?: () => void): void;
      remove(keys: string[] | string, callback?: () => void): void;
    };
    onChanged: {
      addListener(
        listener: (changes: Record<string, { oldValue?: unknown; newValue?: unknown }>, areaName: string) => void,
      ): void;
      removeListener(
        listener: (changes: Record<string, { oldValue?: unknown; newValue?: unknown }>, areaName: string) => void,
      ): void;
    };
  };
  scripting: {
    executeScript<T>(
      injection: { target: { tabId: number }; func: () => T },
      callback?: (results: Array<{ result: T }>) => void,
    ): Promise<Array<{ result: T }>>;
  };
  sidePanel: {
    open(options: { tabId: number }): Promise<void>;
    setPanelBehavior(options: { openPanelOnActionClick: boolean }): void;
  };
};
