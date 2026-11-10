export default function OfflinePage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#0A0A0A] px-6 py-16 text-center text-white">
      <section className="w-full max-w-md">
        <p className="mb-3 text-xs font-semibold uppercase tracking-[0.25em] text-[#B8934A]">
          MaliHub Kenya
        </p>
        <h1 className="font-display text-3xl font-semibold">You’re offline</h1>
        <p className="mt-4 text-sm leading-6 text-white/65">
          We can’t reach MaliHub right now. Check your internet connection and try again.
          Your account and order information are not stored for offline access.
        </p>
        <a
          href="/"
          className="mt-8 inline-flex rounded-xl bg-[#B8934A] px-5 py-3 text-sm font-semibold text-[#0A0A0A] transition hover:bg-[#E6C98B]"
        >
          Try again
        </a>
      </section>
    </main>
  );
}
