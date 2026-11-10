"use client";

import { useEffect, useState } from "react";
import { Download, X } from "lucide-react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

export function PwaInstallPrompt() {
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [isIos, setIsIos] = useState(false);
  const [showIosHelp, setShowIosHelp] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      const register = () => {
        navigator.serviceWorker.register("/sw.js").catch((error) => {
          console.error("MaliHub service worker registration failed:", error);
        });
      };

      if (document.readyState === "complete") register();
      else window.addEventListener("load", register, { once: true });
    }

    const standalone = window.matchMedia("(display-mode: standalone)").matches ||
      Boolean((navigator as Navigator & { standalone?: boolean }).standalone);

    const userAgent = window.navigator.userAgent.toLowerCase();
    const iosDevice = /iphone|ipad|ipod/.test(userAgent);
    setIsIos(iosDevice && !standalone);

    const handleInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallEvent(event as BeforeInstallPromptEvent);
    };

    const handleInstalled = () => {
      setInstallEvent(null);
      setDismissed(true);
    };

    window.addEventListener("beforeinstallprompt", handleInstallPrompt);
    window.addEventListener("appinstalled", handleInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleInstallPrompt);
      window.removeEventListener("appinstalled", handleInstalled);
    };
  }, []);

  if (dismissed || (!installEvent && !isIos)) return null;

  const handleInstall = async () => {
    if (isIos && !installEvent) {
      setShowIosHelp(true);
      return;
    }

    if (!installEvent) return;
    await installEvent.prompt();
    const choice = await installEvent.userChoice;
    if (choice.outcome === "accepted") setDismissed(true);
    setInstallEvent(null);
  };

  return (
    <>
      <div className="fixed inset-x-0 bottom-4 z-[80] mx-auto flex w-[calc(100%-2rem)] max-w-sm items-center gap-3 rounded-2xl border border-[#B8934A]/40 bg-[#111111] p-3 text-white shadow-2xl">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#B8934A]/15 text-[#E6C98B]">
          <Download size={19} aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">Get the MaliHub app</p>
          <p className="text-xs text-white/65">Add it to your home screen for quick access.</p>
        </div>
        <button
          type="button"
          onClick={handleInstall}
          className="rounded-xl bg-[#B8934A] px-3 py-2 text-xs font-semibold text-[#0A0A0A] transition hover:bg-[#E6C98B]"
        >
          Install
        </button>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label="Dismiss install prompt"
          className="rounded-lg p-1 text-white/55 hover:text-white"
        >
          <X size={16} aria-hidden="true" />
        </button>
      </div>

      {showIosHelp && (
        <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/70 p-4 sm:items-center">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="ios-install-title"
            className="w-full max-w-sm rounded-2xl border border-[#B8934A]/40 bg-[#111111] p-5 text-white shadow-2xl"
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 id="ios-install-title" className="text-base font-semibold">Add MaliHub to your Home Screen</h2>
              <button
                type="button"
                onClick={() => setShowIosHelp(false)}
                aria-label="Close instructions"
                className="rounded-lg p-1 text-white/60 hover:text-white"
              >
                <X size={18} />
              </button>
            </div>
            <ol className="list-decimal space-y-2 pl-5 text-sm text-white/75">
              <li>Open MaliHub in Safari.</li>
              <li>Tap the Share button.</li>
              <li>Choose “Add to Home Screen”.</li>
              <li>Tap “Add” to finish.</li>
            </ol>
            <button
              type="button"
              onClick={() => setShowIosHelp(false)}
              className="mt-5 w-full rounded-xl bg-[#B8934A] px-4 py-3 text-sm font-semibold text-[#0A0A0A]"
            >
              Got it
            </button>
          </section>
        </div>
      )}
    </>
  );
}
