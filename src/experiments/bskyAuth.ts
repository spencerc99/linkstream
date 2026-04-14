// Lightweight singleton wrapper around @atproto/oauth-client-browser that the
// Messages experiment uses to let a user sign in and post real replies.
//
// Heavy deps (oauth-client-browser, @atproto/api) are dynamically imported so
// they only load when sign-in is attempted.

import type { OAuthSession } from "@atproto/oauth-client-browser";
import type { Agent } from "@atproto/api";

export interface ReplyTarget {
  rootUri: string;
  rootCid: string;
  parentUri: string;
  parentCid: string;
}

export interface AuthState {
  status: "idle" | "loading" | "signed-in" | "signed-out" | "error";
  handle?: string;
  did?: string;
  error?: string;
}

type Subscriber = (s: AuthState) => void;

const subscribers = new Set<Subscriber>();
let state: AuthState = { status: "idle" };
let client:
  | import("@atproto/oauth-client-browser").BrowserOAuthClient
  | null = null;
let agent: Agent | null = null;
let session: OAuthSession | null = null;
let initPromise: Promise<void> | null = null;

function setState(next: AuthState) {
  state = next;
  for (const fn of subscribers) fn(state);
}

export function getAuthState(): AuthState {
  return state;
}

export function subscribe(fn: Subscriber): () => void {
  subscribers.add(fn);
  fn(state);
  return () => subscribers.delete(fn);
}

function getClientConfig() {
  const host = location.hostname;
  const isLocal = host === "127.0.0.1" || host === "localhost";
  const origin = isLocal
    ? `http://127.0.0.1:${location.port}`
    : location.origin;
  const redirectUri = `${origin}/HAH/messages`;

  if (isLocal) {
    const clientId =
      `http://localhost?redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&scope=${encodeURIComponent("atproto transition:generic")}`;
    return { clientId, redirectUri };
  }
  return {
    clientId: `${origin}/client-metadata.json`,
    redirectUri,
  };
}

export async function initAuth(): Promise<void> {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    setState({ status: "loading" });
    try {
      const [{ BrowserOAuthClient }, api] = await Promise.all([
        import("@atproto/oauth-client-browser"),
        import("@atproto/api"),
      ]);

      const { clientId } = getClientConfig();

      client = await BrowserOAuthClient.load({
        clientId,
        handleResolver: "https://bsky.social",
      });

      // If this page load is the OAuth callback, init() consumes the code.
      // Otherwise it restores any stored session.
      const result = await client.init();
      if (result && "session" in result) {
        session = result.session;
        agent = new api.Agent(session);
        setState({
          status: "signed-in",
          handle: session.did
            ? await resolveHandle(session.did).catch(() => undefined)
            : undefined,
          did: session.did,
        });
        // Strip OAuth params from the URL so refresh doesn't re-process them
        if (location.search.includes("code=") || location.search.includes("state=")) {
          history.replaceState(null, "", location.pathname);
        }
      } else {
        setState({ status: "signed-out" });
      }
    } catch (e) {
      console.error("bskyAuth init failed", e);
      setState({
        status: "error",
        error: e instanceof Error ? e.message : String(e),
      });
    }
  })();
  return initPromise;
}

async function resolveHandle(did: string): Promise<string | undefined> {
  try {
    const res = await fetch(
      `https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(did)}`
    );
    if (!res.ok) return undefined;
    const data = (await res.json()) as { handle?: string };
    return data.handle;
  } catch {
    return undefined;
  }
}

export async function signIn(handle: string): Promise<void> {
  await initAuth();
  if (!client) throw new Error("auth client not ready");
  await client.signIn(handle.trim(), {
    scope: "atproto transition:generic",
  });
  // signIn triggers a redirect; code past this rarely executes
}

export async function signOut(): Promise<void> {
  try {
    if (session && client) {
      await client.revoke(session.did);
    }
  } catch (e) {
    console.error("signOut error", e);
  }
  session = null;
  agent = null;
  setState({ status: "signed-out" });
}

// Post a reply (or top-level post) to Bluesky.
// Returns the URI of the new post.
export async function postReply(
  text: string,
  reply?: ReplyTarget
): Promise<string> {
  if (!agent || !session) {
    throw new Error("not signed in");
  }
  const record: Record<string, unknown> = {
    $type: "app.bsky.feed.post",
    text,
    createdAt: new Date().toISOString(),
  };
  if (reply) {
    record.reply = {
      root: { uri: reply.rootUri, cid: reply.rootCid },
      parent: { uri: reply.parentUri, cid: reply.parentCid },
    };
  }
  const res = await agent.com.atproto.repo.createRecord({
    repo: session.did,
    collection: "app.bsky.feed.post",
    record,
  });
  return res.data.uri;
}
