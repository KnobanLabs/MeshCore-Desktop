// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-Desktop)

import { useMeshStore } from '@/store/meshStore';
import { EARLY_INSTALL_PROMPT } from './config';

/**
 * Chromium's deferred install prompt, fired on `window` once the app meets the
 * installability criteria. Not in the TypeScript DOM library.
 *
 * @remarks Single use: `prompt()` shows the browser's install dialog once and
 * throws on any later call.
 * @see https://developer.mozilla.org/docs/Web/API/BeforeInstallPromptEvent
 */
export interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

declare global {
  interface WindowEventMap {
    beforeinstallprompt: BeforeInstallPromptEvent;
  }
  interface Navigator {
    /**
     * Chromium only. Lists the manifest's `related_applications` that are
     * installed; a `webapp` entry naming our own manifest is this app.
     */
    getInstalledRelatedApps?: () => Promise<unknown[]>;
  }
}

/**
 * The browser families the install guide has steps for. `other` covers every
 * browser that can't install the app, or can't run it once installed: Firefox
 * and Safari have no Web Bluetooth, and Safari no Web Serial either.
 */
export type InstallBrowser = 'chrome' | 'edge' | 'other';

/**
 * Picks the install guide's steps from the user agent. Edge's UA also names
 * Chrome, so it is matched first; other Chromium browsers get Chrome's steps.
 */
export function installBrowser(): InstallBrowser {
  const ua = navigator.userAgent;
  if (/\bEdg\//.test(ua)) return 'edge';
  if (/\b(Chrome|Chromium)\//.test(ua)) return 'chrome';
  return 'other';
}

/**
 * Installs the app: shows the browser's own install dialog when it handed over
 * a prompt, and the install guide otherwise (Firefox, Safari, or Chromium
 * after a dismissed prompt). Call from a user gesture — Chromium ignores a
 * prompt without one.
 */
export async function installApp(): Promise<void> {
  const { installPrompt, setInstallPrompt, setInstallGuideOpen } =
    useMeshStore.getState();
  if (!installPrompt) {
    setInstallGuideOpen(true);
    return;
  }
  try {
    await installPrompt.prompt();
  } catch {
    // Rejects when the event was already used, e.g. by a second click while
    // the dialog was up. Every caller runs from a click, so the other cause,
    // a missing user activation, doesn't arise.
  } finally {
    setInstallPrompt(null);
  }
}

// Chromium can fire `beforeinstallprompt` before hydration reaches this
// module, so a script in `app/layout.tsx` parks that one on `window` to be
// adopted here; any later one lands in the listener below.
//
// "Installed" has three sources: running in the app's own window (including a
// tab Chromium moves into one without a reload), the `related_applications`
// self-entry in the manifest for any other tab once the app is installed, and
// `appinstalled` for the tab that installs it.
if (typeof window !== 'undefined') {
  const store = useMeshStore.getState();
  const standalone = matchMedia('(display-mode: standalone)');
  if (standalone.matches) store.setAppInstalled(true);
  standalone.addEventListener('change', (e) => {
    if (e.matches) useMeshStore.getState().setAppInstalled(true);
  });
  void navigator
    .getInstalledRelatedApps?.()
    .then((apps) => {
      if (apps.length > 0) useMeshStore.getState().setAppInstalled(true);
    })
    .catch(() => {});
  const early: unknown = Reflect.get(window, EARLY_INSTALL_PROMPT);
  if (early instanceof Event) {
    store.setInstallPrompt(early as BeforeInstallPromptEvent);
  }
  Reflect.deleteProperty(window, EARLY_INSTALL_PROMPT);
  window.addEventListener('beforeinstallprompt', (e) => {
    // Keeps Chromium's own mini-infobar away; the app offers install itself.
    e.preventDefault();
    useMeshStore.getState().setInstallPrompt(e);
    // The early script's listener ran first and parked this one too.
    Reflect.deleteProperty(window, EARLY_INSTALL_PROMPT);
  });
  window.addEventListener('appinstalled', () => {
    const { setAppInstalled, setInstallPrompt } = useMeshStore.getState();
    setAppInstalled(true);
    setInstallPrompt(null);
  });
}
