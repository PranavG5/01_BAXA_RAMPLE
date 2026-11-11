"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { call } from "@/lib/client";
import { btn, cx } from "@/components/ui";

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await call("/api/auth/login", { method: "POST", json: { email, password } });
      router.replace("/studio");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not sign in");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="rounded-2xl border border-line bg-white p-6 shadow-sm">
      <label className="block text-sm font-medium">
        Email
        <input type="email" required autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1 w-full rounded-lg border border-line px-3 py-2 outline-none focus:border-brand" />
      </label>
      <label className="mt-4 block text-sm font-medium">
        Password
        <input type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className="mt-1 w-full rounded-lg border border-line px-3 py-2 outline-none focus:border-brand" />
      </label>
      {error && <p className="mt-4 text-sm text-bad">{error}</p>}
      <button disabled={busy} className={cx(btn.base, btn.primary, "mt-5 w-full")}>
        {busy ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
