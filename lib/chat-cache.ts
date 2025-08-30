"use client";

import { type Message } from "@ai-sdk/react";
import { logger } from "./logger";

// Types and API surface
export type ChatId = string;
export type PageKey = "latest";

// Minimal message extensions for edits/deletes and temp IDs
export type Msg = Message & {
  updatedAt?: Date;
  deleted?: boolean;
  tempId?: string; // for offline queue
  serverId?: string; // reconciliation
};

export type MsgDelta = {
  op: "insert" | "edit" | "delete";
  message: Msg;
};

type CacheableMessage = Omit<Msg, "createdAt" | "updatedAt"> & {
  createdAt?: string;
  updatedAt?: string;
};

type ChatMeta = {
  chatId: ChatId;
  lastMessageAt?: string; // ISO
  unreadCount?: number;
  etag?: string;
  version?: number;
  lastServerSeq?: number;
};

type ChatPage = {
  key: string; // `${chatId}:${pageKey}`
  chatId: ChatId;
  pageKey: PageKey;
  messages: CacheableMessage[];
  etag?: string;
  range?: string; // e.g., cursor/range info
  ts: number;
};

// IndexedDB helpers (native)
const DB_NAME = "AIA-ChatCacheDB";
const DB_VERSION = 3;
const STORE_META = "chat_meta";
const STORE_PAGES = "chat_pages";
const STORE_KV = "kv";

const HOT_LIMIT = 5;
const PAGE_LIMIT = 100; // messages per chat page
const DISK_BUDGET_MB = 30; // 20–50MB budget; pick 30MB default

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      // Create meta store with index
      if (!db.objectStoreNames.contains(STORE_META)) {
        const s = db.createObjectStore(STORE_META, { keyPath: "chatId" });
        s.createIndex("by-lastMessageAt", "lastMessageAt", { unique: false });
      }
      // Create pages store
      if (!db.objectStoreNames.contains(STORE_PAGES)) {
        db.createObjectStore(STORE_PAGES, { keyPath: "key" });
      }
      // Simple KV store for schemaVersion and telemetry counters
      if (!db.objectStoreNames.contains(STORE_KV)) {
        db.createObjectStore(STORE_KV, { keyPath: "key" });
      }
      // Migration: on version bump, drop chat_pages but keep chat_meta
      if (req.oldVersion > 0 && req.oldVersion < DB_VERSION) {
        try {
          const tx = req.transaction!;
          const pages = tx.objectStore(STORE_PAGES);
          pages.clear();
        } catch (e) {
          // ignore
        }
      }
    };
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
  });
}

function tx<T = unknown>(db: IDBDatabase, store: string, mode: IDBTransactionMode, fn: (os: IDBObjectStore) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const os = t.objectStore(store);
    let result: any;
    t.oncomplete = () => resolve(result as T);
    t.onerror = () => reject(t.error);
    try {
      result = fn(os);
    } catch (e) {
      reject(e);
    }
  });
}

async function getItem<T>(db: IDBDatabase, store: string, key: IDBValidKey): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, "readonly");
    const req = t.objectStore(store).get(key);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result as T | undefined);
  });
}

async function putItem(db: IDBDatabase, store: string, value: any): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, "readwrite");
    const req = t.objectStore(store).put(value);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve();
  });
}

async function deleteItem(db: IDBDatabase, store: string, key: IDBValidKey): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, "readwrite");
    const req = t.objectStore(store).delete(key);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve();
  });
}

async function getAll<T>(db: IDBDatabase, store: string): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, "readonly");
    const req = t.objectStore(store).getAll();
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve((req.result || []) as T[]);
  });
}

function toISO(d?: Date): string | undefined {
  return d ? new Date(d).toISOString() : undefined;
}

function fromISO(s?: string): Date | undefined {
  return s ? new Date(s) : undefined;
}

