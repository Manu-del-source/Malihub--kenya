/**
 * Cookie consent state. Stored in localStorage (for the UI) and mirrored to a
 * first-party cookie so the choice survives storage clearing and is readable
 * server-side if ever needed.
 *
 *  - "essential": only cookies required for sign-in, security and checkout.
 *  - "all":       essential + analytics (Google Analytics).
 */
export type ConsentChoice = "essential" | "all";
export type ConsentState = ConsentChoice | "unset";

const STORAGE_KEY = "malihub_cookie_consent";
const COOKIE_NAME = "mh_consent";
const CHANGE_EVENT = "malihub:cookie-consent";
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

function parse(value: string | null | undefined): ConsentState {
  return value === "all" || value === "essential" ? value : "unset";
}

function readCookie(): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|; )${COOKIE_NAME}=([^;]*)`));
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

export function readConsent(): ConsentState {
  try {
    const stored = parse(window.localStorage.getItem(STORAGE_KEY));
    if (stored !== "unset") return stored;
  } catch {
    /* storage can be unavailable (private mode); fall through to the cookie */
  }
  return parse(readCookie());
}

export function writeConsent(choice: ConsentChoice): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, choice);
  } catch {
    /* ignore */
  }
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${COOKIE_NAME}=${choice}; Max-Age=${ONE_YEAR_SECONDS}; Path=/; SameSite=Lax${secure}`;
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/** Clears the saved choice so the banner shows again ("Cookie settings"). */
export function resetConsent(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
  document.cookie = `${COOKIE_NAME}=; Max-Age=0; Path=/; SameSite=Lax`;
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function subscribeConsent(callback: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(CHANGE_EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}

/** Removes Google Analytics cookies when a visitor withdraws consent. */
export function clearAnalyticsCookies(): void {
  const hostParts = window.location.hostname.split(".");
  const domains = new Set<string | undefined>([undefined, window.location.hostname]);
  for (let i = 0; i < hostParts.length - 1; i++) domains.add(`.${hostParts.slice(i).join(".")}`);
  document.cookie
    .split("; ")
    .map((c) => c.split("=")[0] ?? "")
    .filter((name) => name === "_ga" || name.startsWith("_ga_") || name === "_gid" || name.startsWith("_gat"))
    .forEach((name) => {
      domains.forEach((domain) => {
        document.cookie = `${name}=; Max-Age=0; Path=/${domain ? `; Domain=${domain}` : ""}`;
      });
    });
}
