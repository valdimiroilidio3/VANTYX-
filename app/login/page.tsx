"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import Link from "next/link";
import { LogIn } from "lucide-react";
import { api, ApiClientError } from "@/lib/api/client";
import { Button, Field, Input } from "@/components/ui";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const data = await api<{ onboarded: boolean }>("/api/auth/login", {
        method: "POST",
        body: { email, password },
      });
      router.push(data.onboarded ? "/dashboard" : "/onboarding?continue=1");
      router.refresh();
    } catch (err) {
      if (err instanceof ApiClientError) setError(err.body.message);
      else setError("Falha de ligação. Tente novamente.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-graphite-900 p-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <span className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-lime-brand font-mono text-2xl font-black text-graphite-900">
            V
          </span>
          <h1 className="font-mono text-xl font-bold tracking-widest text-mist-100">
            VANTYX<span className="align-super text-[10px]">®</span>
          </h1>
          <p className="mt-1 text-xs text-graphite-400">
            Universal Business Operating System
          </p>
        </div>

        <form onSubmit={onSubmit} className="card space-y-4 p-5">
          <Field label="Email" required>
            <Input
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="operador@empresa.pt"
              required
              autoFocus
            />
          </Field>
          <Field label="Palavra-passe" required>
            <Input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </Field>
          {error && (
            <p role="alert" className="rounded-md bg-red-500/10 px-3 py-2 text-xs font-medium text-danger">
              {error}
            </p>
          )}
          <Button type="submit" variant="accent" className="w-full" loading={loading} icon={<LogIn className="h-4 w-4" />}>
            Entrar
          </Button>
          <p className="text-center text-[11px] text-graphite-400">
            Primeira vez?{" "}
            <Link href="/onboarding" className="font-semibold text-lime-dim hover:underline dark:text-lime-brand">
              Criar organização
            </Link>
          </p>
        </form>

        <p className="mt-6 text-center font-mono text-[9px] tracking-wider text-graphite-500">
          ONE PLATFORM · EVERY BUSINESS · BUILT TO OPERATE
        </p>
      </div>
    </div>
  );
}