function sanitizeAttachments(msg: Msg): Msg {
  const m = { ...msg } as any;
  if (m.attachments && Array.isArray(m.attachments)) {
    m.attachments = m.attachments.map((a: any) => ({
      name: a?.name,
      size: a?.size,
      type: a?.type,
      url: a?.url,
      id: a?.id,
    }));
  }
  return m;
}

function toCacheable(msgs: Msg[]): CacheableMessage[] {
  return msgs.map((m) => {
    const s = sanitizeAttachments(m);
    const { createdAt, updatedAt, ...rest } = s;
    return {
      ...rest,
      createdAt: toISO(createdAt),
      updatedAt: toISO(updatedAt),
    } as CacheableMessage;
  });
}

function fromCacheable(msgs: CacheableMessage[]): Msg[] {
  return msgs.map((m) => ({
    ...(m as any),
    createdAt: fromISO(m.createdAt),
    updatedAt: fromISO(m.updatedAt),
  }));
}

export class ChatCache {
  private db!: IDBDatabase;
  private hotSet: Map<ChatId, CacheableMessage[]> = new Map(); // LRU insertion order
  private currentChatId: ChatId | null = null;
  private isInitialized = false;
  private hits = 0;
  private misses = 0;

  // Optionally supply current chat on init
  async init(currentChatId?: ChatId): Promise<void> {
    if (this.isInitialized) {
      if (currentChatId) this.currentChatId = currentChatId;
      return;
    }
    this.db = await openDatabase();
    this.isInitialized = true;
    logger.info("ChatCache initialized");

    if (currentChatId) {
      this.currentChatId = currentChatId;
      // Ensure current chat is hot
      await this.getPage(currentChatId, "latest");
      this.markUsed(currentChatId);
    }

    // Prefetch next 4 most-recent chats (best effort)
    try {
      const res = await fetch(`/chats?limit=5`, { method: "GET" });
      if (res.ok) {
        const list = await res.json();
        const ids: ChatId[] = (list?.chats || list || []).map((c: any) => c.chatId || c.id).filter(Boolean);
        const toPrefetch = ids.filter((id) => id !== currentChatId).slice(0, 4);
        for (const id of toPrefetch) {
          // fire-and-forget SWR check
          swrRefresh(this, id).catch(() => {});
        }
      }
    } catch {
      // ignore if endpoint not available
    }
  }

  private pageKey(chatId: ChatId, page: PageKey): string {
    return `${chatId}:${page}`;
  }

  markUsed(chatId: ChatId): void {
    if (this.hotSet.has(chatId)) {
      const v = this.hotSet.get(chatId)!;
      this.hotSet.delete(chatId);
      this.hotSet.set(chatId, v);
    } else {
      // placeholder for empty until filled
      this.hotSet.set(chatId, []);
    }
    this.enforceHotLimit();
  }

  private enforceHotLimit(): void {
    while (this.hotSet.size > HOT_LIMIT) {
      const lruChatId = this.hotSet.keys().next().value as ChatId | undefined;
      if (!lruChatId) break;
      if (lruChatId === this.currentChatId) {
        // move current to MRU
        const v = this.hotSet.get(lruChatId)!;
        this.hotSet.delete(lruChatId);
        this.hotSet.set(lruChatId, v);
        break;
      }
      this.hotSet.delete(lruChatId);
      logger.info(`[ChatCache] Evicted ${lruChatId} from hot set`);
    }
  }

  async getPage(chatId: ChatId, page: PageKey): Promise<{ messages: Msg[] }> {
    if (!this.isInitialized) await this.init();

    // 1. memory
    if (this.hotSet.has(chatId) && this.hotSet.get(chatId)!.length) {
      this.hits++;
      this.markUsed(chatId);
      return { messages: fromCacheable(this.hotSet.get(chatId)!) };
    }

    // 2. disk
    const key = this.pageKey(chatId, page);
    const pageData = await getItem<ChatPage>(this.db, STORE_PAGES, key);
    if (pageData) {
      this.hits++;
      this.hotSet.set(chatId, pageData.messages || []);
      this.markUsed(chatId);
      return { messages: fromCacheable(pageData.messages || []) };
    }

    this.misses++;
    return { messages: [] };
  }

