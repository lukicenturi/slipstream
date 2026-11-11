"use client";

import { BellIcon, SettingsIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { RelativeTime } from "@/components/feed/RelativeTime";
import { AssetIcon } from "@/components/shared/AssetIcon";
import { Blockie } from "@/components/shared/Blockie";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useTraderLabels } from "@/hooks/useNames";
import { useNotifications } from "@/hooks/useNotifications";
import { useWatchlist } from "@/hooks/useWatchlist";
import { describeFillAction } from "@/lib/calc/fillAction";
import { formatUsd } from "@/lib/format";
import type { Notice } from "@/lib/notifications";
import { unreadBadge } from "@/lib/notifications";
import { cn } from "@/lib/utils";

import { AlertSettingsPanel } from "./AlertSettingsPanel";

const LIST_LIMIT = 20;

/**
 * The header bell: an unread count, and a popover with the last 20 notices
 * of followed traders and the alert settings.
 */
export function NotificationBell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { notices, unread, markAllRead, markRead, clear } = useNotifications();
  const { addresses } = useWatchlist();
  const label = useTraderLabels(addresses);
  const badge = unreadBadge(unread);

  function openNotice(notice: Notice) {
    markRead(notice.id);
    setOpen(false);
    router.push(`/trader/${notice.address}`);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={`Notifications, ${unread} unread`}
          data-testid="notification-bell"
          data-unread={unread}
          className="relative"
        >
          <BellIcon aria-hidden="true" className="size-4" />
          {badge ? (
            <span
              aria-hidden="true"
              data-testid="notification-badge"
              className="absolute top-1 right-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-sm bg-brand px-0.5 font-mono text-[10px] leading-none text-primary-foreground tabular-nums"
            >
              {badge}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        collisionPadding={16}
        data-testid="notification-popover"
        className="w-[calc(100vw-32px)] p-0 sm:w-[360px]"
      >
        <div className="flex h-10 items-center gap-1 border-b pr-1 pl-3">
          <h2 className="flex-1 text-sm font-semibold text-foreground">Notifications</h2>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={markAllRead}
            disabled={unread === 0}
            data-testid="mark-all-read"
          >
            Mark all read
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Alert settings"
            aria-expanded={settingsOpen}
            onClick={() => setSettingsOpen((value) => !value)}
            data-testid="alert-settings-toggle"
          >
            <SettingsIcon aria-hidden="true" />
          </Button>
        </div>

        {settingsOpen ? <AlertSettingsPanel /> : null}

        {notices.length === 0 ? (
          <div className="flex flex-col items-center gap-1.5 px-4 py-8 text-center">
            <p className="text-xs text-foreground">No trades yet from traders you follow.</p>
            {addresses.length === 0 ? (
              <Link
                href="/watchlist"
                prefetch={false}
                onClick={() => setOpen(false)}
                className="rounded-sm text-2xs text-brand underline-offset-2 hover:underline"
              >
                Follow a trader to get alerts
              </Link>
            ) : (
              <p className="text-2xs text-faint">
                Alerts fire while Slipstream is open. Push alerts also work when it is closed.
              </p>
            )}
          </div>
        ) : (
          <ul
            aria-label="Recent trades"
            data-testid="notification-list"
            className="max-h-[min(24rem,60dvh)] overflow-y-auto"
          >
            {notices.slice(0, LIST_LIMIT).map((notice) => (
              <NoticeRow
                key={notice.id}
                notice={notice}
                label={label(notice.address).label}
                onOpen={openNotice}
              />
            ))}
          </ul>
        )}

        <div className="flex h-9 items-center justify-between border-t px-3 text-2xs">
          <Link
            href="/watchlist"
            prefetch={false}
            onClick={() => setOpen(false)}
            className="rounded-sm text-muted-foreground hover:text-foreground"
          >
            Watchlist
          </Link>
          {notices.length > 0 ? (
            <button
              type="button"
              onClick={clear}
              className="rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              Clear all
            </button>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function NoticeRow({
  notice,
  label,
  onOpen,
}: {
  notice: Notice;
  label: string;
  onOpen: (notice: Notice) => void;
}) {
  const { phrase } = describeFillAction(notice.dir);
  return (
    <li className="border-b last:border-b-0">
      <button
        type="button"
        onClick={() => onOpen(notice)}
        data-testid="notification-row"
        data-read={notice.read ? "true" : "false"}
        className={cn(
          "flex w-full items-center gap-2 border-l-2 py-1.5 pr-3 pl-2.5 text-left transition-colors hover:bg-surface-hover focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-ring",
          notice.read ? "border-l-transparent" : "border-l-brand",
        )}
      >
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex min-w-0 items-center gap-1 text-xs">
            <Blockie address={notice.address} className="mr-0.5" />
            <span
              className={cn(
                "min-w-0 shrink truncate",
                notice.read ? "text-muted-foreground" : "font-medium text-foreground",
              )}
            >
              {label}
            </span>
            <span className="shrink-0 text-muted-foreground">{phrase}</span>
            <span className="inline-flex shrink-0 items-center gap-1 font-medium text-foreground">
              <AssetIcon coin={notice.coin} />
              {notice.coin}
            </span>
          </span>
          <RelativeTime time={notice.time} className="text-2xs text-faint" />
        </span>
        <span className="shrink-0 font-mono text-xs text-foreground tabular-nums">
          {formatUsd(notice.notionalUsd, { compact: true })}
        </span>
      </button>
    </li>
  );
}
