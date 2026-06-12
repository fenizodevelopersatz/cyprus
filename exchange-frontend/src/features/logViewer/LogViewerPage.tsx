import { useEffect, useMemo, useState, useRef } from "react";
import type { FormEvent } from "react";
import { API_BASE_URL } from "../../app/apiRoutes";

type LogFile = {
  id: string;
  name: string;
  path: string;
  group: string;
  extension: string;
  size: number;
  modifiedAt: string;
};

type LogFileDetail = {
  file: LogFile & { truncated: boolean };
  content: string;
};

type LogSummary = {
  totals: Record<string, number>;
  files: Array<LogFile & { counts: Record<string, number> }>;
};

const AUTH_STORAGE_KEY = "logViewerBasicAuth";
const PAYMENT_PRESETS = [
  { label: "All lines", value: "" },
  { label: "Payment issues", value: "payment|deposit|withdraw|fiat|funding|wallet|sweep|gas" },
  { label: "Errors only", value: "error|failed|failure|rejected|timeout|exception" },
  { label: "Email issues", value: "mail|email|smtp|sent|failed|rate|messageId" },
  { label: "Deposits", value: "deposit|funding" },
  { label: "Withdrawals", value: "withdraw|withdrawal" },
  { label: "Sweeps & gas", value: "sweep|gas|treasury" },
  { label: "RPC issues", value: "rpc|chain|txHash|blockchain|startup|connected|status" },
];

const FILE_SHORTCUTS = [
  { label: "App log", query: "app.log" },
  { label: "Email log", query: "mail-send-log" },
  { label: "RPC status", query: "rpc-status" },
  { label: "RPC checks", query: "backend-url-transactions" },
  { label: "Backend issues", query: "backend-url-issues" },
  { label: "RPC errors", query: "rpc-errors" },
];

