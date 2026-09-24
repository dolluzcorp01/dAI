/**
 * Typed-ish wrappers over every endpoint the v10 client needs.
 * Returns UI-shaped objects, so screens never touch backend naming.
 */
import { toUiMessage, toUiAnswer, toUiPerson, toUiConversation, convoKey } from "./adapters.js";

export function createApi(client) {
  return {
    /* ---- auth ---- */
    auth: {
      async login(email, password, surface = "web") {
        const out = await client.post("/api/auth/login", { email, password, surface });
        await client.tokens.set({ accessToken: out.accessToken, refreshToken: out.refreshToken });
        return { user: toUiPerson(out.user), roles: out.roles };
      },
      /** Extension step 1: the site mints a one-time code. */
      authorize(email, password, state, redirectUri) {
        return client.post("/api/auth/authorize", {
          email, password, state, redirect_uri: redirectUri,
        });
      },
      /** Extension step 2: swap the code for tokens. */
      async exchange(code, state) {
        const out = await client.post("/api/auth/token", { code, state });
        await client.tokens.set({ accessToken: out.accessToken, refreshToken: out.refreshToken });
        return { user: toUiPerson(out.user), roles: out.roles };
      },
      async me() {
        const out = await client.get("/api/auth/me");
        return { user: toUiPerson(out.user), roles: out.roles, session: out.session };
      },
      sessions: () => client.get("/api/auth/sessions"),
      revokeSession: (id) => client.del(`/api/auth/sessions/${id}`),
      async logout() {
        const refreshToken = await client.tokens.getRefresh();
        try { await client.post("/api/auth/logout", { refresh_token: refreshToken }); }
        finally { await client.tokens.clear(); }
      },
    },

    /* ---- me ---- */
    users: {
      async me() { return toUiPerson((await client.get("/api/users/me")).user); },
      async update(fields) { return toUiPerson((await client.patch("/api/users/me", fields)).user); },
      async setPresence(presence) {
        return toUiPerson((await client.put("/api/users/me/presence", { presence })).user);
      },
      async setStatus(emoji, text, expiresInMinutes) {
        return toUiPerson((await client.put("/api/users/me/status", { emoji, text, expiresInMinutes })).user);
      },
      settings: () => client.get("/api/users/me/settings").then(r => r.settings),
      updateSettings: (s) => client.patch("/api/users/me/settings", s).then(r => r.settings),
      async directory(params = {}) {
        const out = await client.get("/api/users", { query: params });
        return { ...out, users: out.users.map(toUiPerson) };
      },
      teams: () => client.get("/api/users/teams").then(r => r.teams),
      quickLinks: () => client.get("/api/users/me/quick-links").then(r => r.links),
      addQuickLink: (label, url) => client.post("/api/users/me/quick-links", { label, url }).then(r => r.link),
      removeQuickLink: (id) => client.del(`/api/users/me/quick-links/${id}`),
    },

    /* ---- conversations ---- */
    conversations: {
      async list(includeArchived = false) {
        const out = await client.get("/api/conversations", { query: { includeArchived } });
        return out.conversations.map(c => toUiConversation(c));
      },
      async get(id) { return toUiConversation((await client.get(`/api/conversations/${id}`)).conversation); },
      async create(kind, name, memberIds = [], topic) {
        const out = await client.post("/api/conversations", { kind, name, memberIds, topic });
        return toUiConversation(out.conversation);
      },
      async openDm(userId) {
        return toUiConversation((await client.post("/api/conversations/dm", { userId })).conversation);
      },
      directory: (q) => client.get("/api/conversations/directory", { query: { q } }).then(r => r.channels),
      update: (id, fields) => client.patch(`/api/conversations/${id}`, fields).then(r => toUiConversation(r.conversation)),
      updateMembership: (id, fields) =>
        client.patch(`/api/conversations/${id}/membership`, fields).then(r => toUiConversation(r.conversation)),
      join: (id) => client.post(`/api/conversations/${id}/join`).then(r => toUiConversation(r.conversation)),
      leave: (id) => client.post(`/api/conversations/${id}/leave`),
      members: (id) => client.get(`/api/conversations/${id}/members`).then(r => r.members),
      addMember: (id, userId) => client.post(`/api/conversations/${id}/members`, { userId }),
      removeMember: (id, userId) => client.del(`/api/conversations/${id}/members/${userId}`),
      setRole: (id, userId, memberRole) =>
        client.put(`/api/conversations/${id}/members/${userId}/role`, { memberRole }),
      drafts: () => client.get("/api/conversations/drafts").then(r => r.drafts),
      saveDraft: (id, body) => client.put(`/api/conversations/${id}/draft`, { body }),
    },

    /* ---- messages ---- */
    messages: {
      async since(conversationId, afterSeq = 0, ctx = {}) {
        const out = await client.get(`/api/conversations/${conversationId}/messages`, {
          query: { afterSeq, limit: ctx.limit },
        });
        return { ...out, messages: out.messages.map(m => toUiMessage(m, ctx)) };
      },
      async before(conversationId, beforeSeq, ctx = {}) {
        const out = await client.get(`/api/conversations/${conversationId}/messages`, {
          query: { beforeSeq, limit: ctx.limit },
        });
        return { ...out, messages: out.messages.map(m => toUiMessage(m, ctx)) };
      },
      async send(conversationId, body, clientMsgId, extra = {}, ctx = {}) {
        const out = await client.post(`/api/conversations/${conversationId}/messages`, {
          body, clientMsgId, ...extra,
        });
        return { ...out, message: toUiMessage(out.message, ctx) };
      },
      markRead: (conversationId, seq) => client.put(`/api/conversations/${conversationId}/read`, { seq }),
      edit: (id, body, ctx = {}) => client.patch(`/api/messages/${id}`, { body }).then(r => toUiMessage(r.message, ctx)),
      deleteForMe: (id) => client.del(`/api/messages/${id}`, { query: { scope: "me" } }),
      deleteForAll: (id) => client.del(`/api/messages/${id}`, { query: { scope: "all" } }),
      react: (id, emoji, ctx = {}) =>
        client.post(`/api/messages/${id}/reactions`, { emoji }).then(r => toUiMessage(r.message, ctx)),
      unreact: (id, emoji, ctx = {}) =>
        client.del(`/api/messages/${id}/reactions`, { query: { emoji } }).then(r => toUiMessage(r.message, ctx)),
      pin: (id) => client.put(`/api/messages/${id}/pin`),
      unpin: (id) => client.del(`/api/messages/${id}/pin`),
      pins: (conversationId, ctx = {}) =>
        client.get(`/api/conversations/${conversationId}/pins`).then(r => r.messages.map(m => toUiMessage(m, ctx))),
      forward: (id, conversationId, ctx = {}) =>
        client.post(`/api/messages/${id}/forward`, { conversationId }).then(r => toUiMessage(r.message, ctx)),
      async thread(id, ctx = {}) {
        const out = await client.get(`/api/messages/${id}/thread`);
        return { root: toUiMessage(out.root, ctx), replies: out.replies.map(m => toUiMessage(m, ctx)) };
      },
    },

    /* ---- kody ---- */
    kody: {
      async ask(question, threadId) {
        const out = await client.post("/api/kody/ask", { question, threadId });
        return { threadId: out.threadId, answer: toUiAnswer(out.message), degraded: !!out.degraded };
      },
      async askIn(conversationId, question, ctx = {}) {
        const out = await client.post(`/api/kody/conversations/${conversationId}/ask`, { question });
        return {
          chatMessage: toUiMessage(out.chatMessage, ctx),
          answer: toUiAnswer(out.kodyMessage),
          degraded: !!out.degraded,
        };
      },
      threads: () => client.get("/api/kody/threads").then(r => r.threads),
      async thread(id) {
        const out = await client.get(`/api/kody/threads/${id}`);
        return {
          thread: out.thread,
          messages: out.messages.map(m => (m.role === "assistant"
            ? { role: "kody", answer: toUiAnswer(m) }
            : { role: "user", text: m.body, ts: m.createdAt })),
        };
      },
      feedback: (messageId, vote, comment) =>
        client.post(`/api/kody/messages/${messageId}/feedback`, { vote, comment }),
      points: () => client.get("/api/kody/points"),
      lookupCode: (code) => client.get(`/api/kody/codes/${encodeURIComponent(code)}`).then(r => r.entries),
      searchCodes: (q, set) => client.get("/api/kody/codes", { query: { q, set } }).then(r => r.results),
      smeQueue: (status = "open") => client.get("/api/kody/sme", { query: { status } }).then(r => r.items),
      resolveSme: (id, payload) => client.post(`/api/kody/sme/${id}/resolve`, payload),
    },

    /* ---- notifications ---- */
    // dAI: the extension's badge and bell read these (docs/PHASES.md 1.4c).
    // The list carries no message text unless the organisation opted in
    // (module rule 17, docs/11-notifications.md).
    notifications: {
      list: (unreadOnly = false, limit = 30) =>
        client.get("/api/notifications", { query: { unreadOnly, limit } }),
      unreadCount: async () => {
        const out = await client.get("/api/notifications", { query: { unreadOnly: true, limit: 1 } });
        return Number(out.unread || 0);
      },
      markRead: (ids) => client.put("/api/notifications/read", { ids }),
      markAllRead: () => client.put("/api/notifications/read-all"),
    },

    /* ---- files ---- */
    files: {
      async upload(conversationId, file, onProgress) {
        const form = new FormData();
        form.append("file", file);
        const out = await client.post(`/api/conversations/${conversationId}/files`, form);
        if (onProgress) onProgress(1);
        return out.file;
      },
      attach: (messageId, attachmentIds) =>
        client.post(`/api/messages/${messageId}/attachments`, { attachmentIds }),
      list: (conversationId, kind) =>
        client.get(`/api/conversations/${conversationId}/files`, { query: { kind } }),
      remove: (id) => client.del(`/api/files/${id}`),
      downloadUrl: (id) => `${client.baseUrl}/api/files/${id}/download`,
      async download(id) { return client.raw("GET", `/api/files/${id}/download`); },
    },
  };
}
