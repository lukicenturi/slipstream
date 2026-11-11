"use client";

import { useId, type ReactNode } from "react";

import { useAlertSettings } from "@/hooks/useAlertSettings";
import { useBrowserNotifications } from "@/hooks/useBrowserNotifications";
import { usePushAlerts, type PushStatus } from "@/hooks/usePushAlerts";
import { useWatchlist } from "@/hooks/useWatchlist";
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
  if (enabled && permission === "granted")
    return "While a tab is open. Use Push alerts for the rest.";
  return null;
}

function pushNote(status: PushStatus, message: string | null, capped: boolean): string | null {
  switch (status) {
    case "on":
      return capped
        ? "Delivered even when the tab is closed. Up to a minute late. Covers the first 50 traders."
        : "Delivered even when the tab is closed. Up to a minute late.";
    case "enabling":
      return "Turning on…";
    case "needs-install":
      return "On iPhone, add Slipstream to the Home Screen first (Share, then Add to Home Screen).";
    case "not-configured":
      return "Not set up on this deployment.";
    case "unsupported":
      return "Not supported in this browser.";
    case "error":
      return message;
    case "off":
      return null;
  }
}

/** A small on/off switch with a text label. */
function Switch({
  checked,
  onChange,
  label,
  note,
  noteTone = "faint",
  disabled = false,
  testId,
  children,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  note?: string | null;
  noteTone?: "faint" | "error";
  disabled?: boolean;
  testId?: string;
  /** Extra content under the note, such as a text button. */
  children?: ReactNode;
}) {
  const noteId = useId();
  return (
    <div className="flex min-h-8 items-center gap-3" data-testid={testId}>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-xs text-foreground">{label}</span>
        {note ? (
          <span
            id={noteId}
            role={noteTone === "error" ? "alert" : undefined}
            className={cn("text-2xs", noteTone === "error" ? "text-short" : "text-faint")}
          >
            {note}
          </span>
        ) : null}
        {children}
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
  const { addresses } = useWatchlist();
  const push = usePushAlerts(addresses, settings.perAddress);
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
      <Switch
        testId="push-alerts"
        label="Push alerts"
        checked={push.status === "on"}
        onChange={(checked) => void (checked ? push.enable() : push.disable())}
        note={pushNote(push.status, push.message, push.capped)}
        noteTone={push.status === "error" ? "error" : "faint"}
        disabled={
          push.status === "unsupported" ||
          push.status === "needs-install" ||
          push.status === "not-configured" ||
          push.status === "enabling"
        }
      >
        {push.status === "on" ? (
          <span className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void push.sendTest()}
              disabled={push.testPending}
              className="text-2xs text-brand underline-offset-2 hover:underline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-50"
            >
              {push.testPending ? "Sending…" : "Send test"}
            </button>
            {push.testMessage ? (
              <span role="status" className="text-2xs text-faint">
                {push.testMessage}
              </span>
            ) : null}
          </span>
        ) : null}
      </Switch>
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
