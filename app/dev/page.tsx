import type { Metadata } from "next";

import { DevPanel } from "@/components/dev/DevPanel";

export const metadata: Metadata = {
  title: "Dev check · Slipstream",
  robots: { index: false, follow: false },
};

/** Throwaway check page. Not linked from the navigation. */
export default function DevPage() {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 md:px-6">
      <h1 className="mb-6 text-xl font-semibold">Dev check</h1>
      <DevPanel />
    </div>
  );
}
