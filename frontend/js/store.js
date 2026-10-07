/* --------------------------------------------------------------------------
   Session store — current user, permissions, UI helpers.
   -------------------------------------------------------------------------- */

import { api } from "./api.js";

const state = {
  user: null,
  permissions: new Set(),
  role: null,
  currency: "₹",
};

const listeners = new Set();

export const store = {
  get user() {
    return state.user;
  },
  get role() {
    return state.role;
  },
  get currency() {
    return state.currency;
  },
  get isAuthed() {
    return Boolean(state.user);
  },

  setSession(user, permissions = []) {
    state.user = user;
    state.role = user?.role?.name || null;
    state.permissions = new Set(permissions);
    emit();
  },

  clear() {
    state.user = null;
    state.role = null;
    state.permissions = new Set();
    emit();
  },

  can(...required) {
    return required.every((key) => state.permissions.has(key));
  },

  canAny(...required) {
    return required.some((key) => state.permissions.has(key));
  },

  isRole(...roles) {
    return roles.includes(state.role);
  },

  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },

  async refresh() {
    const session = await api.get("/api/auth/me", { silent: true });
    if (session?.user) {
      state.user = session.user;
      state.role = session.user.role?.name || null;
      state.permissions = new Set(session.permissions || []);
    } else {
      state.user = null;
      state.permissions = new Set();
    }
    emit();
    return state.user;
  },
};

function emit() {
  listeners.forEach((fn) => {
    try {
      fn(state);
    } catch (error) {
      console.error("store listener failed", error);
    }
  });
}

/** Route guard used by the router. */
export function guard(routePermissions, mode = "all") {
  if (!state.user) return false;
  if (!routePermissions?.length) return true;
  return mode === "any"
    ? routePermissions.some((p) => state.permissions.has(p))
    : routePermissions.every((p) => state.permissions.has(p));
}
