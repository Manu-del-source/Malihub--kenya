import Link from "next/link";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-svh flex-col items-center justify-center overflow-hidden px-4 py-12">
      <div className="pointer-events-none absolute inset-0 -z-10" aria-hidden>
        <div className="mesh-gradient absolute inset-0 opacity-70" />
      </div>

      <Link
        href="/"
        className="mb-8 flex items-center gap-2 font-display text-lg font-medium"
      >
        <span
          aria-hidden
          className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-primary-400 to-secondary text-sm font-semibold text-primary-foreground"
        >
          M
        </span>
        MaliHub
      </Link>

      <div className="w-full max-w-md">{children}</div>
    </div>
  );
}
