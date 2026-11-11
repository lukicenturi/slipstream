"use client";

import { useId } from "react";

import { useAlertSettings } from "@/hooks/useAlertSettings";
import { useBrowserNotifications } from "@/hooks/useBrowserNotifications";
import { MIN_NOTIONAL_OPTIONS, type MinNotionalUsd } from "@/lib/alerts";
import type { BrowserPermission } from "@/lib/notifications";
import { cn } from "@/lib/utils";

const SIZE_LABEL: Record<MinNotionalUsd, string> = {
  0: "Any",
  1_000: "$1K",
  10_000: "$10K",
  100_000: "$100K",
};

function permissionNote(permission: BrowserPermission, enabled: boolean): string | null {
  if (permission === "unsupported") return "Not supported in this browser";
  if (permission === "denied") return "Blocked in browser settings";
  if (enabled && permission === "default") return "Waiting for permission";
  if (enabled && permission === "granted") return "Shows when this tab is hidden";
  return null;
}

/** A small on/off switch with a text label. */
function Switch({
  checked,
  onChange,
  label,
  note,
  disabled = false,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  note?: string | null;
  disabled?: boolean;
}) {
  const noteId = useId();
  return (
    <div className="flex min-h-8 items-center gap-3">
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-xs text-foreground">{label}</span>
        {note ? (
          <span id={noteId} className="text-2xs text-faint">
            {note}
          </span>
        ) : null}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        aria-describedby={note ? noteId : undefined}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative h-4 w-7 shrink-0 rounded-sm border transition-colors focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-50",
          checked ? "border-brand/60 bg-brand-dim" : "border-border-strong bg-background",
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            "absolute top-1/2 size-2.5 -translate-y-1/2 rounded-[2px] transition-[left,background-color]",
            checked ? "left-[13px] bg-brand" : "left-[2px] bg-muted-foreground",
          )}
        />
      </button>
    </div>
  );
}

/** Toasts, browser notifications and the minimum size, shared by every page. */
export function AlertSettingsPanel() {
  const { settings, setGlobal } = useAlertSettings();
  const browser = useBrowserNotifications();
  const groupId = useId();
  const { global } = settings;

  async function onBrowserChange(checked: boolean) {
    if (!checked) {
      setGlobal({ browser: false });
      return;
    }
    const permission = browser.permission === "granted" ? "granted" : await browser.request();
    setGlobal({ browser: permission === "granted" });
  }

  return (
    <div data-testid="alert-settings" className="flex flex-col gap-1 border-b px-3 py-2">
      <Switch
        label="Toasts"
        checked={global.toasts}
        onChange={(checked) => setGlobal({ toasts: checked })}
      />
      <Switch
        label="Browser notifications"
        checked={global.browser && browser.permission === "granted"}
        onChange={(checked) => void onBrowserChange(checked)}
        note={permissionNote(browser.permission, global.browser)}
        disabled={!browser.supported || browser.permission === "denied"}
      />
      <div className="flex min-h-8 items-center gap-3">
        <span id={groupId} className="flex-1 text-xs text-foreground">
          Minimum size
        </span>
        <div
          role="group"
          aria-labelledby={groupId}
          className="flex shrink-0 overflow-hidden rounded-sm border"
        >
          {MIN_NOTIONAL_OPTIONS.map((value) => {
            const active = global.minNotionalUsd === value;
            return (
              <button
                key={value}
                type="button"
                aria-pressed={active}
                onClick={() => setGlobal({ minNotionalUsd: value })}
                className={cn(
                  "h-6 border-l px-2 font-mono text-2xs tabular-nums transition-colors first:border-l-0 focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-ring",
                  active
                    ? "bg-brand-dim text-brand"
                    : "text-muted-foreground hover:bg-surface-hover hover:text-foreground",
                )}
              >
                {SIZE_LABEL[value]}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
