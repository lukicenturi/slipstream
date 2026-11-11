"use client";

import { usePathname, useSearchParams } from "next/navigation";

import { activeNavKey, parseHomeView, type HomeView, type NavKey } from "@/lib/nav";

/*
 * URL state for the primary navigation. Both hooks read request data
 * (the pathname and the search params). With cacheComponents on, a
 * component that calls them must render inside a <Suspense> boundary,
 * or the prerender of routes such as /trader/[address] fails.
 */

/** The active nav item. It is the same at every width. */
export function useActiveNavKey(): NavKey | null {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  return activeNavKey(pathname, searchParams.get("view"));
}

/** The view of the home page, from `?view=`. */
export function useHomeView(): HomeView {
  const searchParams = useSearchParams();
  return parseHomeView(searchParams.get("view"));
}
