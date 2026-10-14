import { TabBar } from "@/components/tab-bar";
import { requireUser } from "@/lib/session";

export default async function StackLayout({ children }: { children: React.ReactNode }) {
  await requireUser();
  return (
    <>
      <main className="page">{children}</main>
      <TabBar desktopOnly />
    </>
  );
}
