import { PullToRefresh } from "@/components/pull-to-refresh";
import { TabBar } from "@/components/tab-bar";
import { TimezoneSync } from "@/components/timezone-sync";
import { requireUser } from "@/lib/session";

export default async function TabsLayout({ children }: { children: React.ReactNode }) {
  const { profile } = await requireUser();
  return (
    <>
      <PullToRefresh>{children}</PullToRefresh>
      <TabBar />
      <TimezoneSync saved={profile.timezone} />
    </>
  );
}
