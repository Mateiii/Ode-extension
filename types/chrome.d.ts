type ChromeMessageListener = (
  message: any,
  sender: {
    tab?: {
      id?: number;
      title?: string;
      url?: string;
    };
  },
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
    sendMessage(message: unknown): void;
  };
  storage: {
    local: {
      get(
        keys: string[] | string | Record<string, unknown> | null,
        callback: (items: Record<string, unknown>) => void,
      ): void;
      set(items: Record<string, unknown>, callback?: () => void): void;
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
  sidePanel: {
    setPanelBehavior(options: { openPanelOnActionClick: boolean }): void;
  };
};
