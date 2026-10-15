"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "./icons";

const tabs: { href: string; label: string; icon: IconName }[] = [
  { href: "/", label: "Home", icon: "home" },
  { href: "/library", label: "Library", icon: "lib" },
  { href: "/plan", label: "Plan", icon: "cal" },
  { href: "/friends", label: "Friends", icon: "users" },
];

/** `desktopOnly` renders the bar as a sidebar on wide screens and hides it on phones (used on pages opened from a tab). */
export function TabBar({ desktopOnly = false }: { desktopOnly?: boolean }) {
  const path = usePathname();
  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));
  const tab = (t: (typeof tabs)[number]) => (
    <Link key={t.href} className="ch-tab" href={t.href} aria-current={active(t.href) ? "page" : undefined}>
      <Icon name={t.icon} />
      {t.label}
    </Link>
  );
  return (
    <nav className={desktopOnly ? "ch-tabbar ch-tabbar--desk" : "ch-tabbar"} aria-label="Main">
      {tabs.slice(0, 2).map(tab)}
      <Link className="ch-tab-add" href="/add" aria-label="Add">
        <Icon name="plus" />
        <span className="ch-tab-add__label">Add</span>
      </Link>
      {tabs.slice(2).map(tab)}
    </nav>
  );
}
