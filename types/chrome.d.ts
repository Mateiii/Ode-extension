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
  sidePanel: {
    setPanelBehavior(options: { openPanelOnActionClick: boolean }): void;
  };
};
