import React, { useEffect, useMemo, useState, useCallback, createContext, useContext } from "react";
import JSZip from "jszip";
import { saveAs } from "file-saver";
import { Menu, X, SquareArrowOutUpRight } from "lucide-react";

/**
 * React + Tailwind auth flow + Orders pages with smooth animations
 * Endpoints used:
 *  - POST /auth/login { username, password }
 *  - POST /auth/logout (Authorization: Bearer <token>)
 *  - GET  /api/orders (Authorization)
 *  - GET  /api/orders/:id (Authorization)
 *  - GET  /api/export/orders (Authorization)
 *  - GET  /api/export/order-items (Authorization)
 *  - GET  /admin/invoice/tokens/:orderId (Authorization)
 *  - POST /admin/invoice/revoke/:token (Authorization)
 *  - GET  /admin/report?type=daily (Authorization)
 *  - GET  /api/search/orders (Authorization)
 *  - GET  /api/search/suggestions (Authorization)
 */

// -----------------------------
// Simple Router Implementation
// -----------------------------
const baseUrl = "https://example.workers.dev"; // e.g. "/app" if hosted under a sub-path
const siteName = "Your Brand Name or Shop Name"; // Site name to show in footer, etc.
const logoUrl = "https://example.com/logo.png"; // Logo URL for invoice links, etc.
const INVOICE_BASE = "https://invoice.example.com/?id=";

const RouterContext = createContext(null);

function useRouter() {
  const ctx = useContext(RouterContext);
  if (!ctx) throw new Error("useRouter must be used within <Router>");
  return ctx;
}

function Router({ children }) {
  const [currentRoute, setCurrentRoute] = useState("dashboard");
  const [routeParams, setRouteParams] = useState({});

  const navigate = useCallback((route, params = {}) => {
    setCurrentRoute(route);
    setRouteParams(params);
  }, []);

  const value = useMemo(() => ({
    currentRoute,
    routeParams,
    navigate
  }), [currentRoute, routeParams, navigate]);

  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}

// -----------------------------
// Storage helpers
// -----------------------------
const STORAGE_KEY = "auth"; // { token, user, expiresAt }

function getStoredAuth() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.expiresAt && Date.now() > parsed.expiresAt) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function setStoredAuth(auth) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(auth));
}

function clearStoredAuth() {
  localStorage.removeItem(STORAGE_KEY);
}

// -----------------------------
// Auth Context
// -----------------------------
const AuthContext = createContext(null);

function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>");
  return ctx;
}