  async applyDelta(chatId: ChatId, delta: MsgDelta[]): Promise<void> {
    if (!this.isInitialized) await this.init();
    const { messages } = await this.getPage(chatId, "latest");
    const byId = new Map<string, Msg>();
    for (const m of messages) byId.set(m.id, m);

    for (const d of delta) {
      const m = d.message;
      const existing = byId.get(m.id);
      const incomingUpdatedAt = m.updatedAt?.getTime?.() ?? m.createdAt?.getTime?.() ?? 0;
      const existingUpdatedAt = existing?.updatedAt?.getTime?.() ?? existing?.createdAt?.getTime?.() ?? 0;

      if (d.op === "delete") {
        if (existing) byId.delete(m.id);
        continue;
      }

      if (!existing) {
        byId.set(m.id, m);
        continue;
      }

      // edit/insert idempotent with monotonic updatedAt
      if (incomingUpdatedAt >= existingUpdatedAt) {
        byId.set(m.id, { ...existing, ...m });
      }
    }

    const merged = Array.from(byId.values()).sort((a, b) => (a.createdAt?.getTime?.() ?? 0) - (b.createdAt?.getTime?.() ?? 0));
    await this.upsertMessages(chatId, merged, { source: "net" });
  }

  async upsertMessages(chatId: ChatId, msgs: Msg[], opts?: { source: "net" | "local"; etag?: string; serverSeq?: number }): Promise<void> {
    if (!this.isInitialized) await this.init();

    // Start from existing in-memory or disk
    const existingCacheable = this.hotSet.get(chatId) || (await getItem<ChatPage>(this.db, STORE_PAGES, this.pageKey(chatId, "latest")))?.messages || [];
    const existing = fromCacheable(existingCacheable);

    // Build byId map with idempotent semantics
    const map = new Map<string, Msg>();
    for (const m of existing) map.set(m.id, m);

    for (const m0 of msgs) {
      const m = sanitizeAttachments(m0);
      // Reconcile temp to server IDs if provided
      if (m.tempId && m.serverId) {
        const tempExisting = Array.from(map.values()).find((x) => x.id === m.tempId);
        if (tempExisting) {
          map.delete(tempExisting.id);
          map.set(m.serverId, { ...tempExisting, id: m.serverId, tempId: undefined });
          continue;
        }
      }

      const prev = map.get(m.id);
      if (!prev) {
        if (!m.deleted) map.set(m.id, m);
        continue;
      }
      const prevU = prev.updatedAt?.getTime?.() ?? prev.createdAt?.getTime?.() ?? 0;
      const nextU = m.updatedAt?.getTime?.() ?? m.createdAt?.getTime?.() ?? 0;
      if (m.deleted) {
        map.delete(m.id);
        continue;
      }
      if (nextU >= prevU) {
        map.set(m.id, { ...prev, ...m });
      }
    }

    // Sort and window
    const merged = Array.from(map.values()).sort((a, b) => (a.createdAt?.getTime?.() ?? 0) - (b.createdAt?.getTime?.() ?? 0));
    const finalMsgs = merged.slice(-PAGE_LIMIT);
    const cacheable = toCacheable(finalMsgs);

    // Update memory LRU first
    this.hotSet.set(chatId, cacheable);
    this.markUsed(chatId);

    // Persist page
    const page: ChatPage = {
      key: this.pageKey(chatId, "latest"),
      chatId,
      pageKey: "latest",
      messages: cacheable,
      etag: opts?.etag,
      ts: Date.now(),
    };
    await putItem(this.db, STORE_PAGES, page);

    // Update meta
    const lastMessageAt = finalMsgs.length ? toISO(finalMsgs[finalMsgs.length - 1].createdAt) : undefined;
    const metaPrev = (await getItem<ChatMeta>(this.db, STORE_META, chatId)) || { chatId };
    const meta: ChatMeta = {
      ...metaPrev,
      chatId,
      lastMessageAt,
      etag: opts?.etag ?? metaPrev.etag,
      lastServerSeq: opts?.serverSeq ?? metaPrev.lastServerSeq,
      version: DB_VERSION,
    };
    await putItem(this.db, STORE_META, meta);
  }

