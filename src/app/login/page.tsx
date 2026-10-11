import { redirect } from "next/navigation";
import { googleConfigured } from "@/lib/auth";
import { getSession } from "@/lib/session";
import { safeNext } from "@/lib/safe-next";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeNext((await searchParams).next);
  if (await getSession()) redirect(next);
  return (
    <main className="page">
      <header>
        <h1 className="ch-title">Cheese</h1>
      </header>
      <section className="stack">
        <p>Everything you want to watch, read and play, in one place, with time set aside for it and friends to do it with.</p>
        <LoginForm google={googleConfigured} next={next} />
      </section>
    </main>
  );
}
