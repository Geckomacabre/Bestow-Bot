export interface SessionUser {
  id: string;
  username: string;
  discriminator: string;
  avatar: string | null;
  accessToken: string;
  guilds: DiscordGuild[];
}

export interface DiscordGuild {
  id: string;
  name: string;
  icon: string | null;
  owner: boolean;
  permissions: string;
}

interface Session {
  user: SessionUser;
  expiresAt: number;
}

const store = new Map<string, Session>();

const TTL_MS = 24 * 60 * 60 * 1000;

export function createSession(user: SessionUser): string {
  const id = crypto.randomUUID();
  store.set(id, { user, expiresAt: Date.now() + TTL_MS });
  return id;
}

export function getSession(id: string): SessionUser | null {
  const session = store.get(id);
  if (!session) return null;
  if (Date.now() > session.expiresAt) {
    store.delete(id);
    return null;
  }
  return session.user;
}

export function deleteSession(id: string) {
  store.delete(id);
}

// Clean expired sessions every hour
setInterval(() => {
  const now = Date.now();
  for (const [id, session] of store) {
    if (now > session.expiresAt) store.delete(id);
  }
}, 60 * 60 * 1000);
