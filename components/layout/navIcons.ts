import {
  ActivityIcon,
  BookmarkIcon,
  CircleUserIcon,
  TrophyIcon,
  type LucideIcon,
} from "lucide-react";

import type { NavIcon } from "@/lib/nav";

/** The lucide icon for each nav icon name in `NAV_ITEMS`. */
export const NAV_ICONS: Record<NavIcon, LucideIcon> = {
  trophy: TrophyIcon,
  activity: ActivityIcon,
  bookmark: BookmarkIcon,
  user: CircleUserIcon,
};
