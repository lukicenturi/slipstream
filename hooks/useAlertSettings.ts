"use client";

import { useSyncExternalStore } from "react";

import {
  ALERTS_STORAGE_KEY,
  DEFAULT_ALERT_SETTINGS,
  parseAlertSettings,
  setAddressAlert as setAddressAlertPure,
  setGlobal as setGlobalPure,
  type AlertSettings,
  type GlobalAlertSettings,
} from "@/lib/alerts";

import { createLocalStore } from "./createLocalStore";

/** The alert settings store (`slipstream.alerts`), shared by every reader. */
export const alertSettingsStore = createLocalStore<AlertSettings>(
  ALERTS_STORAGE_KEY,
  parseAlertSettings,
  DEFAULT_ALERT_SETTINGS,
);

function setAddressAlert(address: string, enabled: boolean): void {
  alertSettingsStore.update((current) => setAddressAlertPure(current, address, enabled));
}

function setGlobal(patch: Partial<GlobalAlertSettings>): void {
  alertSettingsStore.update((current) => setGlobalPure(current, patch));
}

/** The alert settings and helpers to change them. */
export function useAlertSettings() {
  const settings = useSyncExternalStore(
    alertSettingsStore.subscribe,
    alertSettingsStore.getSnapshot,
    alertSettingsStore.getServerSnapshot,
  );
  return { settings, setAddressAlert, setGlobal };
}
