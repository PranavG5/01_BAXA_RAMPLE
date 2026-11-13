import { requirePageUser } from "@/lib/server/auth";
import { env } from "@/lib/server/env";
import { storageIsTemporary } from "@/lib/server/paths";
import { NavLinks } from "@/components/NavLinks";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, business, staff } = await requirePageUser();
  const mock = env.mediaMode() === "mock";
  const temporary = storageIsTemporary();
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-line bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-3 sm:px-6">
          <a href="/studio" className="flex shrink-0 items-center gap-2 font-bold tracking-tight">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand text-white">
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden><path d="M8 5v14l11-7z" /></svg>
            </span>
            <span className="hidden sm:inline">Rample</span>
          </a>
          <NavLinks staff={staff} />
          <div className="ml-auto flex items-center gap-3 text-sm">
            <span className="hidden max-w-[180px] truncate text-muted md:inline">{business.name || user.email}</span>
            <form action="/auth/signout" method="post">
              <button className="rounded-lg px-2 py-1 text-muted hover:bg-canvas hover:text-ink">Sign out</button>
            </form>
          </div>
        </div>
      </header>
      {temporary && (
        <div className="border-b border-bad/25 bg-bad/10 px-4 py-2 text-center text-xs font-medium text-bad">
          Storage is not set up: photos and videos are kept on one temporary server and will disappear. Add DATABASE_URL, SUPABASE_URL and SUPABASE_SECRET_KEY in Vercel, then redeploy.
        </div>
      )}
      {mock && (
        <div className="border-b border-warn/25 bg-warn/10 px-4 py-2 text-center text-xs font-medium text-[#7a4a00]">
          Mock media mode: video models, voiceover and assembly are simulated locally. No provider credits are spent.
        </div>
      )}
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">{children}</main>
    </div>
  );
}
