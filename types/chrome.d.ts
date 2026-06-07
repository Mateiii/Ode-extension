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
    sendMessage(message: unknown, callback?: (response?: unknown) => void): void;
    lastError: { message?: string } | undefined;
  };
  tabs: {
    create(createProperties: { url?: string; active?: boolean }): Promise<{ id?: number; url?: string }>;
    query(queryInfo: { active?: boolean; currentWindow?: boolean }, callback: (tabs: Array<{ id?: number; title?: string; url?: string }>) => void): void;
    get(tabId: number, callback: (tab: { id?: number; title?: string; url?: string; active?: boolean }) => void): void;
    sendMessage(tabId: number, message: unknown, callback: (response?: unknown) => void): void;
    onActivated: {
      addListener(listener: (activeInfo: { tabId: number; windowId: number }) => void): void;
      removeListener(listener: (activeInfo: { tabId: number; windowId: number }) => void): void;
    };
    onUpdated: {
      addListener(listener: (tabId: number, changeInfo: { status?: string; url?: string }, tab: { id?: number; active?: boolean; title?: string; url?: string }) => void): void;
      removeListener(listener: (tabId: number, changeInfo: { status?: string; url?: string }, tab: { id?: number; active?: boolean; title?: string; url?: string }) => void): void;
    };
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    executeScript<T>(
      injection: { target: { tabId: number }; func: (...args: any[]) => T; args?: unknown[] },
      callback?: (results: Array<{ result: T }>) => void,
    ): Promise<Array<{ result: T }>>;
  };
  sidePanel: {
    open(options: { tabId: number }): Promise<void>;
    setPanelBehavior(options: { openPanelOnActionClick: boolean }): void;
  };
  contextMenus: {
    create(properties: {
      id: string;
      title: string;
      contexts: string[];
    }): void;
    removeAll(callback?: () => void): void;
    onClicked: {
      addListener(
        listener: (
          info: { menuItemId: string; selectionText?: string; pageUrl?: string },
          tab?: { id?: number; title?: string; url?: string },
        ) => void,
      ): void;
    };
  };
};
