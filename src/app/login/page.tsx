import { redirect } from "next/navigation";
import { currentUser } from "@/lib/server/auth";
import { LoginForm } from "./LoginForm";

export default async function LoginPage() {
  if (await currentUser()) redirect("/studio");
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand text-white">
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="currentColor" aria-hidden><path d="M8 5v14l11-7z" /></svg>
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Rample Video Studio</h1>
          <p className="mt-1 text-sm text-muted">Short video ads filmed in your own shop.</p>
        </div>
        <LoginForm />
      </div>
    </main>
  );
}
