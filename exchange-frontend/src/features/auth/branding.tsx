import { useEffect, useState } from "react";
import { CONTENT_ENDPOINTS } from "../../app/apiRoutes";

export const DEFAULT_SITE_NAME = "Primerica Exchange";
export const DEFAULT_SITE_LOGO = "/icons/logo.png";
export const DEFAULT_SITE_FAVICON = "/favicon.ico";

export type SiteBranding = {
  siteName?: string;
  siteLogoUrl?: string;
  siteFaviconUrl?: string;
};

const withVersion = (assetUrl: string) =>
  assetUrl.startsWith("/icons/") || assetUrl === DEFAULT_SITE_FAVICON
    ? assetUrl
    : `${assetUrl}${assetUrl.includes("?") ? "&" : "?"}v=${Date.now()}`;

const updateFavicon = (faviconUrl?: string) => {
  const nextFavicon = withVersion(faviconUrl?.trim() || DEFAULT_SITE_FAVICON);
  ["icon", "shortcut icon"].forEach((rel) => {
    let favicon = document.querySelector(`link[rel='${rel}']`) as HTMLLinkElement | null;
    if (!favicon) {
      favicon = document.createElement("link");
      favicon.rel = rel;
      document.head.appendChild(favicon);
    }
    favicon.href = nextFavicon;
  });
};

export function useAuthBranding() {
  const [siteName, setSiteName] = useState(DEFAULT_SITE_NAME);
  const [siteLogoUrl, setSiteLogoUrl] = useState(DEFAULT_SITE_LOGO);

  useEffect(() => {
    const applyBranding = (settings?: SiteBranding) => {
      setSiteName(settings?.siteName?.trim() || DEFAULT_SITE_NAME);
      setSiteLogoUrl(withVersion(settings?.siteLogoUrl?.trim() || DEFAULT_SITE_LOGO));
      updateFavicon(settings?.siteFaviconUrl);
    };

    let cancelled = false;

    const loadBranding = async () => {
      try {
        const response = await fetch(CONTENT_ENDPOINTS.branding, { credentials: "include" });
        if (!response.ok) throw new Error("Unable to load site branding");
        const payload = await response.json();
        const data = (payload?.data ?? payload) as SiteBranding;
        if (!cancelled) {
          applyBranding(data);
        }
      } catch {
        if (!cancelled) {
          applyBranding();
        }
      }
    };

    void loadBranding();

    const handleBrandingChange = (event: Event) => {
      const customEvent = event as CustomEvent<SiteBranding>;
      applyBranding(customEvent.detail);
    };

    window.addEventListener("site-settings-updated", handleBrandingChange as EventListener);
    return () => {
      cancelled = true;
      window.removeEventListener("site-settings-updated", handleBrandingChange as EventListener);
    };
  }, []);

  return { siteName, siteLogoUrl };
}
