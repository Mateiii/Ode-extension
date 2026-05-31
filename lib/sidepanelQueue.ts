export const SIDEPANEL_PENDING_ACTION_KEY = 'ode:pending-sidepanel-action';

export type PendingSidepanelAction = {
  id: string;
  message: unknown;
  createdAt: string;
};

export async function getPendingSidepanelAction() {
  return new Promise<PendingSidepanelAction | null>((resolve) => {
    chrome.storage.local.get(SIDEPANEL_PENDING_ACTION_KEY, (items) => {
      resolve((items[SIDEPANEL_PENDING_ACTION_KEY] as PendingSidepanelAction | undefined) ?? null);
    });
  });
}

export async function setPendingSidepanelAction(message: unknown) {
  const pendingAction: PendingSidepanelAction = {
    id: crypto.randomUUID(),
    message,
    createdAt: new Date().toISOString(),
  };

  return new Promise<PendingSidepanelAction>((resolve) => {
    chrome.storage.local.set({ [SIDEPANEL_PENDING_ACTION_KEY]: pendingAction }, () => {
      resolve(pendingAction);
    });
  });
}

export async function clearPendingSidepanelAction(id?: string) {
  const current = await getPendingSidepanelAction();
  if (id && current?.id !== id) return;

  return new Promise<void>((resolve) => {
    chrome.storage.local.remove(SIDEPANEL_PENDING_ACTION_KEY, () => resolve());
  });
}
