import { useEffect, useState } from "react";
import {
  AuthState,
  getAuthState,
  initAuth,
  signIn as signInImpl,
  signOut as signOutImpl,
  subscribe,
} from "./bskyAuth";

const PENDING_SIGNIN_KEY = "hah.signin.pending";

export function useBskyAuth() {
  const [state, setState] = useState<AuthState>(() => getAuthState());

  useEffect(() => {
    const unsub = subscribe(setState);

    // Only touch the OAuth client when there's an actual reason to:
    //   1. We're handling an OAuth callback (URL has ?code=&state=)
    //   2. A sign-in intent was stashed before a cross-hostname hop
    // Otherwise the page stays in "idle" and the user has to click sign-in
    // to trigger any OAuth work. This prevents the oauth-client-browser
    // from normalizing the URL's hostname (localhost → 127.0.0.1) on mount.
    // The loopback OAuth client returns the authorization response in the URL
    // fragment (#state=...&code=...), not the query string — so check both.
    const search = new URLSearchParams(location.search);
    const hash = new URLSearchParams(location.hash.replace(/^#/, ""));
    const isCallback =
      (search.has("code") && search.has("state")) ||
      (hash.has("code") && hash.has("state")) ||
      hash.has("state"); // some flows return state (+ code/iss) in the fragment
    const pendingHandle = sessionStorage.getItem(PENDING_SIGNIN_KEY);
    const hasStoredSession =
      typeof localStorage !== "undefined" &&
      localStorage.getItem("hah.auth.hasSession") === "1";

    if (isCallback) {
      void initAuth();
    } else if (pendingHandle) {
      sessionStorage.removeItem(PENDING_SIGNIN_KEY);
      void signInImpl(pendingHandle);
    } else if (hasStoredSession) {
      // Previous session exists in IndexedDB — restore it
      void initAuth();
    }

    return unsub;
  }, []);

  return {
    state,
    signIn: (handle: string) => signInImpl(handle),
    signOut: () => signOutImpl(),
  };
}