function formatBytes(value: number) {
  if (!Number.isFinite(value)) return "0 B";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function buildUrl(path: string) {
  return `${API_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

async function fetchLogViewer<T>(path: string, authHeader: string): Promise<T> {
  const response = await fetch(buildUrl(path), {
    headers: { Authorization: authHeader },
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.message || `Request failed with ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export default function LogViewerPage() {
  const [authHeader, setAuthHeader] = useState(() => sessionStorage.getItem(AUTH_STORAGE_KEY) || "");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [files, setFiles] = useState<LogFile[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [detail, setDetail] = useState<LogFileDetail | null>(null);
  const [search, setSearch] = useState("");
  const [extension, setExtension] = useState("all");
  const [tailBytes, setTailBytes] = useState(512 * 1024);
  const [lineFilter, setLineFilter] = useState("");
  const [summary, setSummary] = useState<LogSummary | null>(null);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [error, setError] = useState("");
  const logContainerRef = useRef<HTMLPreElement>(null);

  const isAuthed = Boolean(authHeader);

  const filteredFiles = useMemo(() => {
    const query = search.trim().toLowerCase();
    return files.filter((file) => {
      const matchesExtension = extension === "all" || file.extension === extension;
      const matchesSearch =
        !query ||
        file.name.toLowerCase().includes(query) ||
        file.path.toLowerCase().includes(query) ||
        file.group.toLowerCase().includes(query);
      return matchesExtension && matchesSearch;
    });
  }, [extension, files, search]);

  const visibleContent = useMemo(() => {
    const content = detail?.content || "";
    const query = lineFilter.trim().toLowerCase();
    if (!query) return content;

    const terms = query
      .split("|")
      .map((term) => term.trim())
      .filter(Boolean);
    if (!terms.length) return content;

    return content
      .split(/\r?\n/)
      .filter((line) => {
        const normalized = line.toLowerCase();
        return terms.some((term) => normalized.includes(term));
      })
      .join("\n");
  }, [detail?.content, lineFilter]);

  const visibleLineCount = useMemo(() => {
    if (!visibleContent) return 0;
    return visibleContent.split(/\r?\n/).length;
  }, [visibleContent]);

  const loadFiles = async (header = authHeader) => {
    if (!header) return;
    setLoadingFiles(true);
    setError("");
    try {
      const [payload, summaryPayload] = await Promise.all([
        fetchLogViewer<{ files: LogFile[] }>("/api/log-viewer/files", header),
        fetchLogViewer<LogSummary>("/api/log-viewer/summary", header),
      ]);
      setFiles(payload.files);
      setSummary(summaryPayload);
      setSelectedId((current) => current || payload.files[0]?.id || "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load log files");
      sessionStorage.removeItem(AUTH_STORAGE_KEY);
      setAuthHeader("");
    } finally {
      setLoadingFiles(false);
    }
  };

  const loadDetail = async (fileId = selectedId) => {
    if (!authHeader || !fileId) return;
    setLoadingDetail(true);
    setError("");
    try {
      const payload = await fetchLogViewer<LogFileDetail>(
        `/api/log-viewer/files/${encodeURIComponent(fileId)}?tailBytes=${tailBytes}`,
        authHeader
      );
      setDetail(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load log file");
    } finally {
      setLoadingDetail(false);
    }
  };

  const downloadSelectedFile = async () => {
    if (!authHeader || !selectedId) return;
    setDownloading(true);
    setError("");
    try {
      const response = await fetch(buildUrl(`/api/log-viewer/files/${encodeURIComponent(selectedId)}/download`), {
        headers: { Authorization: authHeader },
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.message || `Download failed with ${response.status}`);
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      const selectedFile = detail?.file || files.find((file) => file.id === selectedId);
      link.href = url;
      link.download = selectedFile?.name || "log-file.txt";
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to download log file");
    } finally {
      setDownloading(false);
    }
  };

  const deleteSelectedFile = async () => {
    if (!authHeader || !selectedId) return;
    if (!window.confirm("Are you sure you want to delete this log file? This cannot be undone.")) return;
    
    setDeleting(true);
    setError("");
    try {
      const response = await fetch(buildUrl(`/api/log-viewer/files/${encodeURIComponent(selectedId)}`), {
        method: "DELETE",
        headers: { Authorization: authHeader },
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.message || `Delete failed with ${response.status}`);
      }
      
      setDetail(null);
      setSelectedId("");
      await loadFiles();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to delete log file");
    } finally {
      setDeleting(false);
    }
  };

  useEffect(() => {
    if (authHeader) void loadFiles(authHeader);
  }, [authHeader]);

  useEffect(() => {
    if (selectedId) void loadDetail(selectedId);
  }, [selectedId, tailBytes]);

  useEffect(() => {
    if (!autoRefresh || !selectedId || !authHeader) return;
    const interval = setInterval(() => {
      void loadDetail(selectedId);
    }, 3000);
    return () => clearInterval(interval);
  }, [autoRefresh, selectedId, authHeader, tailBytes]);

  useEffect(() => {
    if (autoRefresh && logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [visibleContent, autoRefresh]);

  const handleLogin = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const header = `Basic ${window.btoa(`${username}:${password}`)}`;
    sessionStorage.setItem(AUTH_STORAGE_KEY, header);
    setAuthHeader(header);
  };

  const logout = () => {
    sessionStorage.removeItem(AUTH_STORAGE_KEY);
    setAuthHeader("");
    setDetail(null);
    setFiles([]);
    setPassword("");
  };

  if (!isAuthed) {
    return (
      <div className="min-h-screen bg-[#f3f5f9] text-slate-900">
        <div className="mx-auto flex min-h-screen max-w-6xl items-center px-6 py-10">
          <div className="grid w-full gap-8 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
            <div>
              <h1 className="text-4xl font-semibold tracking-tight text-slate-950">Log Viewer</h1>
              <p className="mt-3 max-w-xl text-sm leading-6 text-slate-600">
                Inspect backend `.log`, `.json`, and `.jsonl` files from one protected console.
              </p>
            </div>
            <form onSubmit={handleLogin} className="rounded border border-slate-200 bg-white p-6 shadow-sm">
              <div className="mb-6">
                <h2 className="text-xl font-semibold">Authentication</h2>
                <p className="mt-1 text-sm text-slate-500">Use the log viewer credentials.</p>
              </div>
              <label className="mb-4 block text-sm font-medium">
                Username
                <input
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  className="mt-2 w-full rounded border border-slate-300 px-3 py-2 outline-none focus:border-sky-500"
                  autoComplete="username"
                />
              </label>
              <label className="mb-6 block text-sm font-medium">
                Password
                <input
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  type="password"
                  className="mt-2 w-full rounded border border-slate-300 px-3 py-2 outline-none focus:border-sky-500"
                  autoComplete="current-password"
                />
              </label>
              {error ? <div className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div> : null}
              <button className="w-full rounded bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-sky-700">
                Open Log Viewer
              </button>
            </form>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#eef1f5] text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-[1880px] flex-wrap items-center gap-4 px-4 py-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Log Viewer</h1>
            <p className="text-sm text-slate-500">All backend `.log`, `.json`, and `.jsonl` files</p>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <button onClick={() => loadFiles()} className="rounded border border-slate-300 bg-white px-3 py-2 text-sm hover:bg-slate-50">
              {loadingFiles ? "Refreshing..." : "Refresh"}
            </button>
            <button onClick={logout} className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 hover:bg-red-100">
              Logout
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-[1880px] gap-4 px-4 py-4 xl:grid-cols-[320px_1fr] 2xl:grid-cols-[360px_1fr]">
        <aside className="min-h-[calc(100vh-96px)] rounded border border-slate-200 bg-white">
          <div className="border-b border-slate-200 p-4">
            {summary ? (
              <div className="mb-3 grid grid-cols-3 gap-2">
                {[
                  ["Errors", summary.totals.errors],
                  ["RPC", summary.totals.rpc],
                  ["Mail", summary.totals.mail],
                ].map(([label, value]) => (
                  <div key={String(label)} className="rounded border border-slate-200 bg-slate-50 px-2 py-1.5">
                    <div className="text-[10px] font-semibold uppercase text-slate-500">{label}</div>
                    <div className="text-sm font-semibold text-slate-900">{Number(value || 0)}</div>
                  </div>
                ))}
              </div>
            ) : null}
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search files"
              className="w-full rounded border border-slate-300 px-3 py-2 text-sm outline-none focus:border-sky-500"
            />
            <select
              value={extension}
              onChange={(event) => setExtension(event.target.value)}
              className="mt-3 w-full rounded border border-slate-300 px-3 py-2 text-sm outline-none focus:border-sky-500"
            >
              <option value="all">All file types</option>
              <option value=".log">.log</option>
              <option value=".json">.json</option>
              <option value=".jsonl">.jsonl</option>
            </select>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {FILE_SHORTCUTS.map((shortcut) => (
                <button
                  key={shortcut.label}
                  type="button"
                  onClick={() => {
                    setSearch(shortcut.query);
                    const target = files.find((file) => file.name.toLowerCase().includes(shortcut.query));
                    if (target) setSelectedId(target.id);
                  }}
                  className="rounded border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs font-medium text-slate-700 hover:bg-sky-50 hover:text-sky-800"
                >
                  {shortcut.label}
                </button>
              ))}
            </div>
          </div>
          <div className="max-h-[calc(100vh-210px)] overflow-auto">
            {filteredFiles.map((file) => (
              <button
                key={file.id}
                type="button"
                onClick={() => setSelectedId(file.id)}
                className={`block w-full border-b border-slate-100 px-4 py-3 text-left hover:bg-slate-50 ${
                  selectedId === file.id ? "bg-sky-50" : "bg-white"
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="truncate text-sm font-semibold">{file.name}</span>
                  <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{file.extension}</span>
                </div>
                <div className="mt-1 truncate text-xs text-slate-500">{file.group} / {file.path}</div>
                <div className="mt-2 flex justify-between text-xs text-slate-400">
                  <span>{formatBytes(file.size)}</span>
                  <span>{formatDate(file.modifiedAt)}</span>
                </div>
              </button>
            ))}
            {!filteredFiles.length ? (
              <div className="p-5 text-sm text-slate-500">{loadingFiles ? "Loading files..." : "No log or JSON files found."}</div>
            ) : null}
          </div>
        </aside>

        <section className="min-h-[calc(100vh-96px)] overflow-hidden rounded border border-slate-200 bg-white">
          <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 px-4 py-3">
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold">{detail?.file.path || "Select a file"}</div>
              <div className="text-xs text-slate-500">
                {detail ? `${formatBytes(detail.file.size)} - modified ${formatDate(detail.file.modifiedAt)} - ${visibleLineCount} visible lines` : "Waiting for a file selection"}
              </div>
            </div>
            <select
              value={lineFilter}
              onChange={(event) => setLineFilter(event.target.value)}
              className="min-w-[170px] rounded border border-slate-300 px-3 py-2 text-sm outline-none focus:border-sky-500"
              title="Filter loaded lines"
            >
              {PAYMENT_PRESETS.map((preset) => (
                <option key={preset.label} value={preset.value}>{preset.label}</option>
              ))}
            </select>
            <input
              value={lineFilter}
              onChange={(event) => setLineFilter(event.target.value)}
              placeholder="Filter loaded lines"
              className="min-w-[220px] rounded border border-slate-300 px-3 py-2 text-sm outline-none focus:border-sky-500"
            />
            <select
              value={tailBytes}
              onChange={(event) => setTailBytes(Number(event.target.value))}
              className="rounded border border-slate-300 px-3 py-2 text-sm outline-none focus:border-sky-500"
            >
              <option value={128 * 1024}>Last 128 KB</option>
              <option value={512 * 1024}>Last 512 KB</option>
              <option value={1024 * 1024}>Last 1 MB</option>
              <option value={5 * 1024 * 1024}>Last 5 MB</option>
              <option value={10 * 1024 * 1024}>Last 10 MB</option>
              <option value={tailBytes} className="hidden">Custom ({formatBytes(tailBytes)})</option>
            </select>
            <button onClick={() => setTailBytes(prev => prev + 512 * 1024)} className="rounded border border-slate-300 bg-white px-3 py-2 text-sm hover:bg-slate-50">
              Load Older
            </button>
            <button onClick={() => loadDetail()} className="rounded border border-slate-300 bg-white px-3 py-2 text-sm hover:bg-slate-50">
              {loadingDetail ? "Loading..." : "Reload"}
            </button>
            <label className="flex items-center gap-2 rounded border border-slate-300 bg-white px-3 py-2 text-sm hover:bg-slate-50 cursor-pointer">
              <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} />
              Live Tracking
            </label>
            <button
              onClick={downloadSelectedFile}
              disabled={!selectedId || downloading}
              className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {downloading ? "Downloading..." : "Download"}
            </button>
            <button
              onClick={deleteSelectedFile}
              disabled={!selectedId || deleting}
              className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {deleting ? "Deleting..." : "Delete"}
            </button>
          </div>
          {error ? <div className="border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div> : null}
          {detail?.file.truncated ? (
            <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
              Showing the tail of this file for faster loading. Use Download to save the full file without rendering it in the browser.
            </div>
          ) : null}
          {lineFilter ? (
            <div className="border-b border-sky-100 bg-sky-50 px-4 py-2 text-sm text-sky-800">
              Filtering the loaded tail by: {lineFilter}
            </div>
          ) : null}
          <pre ref={logContainerRef} className="h-[calc(100vh-205px)] overflow-auto whitespace-pre bg-[#fbfcfe] p-4 font-mono text-[11px] leading-5 text-slate-800">
            {loadingDetail && !autoRefresh ? "Loading log content..." : visibleContent || "No content loaded."}
          </pre>
        </section>
      </main>
    </div>
  );
}
