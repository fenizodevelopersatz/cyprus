import { createContext, useContext, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "react-router-dom";
import { fetchSystemStatus, type SystemStatusResponse } from "../content/api/content.api";
import { DEFAULT_SITE_LOGO, useAuthBranding } from "../auth/branding";

type SystemStatusContextValue = SystemStatusResponse | undefined;

const SystemStatusContext = createContext<SystemStatusContextValue>(undefined);

export const useSystemStatus = () => useContext(SystemStatusContext);

type SystemStatusGateProps = { children: React.ReactNode };

function FullScreenMessage({
  title,
  message,
  actionLabel,
  onAction,
  isLoading = false,
}: {
  title: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  isLoading?: boolean;
}) {
  const { siteName, siteLogoUrl } = useAuthBranding();
  const [displayLogoUrl, setDisplayLogoUrl] = useState(DEFAULT_SITE_LOGO);

  useEffect(() => {
    setDisplayLogoUrl(siteLogoUrl || DEFAULT_SITE_LOGO);
  }, [siteLogoUrl]);

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[linear-gradient(180deg,#050816_0%,#081022_44%,#050816_100%)] px-4 py-10 text-center text-slate-100">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-1/2 top-[18%] h-56 w-56 -translate-x-1/2 rounded-full bg-[rgba(38,99,235,0.16)] blur-3xl sm:h-72 sm:w-72" />
        <div className="absolute bottom-[18%] left-1/2 h-48 w-[78vw] max-w-3xl -translate-x-1/2 rounded-full bg-[rgba(14,165,233,0.12)] blur-3xl" />
      </div>

      <div className="relative w-full max-w-[740px] overflow-hidden rounded-[34px] border border-white/10 bg-[linear-gradient(180deg,rgba(12,19,40,0.94)_0%,rgba(5,10,28,0.98)_100%)] px-6 py-8 shadow-[0_30px_120px_-45px_rgba(14,165,233,0.45)] backdrop-blur-xl sm:px-10 sm:py-10">
        <div className="pointer-events-none absolute inset-x-8 top-0 h-px bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.38),transparent)]" />
        <div className="flex flex-col items-center">
          <img
            src={displayLogoUrl}
            alt={`${siteName} logo`}
            className="h-14 w-auto max-w-[180px] object-contain sm:h-16 sm:max-w-[220px]"
            onError={(event) => {
              event.currentTarget.src = DEFAULT_SITE_LOGO;
              setDisplayLogoUrl(DEFAULT_SITE_LOGO);
            }}
          />
          <div className="mt-5 h-[2px] w-40 overflow-hidden rounded-full bg-white/8">
            <div className={`h-full rounded-full bg-[linear-gradient(90deg,#2563eb_0%,#38bdf8_55%,#f43f5e_100%)] ${isLoading ? "animate-pulse" : ""}`} />
          </div>
        </div>

        <div className="mx-auto mt-8 max-w-[540px]">
          <h1 className="text-balance text-[2rem] font-extrabold leading-tight text-white sm:text-[3.35rem]">
            {title}
          </h1>
          <p className="mt-5 text-pretty text-lg font-medium leading-8 text-slate-300 sm:text-[2rem] sm:leading-[3rem]">
            {message}
          </p>
        </div>

        {isLoading ? (
          <div className="mt-8 flex items-center justify-center gap-3">
            <span className="h-2.5 w-2.5 animate-bounce rounded-full bg-sky-300 [animation-delay:-0.2s]" />
            <span className="h-2.5 w-2.5 animate-bounce rounded-full bg-blue-400 [animation-delay:-0.05s]" />
            <span className="h-2.5 w-2.5 animate-bounce rounded-full bg-rose-400 [animation-delay:0.1s]" />
          </div>
        ) : null}

        {actionLabel && onAction && (
          <button
            type="button"
            onClick={onAction}
            className="mt-8 inline-flex items-center justify-center rounded-full border border-white/16 bg-white/6 px-7 py-3 text-sm font-semibold uppercase tracking-[0.2em] text-white transition hover:border-sky-400/60 hover:bg-white/10 hover:text-sky-100"
          >
            {actionLabel}
          </button>
        )}
      </div>
    </div>
  );
}

function MaintenanceScreen({
  message,
  onRetry,
}: {
  message?: string | null;
  onRetry: () => void;
}) {
  return (
    <FullScreenMessage
      title="We are under maintenance"
      message={message || "Primerica Exchange is currently undergoing scheduled maintenance. Please check back soon."}
      actionLabel="Retry status"
      onAction={onRetry}
    />
  );
}

export function SystemStatusGate({ children }: SystemStatusGateProps) {
  const location = useLocation();
  const isAdminRoute = location.pathname === "/admin" || location.pathname.startsWith("/admin/");

  const statusQuery = useQuery({
    queryKey: ["systemStatus"],
    queryFn: fetchSystemStatus,
    staleTime: 5 * 60 * 1000,
  });

  if (statusQuery.isLoading) {
    return (
      <FullScreenMessage
        title="Loading…"
        message="Hold on while we check the latest window."
        isLoading
      />
    );
  }

  if (statusQuery.isError || !statusQuery.data) {
    return (
      <FullScreenMessage
        title="Unable to load system status"
        message="We couldn't verify the current maintenance state. Please retry."
        actionLabel="Retry"
        onAction={() => statusQuery.refetch()}
      />
    );
  }

  if (statusQuery.data.maintenanceMode && !isAdminRoute) {
    return <MaintenanceScreen message={statusQuery.data.maintenanceMessage} onRetry={() => statusQuery.refetch()} />;
  }

  return <SystemStatusContext.Provider value={statusQuery.data}>{children}</SystemStatusContext.Provider>;
}
