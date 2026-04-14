import { useEffect, useState } from "react";
import {
  AuthState,
  getAuthState,
  initAuth,
  signIn as signInImpl,
  signOut as signOutImpl,
  subscribe,
} from "./bskyAuth";

export function useBskyAuth() {
  const [state, setState] = useState<AuthState>(() => getAuthState());

  useEffect(() => {
    const unsub = subscribe(setState);
    // Fire-and-forget init on mount. Loads OAuth client and consumes any
    // OAuth callback params present in the URL.
    void initAuth();
    return unsub;
  }, []);

  return {
    state,
    signIn: (handle: string) => signInImpl(handle),
    signOut: () => signOutImpl(),
  };
}
