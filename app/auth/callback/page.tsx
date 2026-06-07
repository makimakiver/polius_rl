/**
 * OAuth redirect landing page for Enoki zkLogin.
 *
 * The Enoki wallet uses a popup flow: it opens this URL inside the popup,
 * reads the OAuth token from the popup's location, then closes it. This page
 * just needs to load quickly — the parent window finishes the sign-in. Keeping
 * it tiny avoids booting the whole app inside the popup.
 */
export default function AuthCallback() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f1f3f6]">
      <p className="font-mono text-xs uppercase tracking-[0.18em] text-ink/50">
        Completing sign-in…
      </p>
    </main>
  );
}
