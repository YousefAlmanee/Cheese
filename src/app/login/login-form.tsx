"use client";

import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import { isValidPin, isValidUsername, usernameEmail } from "@/lib/username";

export function LoginForm({ google, next }: { google: boolean; next: string }) {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function withGoogle() {
    setBusy(true);
    setError(null);
    const res = await authClient.signIn.social({ provider: "google", callbackURL: next });
    if (res?.error) {
      setError(res.error.message ?? "Could not start Google sign-in.");
      setBusy(false);
    }
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const f = new FormData(e.currentTarget);
    const username = String(f.get("username") ?? "").trim().toLowerCase();
    const pin = String(f.get("pin") ?? "").trim();

    if (!isValidUsername(username)) {
      setError("Username must be 3–20 lowercase letters, digits or underscores.");
      return;
    }
    if (!isValidPin(pin)) {
      setError("Your PIN must be exactly 4 digits.");
      return;
    }

    setBusy(true);
    if (mode === "signup") {
      const created = await authClient.signUp.email({ email: usernameEmail(username), password: pin, name: username, username });
      if (created.error) {
        setError(
          created.error.code === "USERNAME_IS_ALREADY_TAKEN"
            ? "That username is taken. Try signing in."
            : created.error.message ?? "Could not create your account.",
        );
        setBusy(false);
        return;
      }
    } else {
      const signedIn = await authClient.signIn.username({ username, password: pin });
      if (signedIn.error) {
        setError("Wrong username or PIN.");
        setBusy(false);
        return;
      }
    }
    window.location.href = next;
  }

  return (
    <div className="stack">
      <form className="card stack" onSubmit={submit}>
        <p className="ch-overline">{mode === "signup" ? "Create your account" : "Sign in"}</p>
        <div className="field">
          <label htmlFor="username">Username</label>
          <input
            id="username"
            name="username"
            className="input"
            required
            autoCapitalize="none"
            autoCorrect="off"
            autoComplete="username"
            placeholder="e.g. yousef"
          />
        </div>
        <div className="field">
          <label htmlFor="pin">4-digit PIN</label>
          <input
            id="pin"
            name="pin"
            className="input"
            type="password"
            inputMode="numeric"
            pattern="[0-9]{4}"
            maxLength={4}
            required
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            placeholder="••••"
          />
        </div>
        <button className="ch-btn ch-btn--primary ch-btn--block" disabled={busy}>
          {mode === "signup" ? "Create account" : "Sign in"}
        </button>
        <button
          type="button"
          className="ch-btn ch-btn--link"
          onClick={() => {
            setError(null);
            setMode(mode === "signup" ? "signin" : "signup");
          }}
          disabled={busy}
        >
          {mode === "signup" ? "Have an account? Sign in" : "New here? Create an account"}
        </button>
      </form>

      {google && (
        <>
          <p className="ch-overline ch-muted" style={{ textAlign: "center" }}>
            or
          </p>
          <button className="ch-btn ch-btn--ghost ch-btn--block" onClick={withGoogle} disabled={busy}>
            Continue with Google
          </button>
        </>
      )}

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