function AuthProvider({ children }) {
  const [auth, setAuth] = useState(() => getStoredAuth());
  const isAuthed = !!auth?.token;

  const login = useCallback(async (username, password) => {
    const res = await fetch(
      `${baseUrl}/auth/login`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      }
    );

    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || `Login failed with status ${res.status}`);
    }

    const data = await res.json();
    if (!data?.success || !data?.token) {
      throw new Error("Invalid login response");
    }

    const expiresInSec = Number(data.expiresIn ?? 0);
    const expiresAt = expiresInSec > 0 ? Date.now() + expiresInSec * 1000 : undefined;

    const newAuth = { token: data.token, user: data.user ?? null, expiresAt };
    setStoredAuth(newAuth);
    setAuth(newAuth);
  }, []);

  const logout = useCallback(async () => {
    const token = auth?.token;
    try {
      if (token) {
        await fetch(
          `${baseUrl}/auth/logout`,
          {
            method: "POST",
            headers: { Authorization: `Bearer ${token}` },
          }
        );
      }
    } catch (e) {
      console.warn("Logout request failed:", e);
    } finally {
      clearStoredAuth();
      setAuth(null);
    }
  }, [auth?.token]);

  useEffect(() => {
    if (!auth?.expiresAt) return;
    const msLeft = auth.expiresAt - Date.now();
    if (msLeft <= 0) {
      logout();
      return;
    }
    const t = setTimeout(logout, msLeft);
    return () => clearTimeout(t);
  }, [auth?.expiresAt, logout]);

  const value = useMemo(() => ({ auth, isAuthed, login, logout }), [auth, isAuthed, login, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// -----------------------------
// API helpers (authorized requests)
// -----------------------------
function useApi() {
  const { auth } = useAuth();
  const base = baseUrl;

  const get = useCallback(async (path) => {
    const res = await fetch(base + path, {
      headers: { Authorization: `Bearer ${auth?.token}` },
    });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(txt || `GET ${path} failed: ${res.status}`);
    }
    return res.json();
  }, [auth?.token]);

  const post = useCallback(async (path, body) => {
    const res = await fetch(base + path, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${auth?.token}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(txt || `POST ${path} failed: ${res.status}`);
    }
    return res.json();
  }, [auth?.token]);

  return { get, post, base };
}

// -----------------------------
// UI: Login Page
// -----------------------------
function LoginPage() {
  const { isAuthed, login } = useAuth();
  const { navigate } = useRouter();

  useEffect(() => {
    if (isAuthed) navigate("dashboard");
  }, [isAuthed, navigate]);

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const onSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(username, password);
      navigate("dashboard");
    } catch (err) {
      setError(err?.message || "Login failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md animate-in fade-in duration-700">
        <div className="bg-white shadow-xl rounded-2xl p-8 transform transition-all duration-500 hover:shadow-2xl">
          <h1 className="text-2xl font-semibold text-gray-900">Welcome back</h1>
          <p className="mt-1 text-sm text-gray-600">Sign in to access your dashboard</p>

          {error ? (
            <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 animate-in slide-in-from-top-2 duration-300">
              {error}
            </div>
          ) : null}

          <form className="mt-6 space-y-4" onSubmit={onSubmit}>
            <div className="transform transition-all duration-200 focus-within:scale-[1.02]">
              <label className="block text-sm font-medium text-gray-700">Username</label>
              <input
                type="text"
                className="mt-1 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-gray-900 shadow-sm outline-none transition-all duration-200 focus:border-gray-900 focus:ring-1 focus:ring-gray-900 focus:shadow-md"
                placeholder="Enter username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                autoComplete="username"
              />
            </div>
            <div className="transform transition-all duration-200 focus-within:scale-[1.02]">
              <label className="block text-sm font-medium text-gray-700">Password</label>
              <input
                type="password"
                className="mt-1 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-gray-900 shadow-sm outline-none transition-all duration-200 focus:border-gray-900 focus:ring-1 focus:ring-gray-900 focus:shadow-md"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-xl bg-gray-900 px-4 py-2.5 text-white font-medium shadow transition-all duration-200 hover:opacity-95 hover:shadow-lg hover:scale-[1.02] disabled:opacity-60 disabled:scale-100 disabled:shadow"
            >
              {loading ? "Signing in…" : "Sign in"}
            </button>
          </form>

          <div className="mt-6 text-xs text-gray-500 animate-in fade-in duration-1000 delay-300">
            Tip: test with <code className="font-mono">admin / admin</code>
          </div>
        </div>
        <p className="mt-6 text-center text-xs text-gray-500 animate-in fade-in duration-1000 delay-500">
          © {new Date().getFullYear()} — {siteName}
        </p>
      </div>
    </div>
  );
}

// -----------------------------
// Navbar (shows on every page)
// -----------------------------

function Navbar() {
  const { auth, isAuthed, logout } = useAuth();
  const { navigate, currentRoute } = useRouter();
  const [isOpen, setIsOpen] = useState(false);

  const onLogout = async () => {
    await logout();
    navigate("login");
  };

  if (currentRoute === "login") return null;

  const NavButton = ({ route, label }) => (
    <button
      onClick={() => {
        navigate(route);
        setIsOpen(false); // close menu on mobile
      }}
      className={`w-full text-left px-3 py-2 rounded-lg transition-all duration-200 ${currentRoute === route
        ? "bg-gray-100 text-gray-900 font-medium"
        : "text-gray-700 hover:bg-gray-50 hover:text-gray-900"
        }`}
    >
      {label}
    </button>
  );

  return (
    <header className="border-b bg-white animate-in slide-in-from-top duration-500">
      <div className="mx-auto max-w-6xl px-4 py-4 flex items-center justify-between">
        {/* Logo + Dashboard */}
        <div className="flex items-center gap-3">
          
          <img onClick={() => navigate("dashboard")} className="h-10" src={logoUrl}></img>
          
        </div>

        {/* Desktop Nav */}
        <nav className="hidden md:flex items-center gap-4 text-sm">
          <NavButton route="dashboard" label="Home" />
          <NavButton route="orders" label="Orders" />
          <NavButton route="search" label="Search" />
          <NavButton route="blank" label="status" />
        </nav>

        {/* Right Section */}
        <div className="flex items-center gap-3">
          {isAuthed && auth?.user && (
            <div className="hidden md:block text-sm text-gray-700 animate-in slide-in-from-right duration-300">
              <div className="font-medium">{auth.user.username}</div>
              <div className="text-xs text-gray-500">
                role: {auth.user.role}
              </div>
            </div>
          )}

          {isAuthed ? (
            <button
              onClick={onLogout}
              className="hidden md:block rounded-xl border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-900 transition-all duration-200 hover:bg-gray-100 hover:scale-105 hover:shadow-md"
            >
              Log out
            </button>
          ) : (
            <button
              onClick={() => navigate("login")}
              className="hidden md:block rounded-xl bg-gray-900 px-3 py-1.5 text-sm font-medium text-white transition-all duration-200 hover:opacity-95 hover:scale-105 hover:shadow-md"
            >
              Sign in
            </button>
          )}

          {/* Mobile Hamburger */}
          <button
            className="md:hidden rounded-lg p-2 hover:bg-gray-100 transition"
            onClick={() => setIsOpen(!isOpen)}
          >
            {isOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
          </button>
        </div>
      </div>

      {/* Mobile Menu */}
      {isOpen && (
        <div className="md:hidden border-t bg-white px-4 py-4 space-y-2 animate-in fade-in duration-200">
          <NavButton route="dashboard" label="Home" />
          <NavButton route="orders" label="Orders" />
          <NavButton route="search" label="Search" />
          <NavButton route="blank" label="Status" />

          {isAuthed && auth?.user && (
            <div className="pt-3 border-t text-sm text-gray-700">
              <div className="font-medium">{auth.user.username}</div>
              <div className="text-xs text-gray-500">
                role: {auth.user.role}
              </div>
            </div>
          )}

          {isAuthed ? (
            <button
              onClick={onLogout}
              className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-900 transition-all duration-200 hover:bg-gray-100 hover:scale-105 hover:shadow-md"
            >
              Log out
            </button>
          ) : (
            <button
              onClick={() => navigate("login")}
              className="w-full rounded-xl bg-gray-900 px-3 py-2 text-sm font-medium text-white transition-all duration-200 hover:opacity-95 hover:scale-105 hover:shadow-md"
            >
              Sign in
            </button>
          )}
        </div>
      )}
    </header>
  );
}

// -----------------------------
// UI: Dashboard (protected)
// -----------------------------
function Dashboard() {
  const { get } = useApi();
  const { navigate } = useRouter();
  const [dailyReport, setDailyReport] = useState(null);
  const [stats, setStats] = useState(null);
  const [loadingStats, setLoadingStats] = useState(true);
  const [statsError, setStatsError] = useState("");
  const [reportLoading, setReportLoading] = useState(true);
  const [reportError, setReportError] = useState("");

  useEffect(() => {
    const loadDailyReport = async () => {
      try {
        setReportLoading(true);
        setReportError("");
        const data = await get("/admin/report?type=daily");
        setDailyReport(data?.report || null);
      } catch (e) {
        setReportError(e.message || "Failed to load daily report");
      } finally {
        setReportLoading(false);
      }
    };

    const fetchStats = async () => {
      try {
        setLoadingStats(true);
        setStatsError("");
        const data = await get("/api/stats?from_date=2024-01-01");
        setStats(data);
      } catch (e) {
        setStatsError(e.message || "Failed to fetch stats");
      } finally {
        setLoadingStats(false);
      }
    };

    loadDailyReport();
    fetchStats();
  }, [get]);

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount || 0);
  };

  const renderStatusBreakdown = (statusBreakdown) => {
    if (!statusBreakdown || Object.keys(statusBreakdown).length === 0) {
      return <div className="text-xs text-gray-500">No orders today</div>;
    }

    const total = Object.values(statusBreakdown).reduce((sum, count) => sum + count, 0);

    return (
      <div className="space-y-2">
        {Object.entries(statusBreakdown).map(([status, count]) => {
          const percentage = total > 0 ? Math.round((count / total) * 100) : 0;
          return (
            <div key={status} className="flex items-center justify-between text-xs">
              <span className="text-gray-600 capitalize">{status}</span>
              <div className="flex items-center gap-2">
                <div className="w-16 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gray-700 rounded-full transition-all duration-500"
                    style={{ width: `${percentage}%` }}
                  />
                </div>
                <span className="text-gray-900 font-medium min-w-[2rem] text-right">{count}</span>
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <main className="mx-auto max-w-6xl px-4 py-10">
        {/* Welcome Section */}
        <div className="mb-8 grid gap-6 md:grid-cols-2">
          <div className="rounded-2xl border bg-white p-6 shadow-sm animate-in slide-in-from-left duration-500 hover:shadow-md transition-shadow duration-200">
            <h2 className="text-sm font-semibold text-gray-900">Welcome</h2>
            <p className="mt-2 text-sm text-gray-700">You're logged in. Use the quick links to navigate around.</p>
          </div>
          <div className="rounded-2xl border bg-white p-6 shadow-sm animate-in slide-in-from-right duration-500 delay-100 hover:shadow-md transition-shadow duration-200">
            <h2 className="text-sm font-semibold text-gray-900">Quick Links</h2>
            <div className="mt-3 flex gap-2">
              <button
                onClick={() => navigate("orders")}
                className="rounded-xl bg-gray-900 px-3 py-2 text-white text-sm transition-all duration-200 hover:scale-105 hover:shadow-md inline-block"
              >
                View Orders
              </button>
              <SyncButton />
              <button
                onClick={() => navigate("search")}
                className="rounded-xl border border-gray-300 bg-white px-3 py-2 text-gray-900 text-sm transition-all duration-200 hover:scale-105 hover:shadow-md inline-block"
              >
                Search Orders
              </button>
            </div>
          </div>
        </div>

        {/* Stats Section */}
        <div className="mb-8">
          <h2 className="text-lg font-semibold text-gray-900 mb-4 animate-in slide-in-from-left duration-500 delay-200">
            Overall Stats
          </h2>
          {loadingStats ? (
            <div className="text-gray-600 animate-pulse">Loading stats…</div>
          ) : statsError ? (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 animate-in slide-in-from-top duration-300">
              {statsError}
            </div>
          ) : stats ? (
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-2xl border bg-white p-6 shadow-sm animate-in slide-in-from-left duration-500 delay-300 hover:shadow-md transition-shadow duration-200">
                <div className="text-xs text-gray-500 mb-1">Total Orders</div>
                <div className="text-2xl font-semibold text-gray-900">{stats.total_orders}</div>
              </div>
              <div className="rounded-2xl border bg-white p-6 shadow-sm animate-in slide-in-from-left duration-500 delay-400 hover:shadow-md transition-shadow duration-200">
                <div className="text-xs text-gray-500 mb-1">Total Customers</div>
                <div className="text-2xl font-semibold text-gray-900">{stats.total_customers}</div>
              </div>
              <div className="rounded-2xl border bg-white p-6 shadow-sm animate-in slide-in-from-right duration-500 delay-500 hover:shadow-md transition-shadow duration-200">
                <div className="text-xs text-gray-500 mb-1">Total Revenue</div>
                <div className="text-2xl font-semibold text-gray-900">{formatCurrency(stats.total_revenue)}</div>
              </div>
              <div className="rounded-2xl border bg-white p-6 shadow-sm animate-in slide-in-from-right duration-500 delay-600 hover:shadow-md transition-shadow duration-200">
                <div className="text-xs text-gray-500 mb-1">Avg Order Value</div>
                <div className="text-2xl font-semibold text-gray-900">{formatCurrency(stats.average_order_value)}</div>
              </div>
              <div className="rounded-2xl border bg-white p-6 shadow-sm md:col-span-2 lg:col-span-4 animate-in slide-in-from-bottom duration-500 delay-700 hover:shadow-md transition-shadow duration-200">
                <h3 className="text-sm font-semibold text-gray-900 mb-3">Orders by Status</h3>
                <ul className="space-y-2 text-sm text-gray-700">
                  {Object.entries(stats.orders_by_status).map(([status, count]) => (
                    <li key={status} className="flex justify-between">
                      <span className="capitalize">{status}</span>
                      <span className="font-medium">{count}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ) : (
            <div className="text-gray-600">No stats available</div>
          )}
        </div>

        {/* Daily Report Section */}
        <div className="mb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4 animate-in slide-in-from-left duration-500 delay-200">
            Today's Report
          </h2>
          {reportLoading ? (
            <div className="text-gray-600 animate-pulse">Loading daily report…</div>
          ) : reportError ? (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 animate-in slide-in-from-top duration-300">
              {reportError}
            </div>
          ) : dailyReport ? (
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
              {/* Orders Card */}
              <div className="rounded-2xl border bg-white p-6 shadow-sm animate-in slide-in-from-left duration-500 delay-300 hover:shadow-md transition-shadow duration-200">
                <div className="text-xs text-gray-500 mb-1">Total Orders</div>
                <div className="text-2xl font-semibold text-gray-900">{dailyReport.totalOrders}</div>
                <div className="text-xs text-gray-500 mt-1">{dailyReport.date}</div>
              </div>

              {/* Revenue Card */}
              <div className="rounded-2xl border bg-white p-6 shadow-sm animate-in slide-in-from-left duration-500 delay-400 hover:shadow-md transition-shadow duration-200">
                <div className="text-xs text-gray-500 mb-1">Total Revenue</div>
                <div className="text-2xl font-semibold text-gray-900">{formatCurrency(dailyReport.totalRevenue)}</div>
                <div className="text-xs text-gray-500 mt-1">Today's sales</div>
              </div>

              {/* Average Order Value Card */}
              <div className="rounded-2xl border bg-white p-6 shadow-sm animate-in slide-in-from-right duration-500 delay-500 hover:shadow-md transition-shadow duration-200">
                <div className="text-xs text-gray-500 mb-1">Avg Order Value</div>
                <div className="text-2xl font-semibold text-gray-900">{formatCurrency(dailyReport.averageOrderValue)}</div>
                <div className="text-xs text-gray-500 mt-1">Per order</div>
              </div>

              {/* Status Breakdown Card */}
              <div className="rounded-2xl border bg-white p-6 shadow-sm animate-in slide-in-from-right duration-500 delay-600 hover:shadow-md transition-shadow duration-200">
                <div className="text-xs text-gray-500 mb-3">Order Status</div>
                {renderStatusBreakdown(dailyReport.statusBreakdown)}
              </div>
            </div>
          ) : (
            <div className="text-gray-600">No daily report available</div>
          )}
        </div>

        {/* Sync Button Section */}

      </main>
    </div>
  );
}

// -----------------------------
// Orders list page
// -----------------------------
function OrdersPage() {
  const { get } = useApi();
  const { navigate } = useRouter();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [pagination, setPagination] = useState(null);

  // Filter states
  const [filters, setFilters] = useState({
    status: "",
    customer_id: "",
    from_date: "",
    to_date: "",
    sort: "desc"
  });
  const [showFilters, setShowFilters] = useState(false);

  const statusOptions = [
    { value: "", label: "All Statuses" },
    { value: "pending", label: "Pending" },
    { value: "processing", label: "Processing" },
    { value: "completed", label: "Completed" },
    { value: "cancelled", label: "Cancelled" },
    { value: "refunded", label: "Refunded" },
    { value: "checkout-draft", label: "Checkout Draft" },
    { value: "shipped", label: "Shipped" },
    { value: "delivered", label: "Delivered" },
    { value: "failed", label: "Failed" },
    { value: "draft", label: "Draft" }
  ];

  const load = useCallback(async (cursor = null, append = false) => {
    try {
      if (append) {
        setLoadingMore(true);
      }

      // Build query parameters
      const params = new URLSearchParams({ limit: "20" });

      // Add cursor if provided
      if (cursor) {
        params.append("cursor", cursor);
      }

      // Add filters
      Object.entries(filters).forEach(([key, value]) => {
        if (value && value.trim()) {
          params.append(key, value.trim());
        }
      });

      const path = `/api/orders?${params.toString()}`;
      const data = await get(path);

      // Handle response structure
      const list = Array.isArray(data) ? data : Array.isArray(data?.orders) ? data.orders : [];
      const paginationData = data?.pagination || null;

      setOrders((prev) => append ? [...prev, ...list] : list);
      setPagination(paginationData);

      if (!append) {
        setError("");
      }
    } catch (e) {
      setError(e.message);
      if (!append) {
        setOrders([]);
        setPagination(null);
      }
    } finally {
      if (append) {
        setLoadingMore(false);
      }
    }
  }, [get, filters]);

  // Handle filter changes and reload
  const applyFilters = useCallback(async () => {
    setLoading(true);
    setOrders([]);
    setPagination(null);
    try {
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [load]);

  // Reset filters
  const resetFilters = useCallback(() => {
    setFilters({
      status: "",
      customer_id: "",
      from_date: "",
      to_date: "",
      sort: "desc"
    });
  }, []);

  // Initial load
  useEffect(() => {
    applyFilters();
  }, []); // Only run on mount

  const loadMore = async () => {
    if (!pagination?.has_next || !pagination?.next_cursor || loadingMore) return;
    await load(pagination.next_cursor, true);
  };

  const exportOrders = async () => {
    try {
      const data = await get("/api/export/all"); // assuming this returns JSON object

      // Convert JSON to a Blob
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: "application/json",
      });

      // Create a temporary download link
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "orders.json"; // file name
      document.body.appendChild(a);
      a.click();

      // Clean up
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (e) {
      alert("Export failed: " + e.message);
    }
  };

  const { auth } = useAuth();
  const exportAllCSVs = async () => {
    try {
      // List of files to fetch
      const endpoints = [
        { name: "orders.csv", url: `${baseUrl}/api/export/orders?format=csv` },
        { name: "customers.csv", url: `${baseUrl}/api/export/customers?format=csv` },
        { name: "order-items.csv", url: `${baseUrl}/api/export/order-items?format=csv` },
      ];

      const zip = new JSZip();

      // Fetch all CSVs and add them to zip
      await Promise.all(
        endpoints.map(async ({ name, url }) => {
          const res = await fetch(url, {
            headers: { Authorization: `Bearer ${auth?.token}` },
          });
          if (!res.ok) throw new Error(`Failed to fetch ${name}`);
          const text = await res.text();
          zip.file(name, text);
        })
      );

      // Generate the zip and trigger download
      const blob = await zip.generateAsync({ type: "blob" });
      saveAs(blob, "exports.zip");
    } catch (e) {
      alert("Export failed: " + e.message);
    }
  };

  // Check if any filters are active
  const hasActiveFilters = Object.entries(filters).some(([key, value]) => {
    if (key === 'sort') return value !== 'desc'; // desc is default
    return value && value.trim();
  });

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-6xl px-4 py-8">
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between animate-in slide-in-from-top duration-500">
          {/* Title + pagination info */}
          <div>
            <h1 className="text-xl font-semibold text-gray-900">Orders</h1>
            {pagination && (
              <div className="mt-1 text-xs text-gray-500">
                {pagination.type === "cursor"
                  ? `Showing ${orders.length} orders · ${pagination.has_next ? "More available" : "End of results"
                  }`
                  : `Page ${pagination.page} of ${pagination.total_pages} · ${pagination.total} total orders`}
              </div>
            )}
          </div>

          {/* Buttons */}
          <div className="flex flex-col gap-2 sm:flex-row sm:gap-2">
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={`rounded-xl px-3 py-2 text-sm font-medium transition-all duration-200 hover:scale-105 hover:shadow-md ${hasActiveFilters
                ? "border border-gray-900 bg-gray-900 text-white"
                : "border border-gray-300 bg-white text-gray-900 hover:bg-gray-100"
                }`}
            >
              {hasActiveFilters ? "✓ Filtered" : "Filters"}
            </button>

            <button
              onClick={exportOrders}
              className="rounded-xl bg-gray-900 px-3 py-2 text-white text-sm transition-all duration-200 hover:scale-105 hover:shadow-md"
            >
              Export Orders (JSON)
            </button>

            <button
              onClick={exportAllCSVs}
              className="rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 transition-all duration-200 hover:bg-gray-100 hover:scale-105 hover:shadow-md"
            >
              Export All (CSV Zip)
            </button>
          </div>
        </div>


        {/* Filters Panel */}
        {showFilters && (
          <div className="mb-6 rounded-2xl border bg-white p-4 shadow-sm animate-in slide-in-from-top duration-300">
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Status</label>
                <select
                  value={filters.status}
                  onChange={(e) => setFilters(prev => ({ ...prev, status: e.target.value }))}
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition-all duration-200 focus:border-gray-900 focus:ring-1 focus:ring-gray-900"
                >
                  {statusOptions.map(option => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Customer ID</label>
                <input
                  type="text"
                  placeholder="e.g., 123"
                  value={filters.customer_id}
                  onChange={(e) => setFilters(prev => ({ ...prev, customer_id: e.target.value }))}
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition-all duration-200 focus:border-gray-900 focus:ring-1 focus:ring-gray-900"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">From Date</label>
                <input
                  type="date"
                  value={filters.from_date}
                  onChange={(e) => setFilters(prev => ({ ...prev, from_date: e.target.value }))}
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition-all duration-200 focus:border-gray-900 focus:ring-1 focus:ring-gray-900"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">To Date</label>
                <input
                  type="date"
                  value={filters.to_date}
                  onChange={(e) => setFilters(prev => ({ ...prev, to_date: e.target.value }))}
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition-all duration-200 focus:border-gray-900 focus:ring-1 focus:ring-gray-900"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Sort Order</label>
                <select
                  value={filters.sort}
                  onChange={(e) => setFilters(prev => ({ ...prev, sort: e.target.value }))}
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition-all duration-200 focus:border-gray-900 focus:ring-1 focus:ring-gray-900"
                >
                  <option value="desc">Newest First</option>
                  <option value="asc">Oldest First</option>
                </select>
              </div>
            </div>

            <div className="mt-4 flex gap-2 justify-end">
              <button
                onClick={resetFilters}
                className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 transition-all duration-200 hover:bg-gray-100 hover:scale-105"
              >
                Clear All
              </button>
              <button
                onClick={applyFilters}
                className="rounded-lg bg-gray-900 px-4 py-2 text-sm text-white transition-all duration-200 hover:scale-105 hover:shadow-md"
              >
                Apply Filters
              </button>
            </div>
          </div>
        )}

        {loading ? (
          <div className="text-gray-600 animate-pulse">Loading orders…</div>
        ) : error ? (
          <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 animate-in slide-in-from-top duration-300">{error}</div>
        ) : orders.length === 0 ? (
          <div className="rounded-2xl border bg-white p-12 text-center shadow-sm animate-in fade-in duration-500">
            <div className="text-gray-400 text-sm">
              {hasActiveFilters ? 'No orders match your filters' : 'No orders found'}
            </div>
            {hasActiveFilters && (
              <button
                onClick={resetFilters}
                className="mt-2 text-sm text-gray-600 hover:text-gray-900 underline"
              >
                Clear filters
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="overflow-hidden rounded-2xl border bg-white animate-in fade-in duration-500 delay-200">
              {/* Desktop Table */}
              <div className="hidden md:block">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">ID</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Customer</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Total</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Created</th>
                      <th className="px-4 py-3"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {orders.map((o, index) => {
                      const name = [o?.billing?.first_name, o?.billing?.last_name].filter(Boolean).join(" ") || "—";
                      const email = o?.billing?.email || "";
                      const total = typeof o.total === "number" ? o.total : Number(o.total ?? 0);
                      const currency = o.currency || "";
                      const created = o.created_at || o.date_created || o.raw?.date_created || null;

                      return (
                        <tr
                          key={o.id}
                          className="hover:bg-gray-50 transition-colors duration-150 animate-in slide-in-from-bottom duration-300 cursor-pointer"
                          style={{ animationDelay: `${index * 50}ms` }}
                          onClick={() => navigate("order-detail", { id: o.id })}
                        >
                          <td className="px-4 py-3 text-sm text-gray-900">#{o.id}</td>
                          <td className="px-4 py-3 text-sm text-gray-700">
                            {name}
                            {email ? <div className="text-xs text-gray-500">{email}</div> : null}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-900">
                            {total} {currency}
                          </td>
                          <td className="px-4 py-3 text-sm">
                            <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
                              {o.status}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-600">
                            {created ? new Date(created).toLocaleString() : "—"}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                navigate("order-detail", { id: o.id });
                              }}
                              className="text-sm transition-all duration-200 hover:scale-105 hover:shadow-md"
                            >
                              <SquareArrowOutUpRight className="h-6 w-6" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Mobile Cards */}
              <div className="block md:hidden divide-y divide-gray-200">
                {orders.map((o, index) => {
                  const name = [o?.billing?.first_name, o?.billing?.last_name].filter(Boolean).join(" ") || "—";
                  const email = o?.billing?.email || "";
                  const total = typeof o.total === "number" ? o.total : Number(o.total ?? 0);
                  const currency = o.currency || "";
                  const created = o.created_at || o.date_created || o.raw?.date_created || null;

                  return (
                    <div
                      key={o.id}
                      className="p-4 animate-in fade-in slide-in-from-bottom duration-300 cursor-pointer"
                      style={{ animationDelay: `${index * 50}ms` }}
                      onClick={() => navigate("order-detail", { id: o.id })}
                    >
                      <div className="flex justify-between items-center mb-2">
                        <span className="text-sm font-medium text-gray-900">#{o.id}</span>
                        <SquareArrowOutUpRight className="h-5 w-5 text-gray-600" />
                      </div>
                      <div className="text-sm text-gray-700">{name}</div>
                      {email ? <div className="text-xs text-gray-500 mb-1">{email}</div> : null}
                      <div className="text-sm text-gray-900">
                        {total} {currency}
                      </div>
                      <div className="mt-1">
                        <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
                          {o.status}
                        </span>
                      </div>
                      <div className="text-xs text-gray-600 mt-1">
                        {created ? new Date(created).toLocaleString() : "—"}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>



            {/* Load More Button for Cursor Pagination */}
            {pagination?.has_next && pagination?.next_cursor && (
              <div className="mt-6 flex justify-center animate-in fade-in duration-500">
                <button
                  onClick={loadMore}
                  disabled={loadingMore}
                  className="rounded-xl border border-gray-300 bg-white px-6 py-2.5 text-sm text-gray-900 transition-all duration-200 hover:bg-gray-100 hover:scale-105 hover:shadow-md disabled:opacity-60 disabled:scale-100 disabled:cursor-not-allowed"
                >
                  {loadingMore ? (
                    <div className="flex items-center gap-2">
                      <div className="w-4 h-4 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin"></div>
                      Loading more…
                    </div>
                  ) : (
                    `Load More Orders`
                  )}
                </button>
              </div>
            )}

            {/* Pagination Info */}
            {pagination && !pagination.has_next && (
              <div className="mt-6 text-center text-xs text-gray-500 animate-in fade-in duration-500">
                {pagination.type === 'cursor'
                  ? `Showing all ${orders.length} orders`
                  : `Showing ${orders.length} of ${pagination.total} orders`
                }
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// -----------------------------
// Search page
// -----------------------------
function SearchPage() {
  const { get } = useApi();
  const { navigate } = useRouter();
  const [query, setQuery] = useState("");
  const [searchType, setSearchType] = useState("general");
  const [results, setResults] = useState([]);
  const [suggestions, setSuggestions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [error, setError] = useState("");
  const [hasSearched, setHasSearched] = useState(false);
  const [pagination, setPagination] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);

  // Advanced filters
  const [advancedFilters, setAdvancedFilters] = useState({
    status: "",
    customer_id: "",
    from_date: "",
    to_date: "",
    sort: "desc"
  });
  const [showAdvanced, setShowAdvanced] = useState(false);

  const searchTypes = [
    { value: "general", label: "General Search", placeholder: "Search orders, customers, emails..." },
    { value: "email", label: "Email", placeholder: "Enter email address..." },
    { value: "phone", label: "Phone", placeholder: "Enter phone number..." },
    { value: "name", label: "Customer Name", placeholder: "Enter customer name..." },
    { value: "address", label: "Address", placeholder: "Enter address..." },
    { value: "order_id", label: "Order ID", placeholder: "Enter order ID..." },
    { value: "customer_id", label: "Customer ID", placeholder: "Enter customer ID..." },
    { value: "customer_ip", label: "Customer IP", placeholder: "Enter IP address..." }
  ];

  const statusOptions = [
    { value: "", label: "All Statuses" },
    { value: "pending", label: "Pending" },
    { value: "processing", label: "Processing" },
    { value: "completed", label: "Completed" },
    { value: "cancelled", label: "Cancelled" },
    { value: "refunded", label: "Refunded" },
    { value: "checkout-draft", label: "Checkout Draft" },
    { value: "shipped", label: "Shipped" },
    { value: "delivered", label: "Delivered" },
    { value: "failed", label: "Failed" },
    { value: "draft", label: "Draft" }
  ];

  // Debounced suggestions fetch
  useEffect(() => {
    if (!query.trim() || query.length < 2) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    const timer = setTimeout(async () => {
      try {
        setSuggestionsLoading(true);
        const params = new URLSearchParams({
          q: query.trim(),
          limit: "8"
        });

        if (searchType !== "general") {
          params.append("type", searchType);
        }

        const data = await get(`/api/search/suggestions?${params.toString()}`);
        setSuggestions(data?.suggestions || []);
        setShowSuggestions(true);
      } catch (e) {
        setSuggestions([]);
        setShowSuggestions(false);
      } finally {
        setSuggestionsLoading(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [query, searchType, get]);

  const performSearch = useCallback(async (cursor = null, append = false) => {
    if (!query.trim()) return;

    try {
      if (append) {
        setLoadingMore(true);
      } else {
        setLoading(true);
        setError("");
        setHasSearched(true);
        setShowSuggestions(false);
      }

      // Build search parameters
      const params = new URLSearchParams({
        limit: "20",
        sort: advancedFilters.sort
      });

      // Add cursor for pagination
      if (cursor) {
        params.append("cursor", cursor);
      }

      // Add search query based on type
      if (searchType === "general") {
        params.append("q", query.trim());
      } else {
        params.append(searchType, query.trim());
      }

      // Add advanced filters
      Object.entries(advancedFilters).forEach(([key, value]) => {
        if (value && value.trim() && key !== 'sort') {
          params.append(key, value.trim());
        }
      });

      const path = `/api/search/orders?${params.toString()}`;
      const data = await get(path);

      const list = Array.isArray(data) ? data : Array.isArray(data?.orders) ? data.orders : [];
      const paginationData = data?.pagination || null;

      setResults((prev) => append ? [...prev, ...list] : list);
      setPagination(paginationData);

    } catch (e) {
      setError(e.message);
      if (!append) {
        setResults([]);
        setPagination(null);
      }
    } finally {
      if (append) {
        setLoadingMore(false);
      } else {
        setLoading(false);
      }
    }
  }, [query, searchType, advancedFilters, get]);

  const handleSearch = (e) => {
    e.preventDefault();
    performSearch();
  };

  const handleSuggestionClick = (suggestion) => {
    setQuery(suggestion.value);
    setShowSuggestions(false);
    // Auto-search when clicking suggestion
    setTimeout(() => performSearch(), 100);
  };

  const loadMore = async () => {
    if (!pagination?.has_next || !pagination?.next_cursor || loadingMore) return;
    await performSearch(pagination.next_cursor, true);
  };

  const clearSearch = () => {
    setQuery("");
    setResults([]);
    setSuggestions([]);
    setError("");
    setHasSearched(false);
    setPagination(null);
    setShowSuggestions(false);
    setAdvancedFilters({
      status: "",
      customer_id: "",
      from_date: "",
      to_date: "",
      sort: "desc"
    });
  };

  const currentSearchType = searchTypes.find(t => t.value === searchType);

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-6xl px-4 py-8">
        <div className="mb-6 animate-in slide-in-from-top duration-500">
          <h1 className="text-xl font-semibold text-gray-900">Search Orders</h1>
          <p className="mt-1 text-sm text-gray-600">Find orders by customer details, order information, or any keyword</p>
        </div>

        {/* Search Form */}
        <div className="mb-6 rounded-2xl border bg-white p-4 md:p-6 shadow-sm animate-in slide-in-from-top duration-500 delay-100">
          <form onSubmit={handleSearch} className="space-y-4">
            {/* Search Type and Query */}
            <div className="grid gap-4 md:grid-cols-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Search Type</label>
                <select
                  value={searchType}
                  onChange={(e) => setSearchType(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition-all duration-200 focus:border-gray-900 focus:ring-1 focus:ring-gray-900"
                >
                  {searchTypes.map(type => (
                    <option key={type.value} value={type.value}>{type.label}</option>
                  ))}
                </select>
              </div>

              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-2">Search Query</label>
                <div className="relative">
                  <input
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={currentSearchType?.placeholder || "Enter search term..."}
                    className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 pr-10 text-sm text-gray-900 outline-none transition-all duration-200 focus:border-gray-900 focus:ring-1 focus:ring-gray-900"
                    onFocus={() => setShowSuggestions(suggestions.length > 0)}
                    onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
                  />
                  {query && (
                    <button
                      type="button"
                      onClick={clearSearch}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors duration-200"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Advanced Filters Toggle & Actions */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <button
                type="button"
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="text-sm text-gray-600 hover:text-gray-900 transition-colors duration-200 text-left"
              >
                {showAdvanced ? 'Hide Advanced Filters' : 'Show Advanced Filters'}
              </button>

              <div className="flex flex-col sm:flex-row gap-2">
                <button
                  type="button"
                  onClick={clearSearch}
                  className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-900 transition-all duration-200 hover:bg-gray-100 hover:scale-105"
                >
                  Clear
                </button>
                <button
                  type="submit"
                  disabled={loading || !query.trim()}
                  className="rounded-lg bg-gray-900 px-6 py-2 text-sm text-white transition-all duration-200 hover:scale-105 hover:shadow-md disabled:opacity-60 disabled:scale-100"
                >
                  {loading ? 'Searching...' : 'Search'}
                </button>
              </div>
            </div>

            {/* Advanced Filters */}
            {showAdvanced && (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 pt-4 border-t border-gray-200 animate-in slide-in-from-top duration-300">
                {/* Each field stacks naturally on mobile */}
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Status</label>
                  <select
                    value={advancedFilters.status}
                    onChange={(e) => setAdvancedFilters(prev => ({ ...prev, status: e.target.value }))}
                    className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition-all duration-200 focus:border-gray-900 focus:ring-1 focus:ring-gray-900"
                  >
                    {statusOptions.map(option => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Customer ID</label>
                  <input
                    type="text"
                    placeholder="e.g., 123"
                    value={advancedFilters.customer_id}
                    onChange={(e) => setAdvancedFilters(prev => ({ ...prev, customer_id: e.target.value }))}
                    className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition-all duration-200 focus:border-gray-900 focus:ring-1 focus:ring-gray-900"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">From Date</label>
                  <input
                    type="date"
                    value={advancedFilters.from_date}
                    onChange={(e) => setAdvancedFilters(prev => ({ ...prev, from_date: e.target.value }))}
                    className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition-all duration-200 focus:border-gray-900 focus:ring-1 focus:ring-gray-900"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">To Date</label>
                  <input
                    type="date"
                    value={advancedFilters.to_date}
                    onChange={(e) => setAdvancedFilters(prev => ({ ...prev, to_date: e.target.value }))}
                    className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition-all duration-200 focus:border-gray-900 focus:ring-1 focus:ring-gray-900"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Sort Order</label>
                  <select
                    value={advancedFilters.sort}
                    onChange={(e) => setAdvancedFilters(prev => ({ ...prev, sort: e.target.value }))}
                    className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition-all duration-200 focus:border-gray-900 focus:ring-1 focus:ring-gray-900"
                  >
                    <option value="desc">Newest First</option>
                    <option value="asc">Oldest First</option>
                  </select>
                </div>
              </div>
            )}
          </form>
        </div>


        {/* Search Results */}
        {loading ? (
          <div className="text-gray-600 animate-pulse">Searching...</div>
        ) : error ? (
          <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 animate-in slide-in-from-top duration-300">{error}</div>
        ) : hasSearched && results.length === 0 ? (
          <div className="rounded-2xl border bg-white p-12 text-center shadow-sm animate-in fade-in duration-500">
            <div className="text-gray-400 text-sm mb-2">No results found for "{query}"</div>
            <div className="text-gray-500 text-xs">Try adjusting your search terms or filters</div>
          </div>
        ) : results.length > 0 ? (
          <>
            {/* Results Header */}
            <div className="mb-4 flex items-center justify-between text-sm text-gray-600 animate-in slide-in-from-top duration-500 delay-200">
              <div>
                Found {results.length} results for "{query}"
                {pagination && (
                  <span className="ml-2">
                    {pagination.type === 'cursor'
                      ? `• ${pagination.has_next ? 'More available' : 'End of results'}`
                      : `• Page ${pagination.page} of ${pagination.total_pages}`
                    }
                  </span>
                )}
              </div>
            </div>

            {/* Results Table */}
            <div className="overflow-hidden rounded-2xl border bg-white animate-in fade-in duration-500 delay-300">
              {/* Desktop Table */}
              <div className="hidden md:block">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">ID</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Customer</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Total</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Created</th>
                      <th className="px-4 py-3"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {results.map((order, index) => {
                      const name = [order?.billing?.first_name, order?.billing?.last_name].filter(Boolean).join(" ") || "—";
                      const email = order?.billing?.email || "";
                      const total = typeof order.total === "number" ? order.total : Number(order.total ?? 0);
                      const currency = order.currency || "";
                      const created = order.created_at || order.date_created || order.raw?.date_created || null;

                      return (
                        <tr
                          key={order.id}
                          className="hover:bg-gray-50 transition-colors duration-150 animate-in slide-in-from-bottom duration-300"
                          style={{ animationDelay: `${index * 50}ms` }}
                        >
                          <td className="px-4 py-3 text-sm text-gray-900">#{order.id}</td>
                          <td className="px-4 py-3 text-sm text-gray-700">
                            {name}
                            {email ? <div className="text-xs text-gray-500">{email}</div> : null}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-900">
                            {total} {currency}
                          </td>
                          <td className="px-4 py-3 text-sm">
                            <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
                              {order.status}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-600">
                            {created ? new Date(created).toLocaleString() : "—"}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <button
                              onClick={() => navigate("order-detail", { id: order.id })}
                              className="rounded-lg bg-gray-900 px-3 py-1.5 text-white text-sm transition-all duration-200 hover:scale-105 hover:shadow-md"
                            >
                              View
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Mobile Cards */}
              <div className="block md:hidden divide-y divide-gray-200">
                {results.map((order, index) => {
                  const name = [order?.billing?.first_name, order?.billing?.last_name].filter(Boolean).join(" ") || "—";
                  const email = order?.billing?.email || "";
                  const total = typeof order.total === "number" ? order.total : Number(order.total ?? 0);
                  const currency = order.currency || "";
                  const created = order.created_at || order.date_created || order.raw?.date_created || null;

                  return (
                    <div
                      key={order.id}
                      className="p-4 animate-in fade-in slide-in-from-bottom duration-300"
                      style={{ animationDelay: `${index * 50}ms` }}
                    >
                      <div className="flex justify-between items-center mb-2">
                        <span className="text-sm font-medium text-gray-900">#{order.id}</span>
                        <button
                          onClick={() => navigate("order-detail", { id: order.id })}
                          className="rounded-lg bg-gray-900 px-3 py-1.5 text-white text-xs transition-all duration-200 hover:scale-105 hover:shadow-md"
                        >
                          View
                        </button>
                      </div>
                      <div className="text-sm text-gray-700">{name}</div>
                      {email ? <div className="text-xs text-gray-500 mb-1">{email}</div> : null}
                      <div className="text-sm text-gray-900">
                        {total} {currency}
                      </div>
                      <div className="mt-1">
                        <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
                          {order.status}
                        </span>
                      </div>
                      <div className="text-xs text-gray-600 mt-1">
                        {created ? new Date(created).toLocaleString() : "—"}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>


            {/* Load More Button */}
            {pagination?.has_next && pagination?.next_cursor && (
              <div className="mt-6 flex justify-center animate-in fade-in duration-500">
                <button
                  onClick={loadMore}
                  disabled={loadingMore}
                  className="rounded-xl border border-gray-300 bg-white px-6 py-2.5 text-sm text-gray-900 transition-all duration-200 hover:bg-gray-100 hover:scale-105 hover:shadow-md disabled:opacity-60 disabled:scale-100 disabled:cursor-not-allowed"
                >
                  {loadingMore ? (
                    <div className="flex items-center gap-2">
                      <div className="w-4 h-4 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin"></div>
                      Loading more...
                    </div>
                  ) : (
                    `Load More Results`
                  )}
                </button>
              </div>
            )}
          </>
        ) : null}

        {/* Quick Search Examples */}
        {!hasSearched && (
          <div className="mt-8 rounded-2xl border bg-white p-6 shadow-sm animate-in slide-in-from-bottom duration-500 delay-400">
            <h3 className="text-sm font-semibold text-gray-900 mb-3">Quick Search Examples</h3>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <button
                onClick={() => {
                  setSearchType("email");
                  setQuery("john@example.com");
                }}
                className="text-left p-3 rounded-lg border border-gray-200 hover:border-gray-300 hover:bg-gray-50 transition-all duration-200"
              >
                <div className="text-sm text-gray-900">Search by Name</div>
                <div className="text-xs text-gray-500 mt-1">John Smith</div>
              </button>

              <button
                onClick={() => {
                  setSearchType("order_id");
                  setQuery("12345");
                }}
                className="text-left p-3 rounded-lg border border-gray-200 hover:border-gray-300 hover:bg-gray-50 transition-all duration-200"
              >
                <div className="text-sm text-gray-900">Search by Order ID</div>
                <div className="text-xs text-gray-500 mt-1">#12345</div>
              </button>

              <button
                onClick={() => {
                  setSearchType("address");
                  setQuery("Main Street");
                }}
                className="text-left p-3 rounded-lg border border-gray-200 hover:border-gray-300 hover:bg-gray-50 transition-all duration-200"
              >
                <div className="text-sm text-gray-900">Search by Address</div>
                <div className="text-xs text-gray-500 mt-1">Main Street</div>
              </button>

              <button
                onClick={() => {
                  setSearchType("general");
                  setQuery("processing");
                }}
                className="text-left p-3 rounded-lg border border-gray-200 hover:border-gray-300 hover:bg-gray-50 transition-all duration-200"
              >
                <div className="text-sm text-gray-900">General Search</div>
                <div className="text-xs text-gray-500 mt-1">processing orders</div>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// -----------------------------
// Single order page
// -----------------------------
function OrderDetailPage() {
  const { get, post } = useApi();
  const { routeParams, navigate } = useRouter();
  const id = routeParams.id;
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Invoice tokens state
  const [tokensData, setTokensData] = useState(null); // { order_id, tokens: [], total_tokens, active_tokens }
  const [tokensError, setTokensError] = useState("");
  const [generating, setGenerating] = useState(false);
  const [lastGenerated, setLastGenerated] = useState(null); // response from /admin/invoice/generate

  const [copied, setCopied] = useState(false);
  const [showJson, setShowJson] = useState(false);


  const copy = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch (e) {
      alert("Copy failed: " + (e?.message || e));
    }
  };

  useEffect(() => {
    (async () => {
      try {
        const data = await get(`/api/orders/${id}`);
        if (data?.error) {
          setError(String(data.error));
          setOrder(null);
        } else {
          setOrder(data);
        }
      } catch (e) {
        setError(e.message || "Failed to load order");
      } finally {
        setLoading(false);
      }
    })();
  }, [get, id]);

  const refreshTokens = async () => {
    try {
      setTokensError("");
      const data = await get(`/admin/invoice/tokens/${id}`);
      setTokensData(data);
    } catch (e) {
      setTokensError(e.message || "Failed to load invoice tokens");
    }
  };

  useEffect(() => {
    refreshTokens();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const generateToken = async () => {
    try {
      setGenerating(true);
      setTokensError("");
      const resp = await post(`/admin/invoice/generate`, { order_id: Number(id), expires_in: 604800 });
      setLastGenerated(resp);
      // Optimistically prepend new token to the list
      setTokensData((prev) => {
        const newEntry = {
          token: resp?.invoice_token,
          created_at: resp?.created_at,
          expires_at: resp?.expires_at,
          is_active: true,
          access_count: 0,
          last_accessed_at: null,
        };
        if (!prev) {
          return { order_id: Number(id), tokens: [newEntry], total_tokens: 1, active_tokens: 1 };
        }
        return {
          ...prev,
          tokens: [newEntry, ...(prev.tokens || [])],
          total_tokens: (prev.total_tokens ?? 0) + 1,
          active_tokens: (prev.active_tokens ?? 0) + 1,
        };
      });
    } catch (e) {
      setTokensError(e.message || "Failed to generate invoice token");
    } finally {
      setGenerating(false);
    }
  };

  const revokeToken = async (token) => {
    if (!confirm(`Are you sure you want to revoke token ${token}?`)) return;

    try {
      setTokensError("");
      const resp = await post(`/admin/invoice/revoke/${token}`);

      if (resp?.success) {
        // Update the token in the list to inactive
        setTokensData((prev) => {
          if (!prev) return prev;
          const updatedTokens = prev.tokens.map((t) =>
            t.token === token
              ? { ...t, is_active: false, revoked_at: resp.revoked_at, revoked_by: resp.revoked_by }
              : t
          );
          return {
            ...prev,
            tokens: updatedTokens,
            active_tokens: Math.max((prev.active_tokens ?? 0) - 1, 0),
          };
        });
      }
    } catch (e) {
      setTokensError(e.message || "Failed to revoke token");
    }
  };

  const copyJson = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(order, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (e) {
      alert("Copy failed: " + (e?.message || e));
    }
  };

  const currencySym = (order?.raw?.currency_symbol || order?.currency || "").trim();
  const created = order?.created_at || order?.date_created || order?.raw?.date_created || null;

  // Normalize items from either shape
  const items = (order?.items && Array.isArray(order.items))
    ? order.items.map((it) => {
      const rawMatch = Array.isArray(order?.raw?.line_items)
        ? order.raw.line_items.find((li) => Number(li.id) === Number(it.id))
        : null;
      const imageSrc = it?.image?.src || rawMatch?.image?.src || "";
      return {
        id: it.id,
        name: it.name,
        quantity: it.quantity,
        total: typeof it.total === "number" ? it.total : Number(it.total ?? 0),
        subtotal: typeof it.subtotal === "number" ? it.subtotal : Number(it.subtotal ?? 0),
        price: typeof it.price === "number" ? it.price : Number(it.price ?? 0),
        meta: Array.isArray(it.meta) ? it.meta : [],
        imageSrc,
      };
    })
    : Array.isArray(order?.raw?.line_items)
      ? order.raw.line_items.map((li) => ({
        id: li.id,
        name: li.name,
        quantity: li.quantity,
        total: typeof li.total === "number" ? li.total : Number(li.total ?? 0),
        subtotal: typeof li.subtotal === "number" ? li.subtotal : Number(li.subtotal ?? 0),
        price: typeof li.price === "number" ? li.price : Number(li.price ?? 0),
        meta: Array.isArray(li.meta_data)
          ? li.meta_data.map((m) => ({ id: m.id, key: m.display_key || m.key, value: m.display_value || m.value }))
          : [],
        imageSrc: li?.image?.src || "",
      }))
      : [];

  if (loading) return <div className="p-6 animate-pulse">Loading…</div>;
  if (error)
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="mx-auto max-w-5xl px-4 py-8">
          <button onClick={() => navigate("orders")} className="mb-4 text-sm text-gray-700 hover:text-gray-900 transition-colors duration-200 hover:scale-105">
            ← Back
          </button>
          <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 animate-in slide-in-from-top duration-300">{error}</div>
        </div>
      </div>
    );
  if (!order) return <div className="p-6">Not found</div>;

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-5xl px-4 py-8">
        <button onClick={() => navigate("orders")} className="mb-4 text-sm text-gray-700 hover:text-gray-900 transition-all duration-200 hover:scale-105 animate-in slide-in-from-left duration-300">
          ← Back
        </button>
        <div className="mb-6 flex items-center justify-between animate-in slide-in-from-top duration-500">
          <h1 className="text-xl font-semibold text-gray-900">Order #{order.id}</h1>
          <div className="flex gap-2">
            <button onClick={generateToken} disabled={generating} className="rounded-xl bg-gray-900 px-3 py-2 text-white text-sm disabled:opacity-60 transition-all duration-200 hover:scale-105 hover:shadow-md disabled:scale-100">
              {generating ? "Generating…" : "Generate Invoice Token"}
            </button>
            <button onClick={refreshTokens} className="rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 transition-all duration-200 hover:bg-gray-100 hover:scale-105 hover:shadow-md">
              Refresh Tokens
            </button>
            {order?.raw?.payment_url ? (
              <a
                href={order.raw.payment_url}
                target="_blank"
                rel="noreferrer"
                className="rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 transition-all duration-200 hover:bg-gray-100 hover:scale-105 hover:shadow-md"
              >
                Payment Link
              </a>
            ) : null}
          </div>
        </div>

        {/* Customer environment on top */}
        <div className="mb-6 rounded-2xl border bg-white p-4 shadow-sm animate-in slide-in-from-left duration-500 hover:shadow-md transition-shadow duration-200">
          <div className="text-sm font-semibold text-gray-900">Customer Environment</div>
          <dl className="mt-2 grid gap-2 text-xs sm:grid-cols-2">
            <div className="flex items-start gap-2">
              <dt className="text-gray-500 min-w-[6rem]">IP</dt>
              <dd className="text-red-500 break-all">{order?.raw?.customer_ip_address || "—"}</dd>
            </div>
            <div className="flex items-start gap-2 sm:col-span-2">
              <dt className="text-gray-500 min-w-[6rem]">User Agent</dt>
              <dd className="text-gray-900 overflow-x-auto">
                <code className="block whitespace-pre-wrap break-words">{order?.raw?.customer_user_agent || "—"}</code>
              </dd>
            </div>
          </dl>
        </div>

        {/* Summary + Billing/Shipping + Items */}
        <div className="grid gap-6 md:grid-cols-2">
          <div className="rounded-2xl border bg-white p-6 shadow-sm md:col-span-2 animate-in slide-in-from-top duration-500 delay-100 hover:shadow-md transition-shadow duration-200">
            <h2 className="text-sm font-semibold text-gray-900">Summary</h2>
            <dl className="mt-3 space-y-1 text-sm">
              <div className="flex justify-between">
                <dt className="text-gray-600">Status</dt>
                <dd className="text-gray-900">{order.status}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-600">Subtotal</dt>
                <dd className="text-gray-900">{order.subtotal} {currencySym}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-600">Shipping</dt>
                <dd className="text-gray-900">{order.shipping_total} {currencySym}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-600">Discount</dt>
                <dd className="text-gray-900">{order.discount_total} {currencySym}</dd>
              </div>
              <hr className="text-slate-300 break-all" />
              <div className="flex justify-between font-medium">
                <dt className="text-gray-700">Total</dt>
                <dd className="text-blue-400 text-2xl">{order.total} {currencySym}</dd>
              </div>
              <div className="flex justify-between mt-4">
                <dt className="text-gray-600">Payment</dt>
                <dd className="text-gray-900">{order.payment_method}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-600">Created</dt>
                <dd className="text-gray-900">{created ? new Date(created).toLocaleString() : "—"}</dd>
              </div>
            </dl>
          </div>

          <div className="rounded-2xl border bg-white p-6 shadow-sm animate-in slide-in-from-left duration-500 delay-200 hover:shadow-md transition-shadow duration-200">
            <h2 className="text-sm font-semibold text-gray-900">Billing</h2>
            <div className="mt-2 text-sm text-gray-700">
              {order.billing.first_name} {order.billing.last_name}
              {order.billing.email ? <div className="text-xs text-gray-500">{order.billing.email}</div> : null}
              {order.billing.phone ? <div className="text-xs text-gray-500">{order.billing.phone}</div> : null}
              {order.billing.address_1 ? <div className="text-xs text-gray-500">{order.billing.address_1}</div> : null}
              {order.billing.city ? <div className="text-xs text-gray-500">{order.billing.city}</div> : null}
            </div>
          </div>

          <div className="rounded-2xl border bg-white p-6 shadow-sm animate-in slide-in-from-right duration-500 delay-300 hover:shadow-md transition-shadow duration-200">
            <h2 className="text-sm font-semibold text-gray-900">Shipping</h2>
            <div className="mt-2 text-sm text-gray-700">
              {order.shipping.first_name} {order.shipping.last_name}
              {order.shipping.email ? <div className="text-xs text-gray-500">{order.shipping.email}</div> : null}
              {order.shipping.phone ? <div className="text-xs text-gray-500">{order.shipping.phone}</div> : null}
              {order.shipping.address_1 ? <div className="text-xs text-gray-500">{order.shipping.address_1}</div> : null}
              {order.shipping.city ? <div className="text-xs text-gray-500">{order.shipping.city}</div> : null}
            </div>
          </div>

          <div className="rounded-2xl border bg-white p-6 shadow-sm md:col-span-2 animate-in slide-in-from-bottom duration-500 delay-400 hover:shadow-md transition-shadow duration-200">
            <h2 className="text-sm font-semibold text-gray-900">Items</h2>
            {items.length ? (
              <ul className="mt-2 divide-y">
                {items.map((it, index) => (
                  <li key={it.id} className="py-3 animate-in slide-in-from-left duration-300" style={{ animationDelay: `${400 + index * 100}ms` }}>
                    <div className="flex items-center gap-4">
                      {it.imageSrc ? (
                        <img src={it.imageSrc} alt={it.name} className="h-14 w-14 rounded-lg object-cover bg-gray-100 transition-transform duration-200 hover:scale-110" />
                      ) : (
                        <div className="h-14 w-14 rounded-lg bg-gray-100 transition-colors duration-200 hover:bg-gray-200" />)
                      }
                      <div className="flex-1">
                        <div className="flex items-center justify-between text-sm">
                          <div className="text-gray-900 font-medium">{it.name}</div>
                          <div className="text-gray-600">Qty: {it.quantity}</div>
                          <div className="text-gray-900">{it.total} {currencySym}</div>
                        </div>
                        {it.meta?.length ? (
                          <div className="mt-2 flex flex-wrap gap-2">
                            {it.meta.map((m) => (
                              <span key={m.id} className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-700 transition-colors duration-200 hover:bg-gray-200">
                                {(m.display_key || m.key || "").toString()}: {(m.display_value || m.value || "").toString()}
                              </span>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="mt-2 text-sm text-gray-600">No items</div>
            )}
          </div>

          {order?.raw?.customer_note ? (
            <div className="rounded-2xl border bg-white p-6 shadow-sm md:col-span-2 animate-in slide-in-from-bottom duration-500 delay-500 hover:shadow-md transition-shadow duration-200">
              <h2 className="text-sm font-semibold text-gray-900">Customer Note</h2>
              <p className="mt-2 text-sm text-gray-700 whitespace-pre-wrap">{order.raw.customer_note}</p>
            </div>
          ) : null}
        </div>

        {/* Invoice tokens panel */}
        <div className="mt-6 rounded-2xl border bg-white p-4 shadow-sm animate-in slide-in-from-bottom duration-500 delay-600 hover:shadow-md transition-shadow duration-200">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold text-gray-900">Invoice Tokens</div>
              <div className="mt-1 text-xs text-gray-500">
                Total: {tokensData?.total_tokens ?? 0} · Active: {tokensData?.active_tokens ?? 0}
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={generateToken} disabled={generating} className="rounded-xl bg-gray-900 px-3 py-2 text-white text-sm disabled:opacity-60 transition-all duration-200 hover:scale-105 hover:shadow-md disabled:scale-100">
                {generating ? "Generating…" : "Generate New Token"}
              </button>
              <button onClick={refreshTokens} className="rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 transition-all duration-200 hover:bg-gray-100 hover:scale-105 hover:shadow-md">Refresh</button>
            </div>
          </div>

          {tokensError ? (
            <div className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-700 animate-in slide-in-from-top duration-300">{tokensError}</div>
          ) : null}

          {lastGenerated?.invoice_token ? (
            <div className="mt-3 rounded-md border border-green-200 bg-green-50 p-3 text-xs text-green-800 animate-in slide-in-from-top duration-300">
              New token: <span className="font-mono">{lastGenerated.invoice_token}</span> ·
              <button onClick={() => copy(INVOICE_BASE + lastGenerated.invoice_token)} className="ml-2 underline transition-colors duration-200 hover:text-green-900">Copy link</button>
              <a href={INVOICE_BASE + lastGenerated.invoice_token} target="_blank" rel="noreferrer" className="ml-2 underline transition-colors duration-200 hover:text-green-900">Open</a>
            </div>
          ) : null}

          {tokensData?.tokens?.length ? (
            <ul className="mt-3 divide-y">
              {tokensData.tokens.map((t, index) => (
                <li key={t.token} className="py-3 animate-in slide-in-from-left duration-300" style={{ animationDelay: `${700 + index * 50}ms` }}>
                  <div className="flex flex-wrap items-center gap-3 justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 text-sm">
                        <span className="font-mono text-gray-900">{t.token}</span>
                        {t.is_active ? (
                          <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-[11px] text-green-800">active</span>
                        ) : (
                          <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-700">inactive</span>
                        )}
                        <span className="text-xs text-gray-500">accesses: {t.access_count ?? 0}</span>
                      </div>
                      <div className="mt-1 text-xs text-gray-500">
                        Created: {t.created_at ? new Date(t.created_at).toLocaleString() : "—"} · Expires: {t.expires_at ? new Date(t.expires_at).toLocaleString() : "—"}
                        {t.revoked_at ? ` · Revoked: ${new Date(t.revoked_at).toLocaleString()}${t.revoked_by ? ` by ${t.revoked_by}` : ""}` : ""}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <a
                        href={INVOICE_BASE + encodeURIComponent(t.token)}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-lg bg-gray-900 px-3 py-1.5 text-xs text-white transition-all duration-200 hover:scale-105 hover:shadow-md disabled:opacity-50"
                        style={{ pointerEvents: t.is_active ? 'auto' : 'none', opacity: t.is_active ? 1 : 0.5 }}
                      >
                        Open Invoice
                      </a>
                      <button
                        onClick={() => copy(INVOICE_BASE + t.token)}
                        className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs text-gray-900 transition-all duration-200 hover:bg-gray-100 hover:scale-105 hover:shadow-md"
                      >
                        Copy Link
                      </button>
                      <button
                        onClick={() => copy(t.token)}
                        className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs text-gray-900 transition-all duration-200 hover:bg-gray-100 hover:scale-105 hover:shadow-md"
                      >
                        Copy Token
                      </button>
                      {t.is_active ? (
                        <button
                          onClick={() => revokeToken(t.token)}
                          className="rounded-lg border border-red-300 bg-white px-3 py-1.5 text-xs text-red-700 transition-all duration-200 hover:bg-red-50 hover:scale-105 hover:shadow-md"
                        >
                          Revoke
                        </button>
                      ) : (
                        <span className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs text-gray-400">
                          Revoked
                        </span>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="mt-3 text-sm text-gray-600">No tokens yet.</div>
          )}

          {copied ? <div className="mt-3 text-xs text-gray-500 animate-in fade-in duration-300">Copied!</div> : null}
        </div>

        {/* Full JSON (toggle) */}
        <div className="mt-6 animate-in slide-in-from-bottom duration-500 delay-700">
          <button
            onClick={() => setShowJson((v) => !v)}
            className="rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 transition-all duration-200 hover:bg-gray-100 hover:scale-105 hover:shadow-md"
          >
            {showJson ? "Hide Full Response JSON" : "Show Full Response JSON"}
          </button>
          {showJson ? (
            <div className="mt-3 rounded-2xl border bg-white p-4 shadow-sm animate-in slide-in-from-top duration-300">
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold text-gray-900">Full Response JSON</div>
                <button onClick={copyJson} className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs text-gray-900 transition-all duration-200 hover:bg-gray-100 hover:scale-105 hover:shadow-md">
                  {copied ? "Copied!" : "Copy JSON"}
                </button>
              </div>
              <pre className="mt-2 max-h-[65vh] overflow-auto rounded-lg bg-gray-900 p-4 text-xs text-gray-100">{JSON.stringify(order, null, 2)}</pre>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// -----------------------------
// Blank Page (protected)
// -----------------------------
function BlankPage() {
  const { get } = useApi();
  const [wooStatus, setWooStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const fetchWooStatus = async () => {
      try {
        setLoading(true);
        setError("");
        const data = await get("/admin/woo-status");
        setWooStatus(data?.summary || null);
      } catch (e) {
        setError(e.message || "Failed to fetch WooCommerce status");
      } finally {
        setLoading(false);
      }
    };

    fetchWooStatus();
  }, [get]);

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center">Loading WooCommerce status...</div>;
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-red-600">{error}</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="p-6 bg-white rounded-lg shadow-md">
        <h1 className="text-2xl font-semibold text-gray-900 mb-4">WooCommerce Status</h1>
        {wooStatus ? (
          <ul className="space-y-2 text-gray-700">
            <li>WooCommerce Version: {wooStatus.woocommerce_version}</li>
            <li>WooCommerce Version: {wooStatus.wordpress_version}</li>
            <li>WordPress Version: {wooStatus.wordpress_version}</li>
            <li>PHP Version: {wooStatus.php_version}</li>
            <li>MySQL Version: {wooStatus.mysql_version}</li>
            <li>Server Info: {wooStatus.server_info}</li>
            <li>Max Upload Size: {wooStatus.max_upload_size} bytes</li>
            <li>Memory Limit: {wooStatus.memory_limit}</li>
            <li>Active Plugins: {wooStatus.active_plugins}</li>
            <li>Theme: {wooStatus.theme}</li>
            <li>Currency: {wooStatus.currency}</li>
            <li>Currency: {wooStatus.home_url}</li>
            <li>Tax Enabled: {wooStatus.tax_enabled ? "Yes" : "No"}</li>
            <li>Shipping Enabled: {wooStatus.shipping_enabled ? "Yes" : "No"}</li>
          </ul>
        ) : (
          <div className="text-gray-600">No WooCommerce status available</div>
        )}
      </div>
    </div>
  );
}

// -----------------------------
// Protected Route Component
// -----------------------------
function ProtectedRoute({ children }) {
  const { isAuthed } = useAuth();
  const { navigate } = useRouter();

  useEffect(() => {
    if (!isAuthed) navigate("login");
  }, [isAuthed, navigate]);

  if (!isAuthed) return null;
  return children;
}

// -----------------------------
// Sync Button Component
// -----------------------------
function SyncButton() {
  const { get } = useApi();
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState(null);
  const [error, setError] = useState(null);

  const handleSync = async () => {
    setLoading(true);
    setError(null);
    setResponse(null);
    try {
      const res = await get("/admin/sync");
      setResponse(res);
    } catch (err) {
      setError(err.message || "Failed to sync");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="sync-button-container">
      <button
        onClick={handleSync}
        disabled={loading}
        className="rounded-xl bg-red-200 px-3 py-2 text-black text-sm transition-all duration-200 hover:scale-105 hover:shadow-md inline-block"
      >
        {loading ? "Syncing…" : "Sync Orders"}
        {response && (
          <div>
            {response.message}
          </div>
        )}
        {error && (
          <div>
            {error}
          </div>
        )}
      </button>
    </div>
  );
}

// -----------------------------
// Route Components
// -----------------------------
function Routes() {
  const { currentRoute } = useRouter();

  switch (currentRoute) {
    case "login":
      return <LoginPage />;
    case "dashboard":
      return (
        <ProtectedRoute>
          <Dashboard />
        </ProtectedRoute>
      );
    case "orders":
      return (
        <ProtectedRoute>
          <OrdersPage />
        </ProtectedRoute>
      );
    case "search":
      return (
        <ProtectedRoute>
          <SearchPage />
        </ProtectedRoute>
      );
    case "order-detail":
      return (
        <ProtectedRoute>
          <OrderDetailPage />
        </ProtectedRoute>
      );
    case "blank":
      return (
        <ProtectedRoute>
          <BlankPage />
        </ProtectedRoute>
      );
    default:
      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
          <div className="text-center animate-in fade-in duration-700">
            <h1 className="text-2xl font-semibold text-gray-900">404</h1>
            <p className="mt-1 text-sm text-gray-600">Page not found</p>
            <button
              onClick={() => { const { navigate } = useRouter(); navigate("dashboard"); }}
              className="mt-4 inline-block rounded-xl bg-gray-900 px-4 py-2 text-white transition-all duration-200 hover:scale-105 hover:shadow-md"
            >
              Go home
            </button>
          </div>
        </div>
      );
  }
}

// -----------------------------
// App Shell with Router
// -----------------------------
export default function App() {
  return (
    <Router>
      <AuthProvider>
        <Navbar />
        <Routes />
      </AuthProvider>
    </Router>
  );
}