  stats(): { hot: ChatId[]; sizeMB: number; hitRate: number } {
    const sizeMB = this._approxSizeMBSync();
    const hitRate = (this.hits + this.misses) ? this.hits / (this.hits + this.misses) : 0;
    return { hot: Array.from(this.hotSet.keys()), sizeMB, hitRate };
  }

  private _approxSizeMBSync(): number {
    // Use in-memory pages as a lower-bound estimate
    let bytes = 0;
    for (const [, msgs] of this.hotSet) {
      try { bytes += new Blob([JSON.stringify(msgs)]).size; } catch { /* noop */ }
    }
    return +(bytes / (1024 * 1024)).toFixed(2);
  }

  async sweep(): Promise<void> {
    // Enforce disk budget by deleting oldest pages, keeping meta
    const pages = await getAll<ChatPage>(this.db, STORE_PAGES);
    const totalBytes = pages.reduce((acc, p) => acc + (JSON.stringify(p.messages).length || 0), 0);
    const totalMB = totalBytes / (1024 * 1024);
    if (totalMB <= DISK_BUDGET_MB) return;
    const sorted = pages.sort((a, b) => a.ts - b.ts);
    let bytes = totalBytes;
    for (const p of sorted) {
      if (bytes / (1024 * 1024) <= DISK_BUDGET_MB) break;
      if (p.chatId === this.currentChatId) continue; // never evict current
      await deleteItem(this.db, STORE_PAGES, p.key);
      bytes -= JSON.stringify(p.messages).length || 0;
      logger.info(`[ChatCache] Swept page ${p.key}`);
    }
  }

  async loadEtag(chatId: ChatId): Promise<string | undefined> {
    const meta = await getItem<ChatMeta>(this.db, STORE_META, chatId);
    return meta?.etag;
  }
}

// SWR helpers (pseudocode aligned)
export const HOT_LIMIT_CONST = HOT_LIMIT;

export async function openChat(cache: ChatCache, chatId: ChatId) {
  cache.markUsed(chatId);
  await cache.getPage(chatId, "latest");
  swrRefresh(cache, chatId).catch(() => {});
  enforceHotLimit(cache);
}

export function enforceHotLimit(cache: ChatCache) {
  // the class already enforces on markUsed; this triggers it
  cache.markUsed((cache as any)["currentChatId"] || "");
}

export async function swrRefresh(cache: ChatCache, chatId: ChatId) {
  let etag: string | undefined;
  try { etag = await cache.loadEtag(chatId); } catch { /* noop */ }
  const url = `/chats/${encodeURIComponent(chatId)}/messages?cursor=latest&limit=${PAGE_LIMIT}`;
  const res = await fetch(url, { headers: etag ? { "If-None-Match": etag } : {} });
  if (res.status === 304) return; // unchanged
  if (res.ok) {
    const data = await res.json();
    const messages: Msg[] = (data?.messages || []) as Msg[];
    const newEtag = res.headers.get("ETag") || data?.etag;
    const lastMessageAt = messages.length ? messages[messages.length - 1].createdAt : undefined;
    await cache.upsertMessages(chatId, messages, { source: "net", etag: newEtag || undefined, serverSeq: data?.serverSeq });
    // Optionally update meta lastMessageAt is handled in upsertMessages
    logger.info(`[ChatCache] SWR refreshed ${chatId} last=${String(lastMessageAt)}`);
  }
}
