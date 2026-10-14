"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import Link from "next/link";
import { ArrowRight, LogIn, ShoppingCart, UtensilsCrossed } from "lucide-react";
import { api, ApiClientError } from "@/lib/api/client";
import { Button, Field, Input } from "@/components/ui";

const DEMO_ACCOUNTS = [
  { label: "Supermercado", email: "demo.super@vantyx.demo", password: "Demo!23456", icon: ShoppingCart },
  { label: "Restaurante", email: "demo.rest@vantyx.demo", password: "Demo!23456", icon: UtensilsCrossed },
];

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
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-graphite-950 p-4">
      {/* Hero mesh background */}
      <div className="bg-mesh-dark absolute inset-0 opacity-90" aria-hidden />
      <div
        className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_0%,rgba(10,11,13,0.55)_75%,rgba(10,11,13,0.9)_100%)]"
        aria-hidden
      />

      <div className="animate-fade-up relative w-full max-w-md">
        <div className="mb-8 text-center">
          <span className="shadow-glow-lime mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-[22px] bg-gradient-to-b from-lime-soft to-lime-brand font-mono text-3xl font-black text-graphite-950">
            V
          </span>
          <h1 className="font-mono text-3xl font-black tracking-[0.2em] text-white">
            VANTYX<span className="text-gradient-brand align-super text-xs">®</span>
          </h1>
          <p className="mt-2 text-sm font-medium text-mist-300/90">
            Universal Business Operating System
          </p>
        </div>

        <form
          onSubmit={onSubmit}
          className="glass-strong space-y-4 rounded-3xl p-6 shadow-2xl backdrop-blur-2xl"
        >
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
            <p role="alert" className="rounded-xl bg-red-500/10 px-3 py-2 text-xs font-medium text-danger ring-1 ring-red-500/20">
              {error}
            </p>
          )}
          <Button type="submit" variant="accent" size="lg" className="w-full" loading={loading} icon={<LogIn className="h-4 w-4" />}>
            Entrar
          </Button>

          {/* Demo quick-fill */}
          <div className="rounded-2xl bg-graphite-950/40 p-3 ring-1 ring-white/10">
            <p className="mb-2 text-[10px] font-bold tracking-widest text-graphite-300 uppercase">
              Explorar demo
            </p>
            <div className="grid grid-cols-2 gap-2">
              {DEMO_ACCOUNTS.map((d) => (
                <button
                  key={d.email}
                  type="button"
                  onClick={() => {
                    setEmail(d.email);
                    setPassword(d.password);
                    setError(null);
                  }}
                  className="flex items-center gap-2 rounded-xl bg-white/5 px-3 py-2 text-left text-xs font-semibold text-mist-100 ring-1 ring-white/10 transition-all hover:bg-lime-brand/15 hover:ring-lime-brand/40 active:scale-[0.97]"
                >
                  <d.icon className="h-4 w-4 shrink-0 text-lime-brand" />
                  <span className="min-w-0">
                    <span className="block truncate">{d.label}</span>
                    <span className="block truncate text-[10px] font-normal text-graphite-400">preencher login</span>
                  </span>
                </button>
              ))}
            </div>
          </div>

          <p className="text-center text-[11px] text-graphite-300">
            Primeira vez?{" "}
            <Link href="/onboarding" className="inline-flex items-center gap-0.5 font-semibold text-lime-brand hover:underline">
              Criar organização <ArrowRight className="h-3 w-3" />
            </Link>
          </p>
        </form>

        <p className="mt-6 text-center font-mono text-[9px] tracking-[0.3em] text-mist-300/60">
          ONE PLATFORM · EVERY BUSINESS · BUILT TO OPERATE
        </p>
      </div>
    </div>
  );
}
