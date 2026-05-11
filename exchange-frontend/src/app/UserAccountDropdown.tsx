import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../features/auth/state/auth.store";
import { getUserProfile } from "../features/settings/api/account.api";
import { formatMoneyWithSymbol } from "../utils/money";

type Props = {
  totalUsdt: string;
  onNavigate?: () => void;
  onLogout: () => void;
};

const itemCls =
  "flex w-full items-center justify-between rounded-[10px] px-3 py-2 text-sm text-[var(--text-secondary)] transition hover:bg-[rgba(252,213,53,0.08)] hover:text-white";

export default function UserAccountDropdown({ totalUsdt, onNavigate, onLogout }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, right: 0, width: 0 });
  const [profilePhotoUrl, setProfilePhotoUrl] = useState<string | null>(null);
  const user = useAuth((state) => state.user);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const navigate = useNavigate();

  const displayName =
    (typeof user?.displayName === "string" && user.displayName.trim()) ||
    user?.name?.trim() ||
    "Account";
  const initials = useMemo(() => {
    const source = displayName === "Account" ? user?.email || "A" : displayName;
    return source
      .split(/\s+/)
      .map((part) => part[0] || "")
      .join("")
      .slice(0, 2)
      .toUpperCase();
  }, [displayName, user?.email]);

  useEffect(() => {
    let active = true;

    const loadProfilePhoto = async () => {
      try {
        const profile = await getUserProfile();
        if (!active) return;
        setProfilePhotoUrl(profile.profile_photo || null);
      } catch {
        if (!active) return;
        setProfilePhotoUrl(null);
      }
    };

    void loadProfilePhoto();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!isOpen) return;

    const updatePosition = () => {
      if (buttonRef.current) {
        const rect = buttonRef.current.getBoundingClientRect();
        const maxWidth = Math.min(320, window.innerWidth - 24);
        const desiredRight = window.innerWidth - rect.right;
        const maxRight = Math.max(12, window.innerWidth - maxWidth - 12);
        setPosition({
          top: rect.bottom + 8, // mt-2 equivalent
          right: Math.min(desiredRight, maxRight),
          width: rect.width,
        });
      }
    };

    updatePosition();

    const handlePointerDown = (event: MouseEvent) => {
      if (
        !wrapperRef.current?.contains(event.target as Node) &&
        !dropdownRef.current?.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };

    const handleResize = () => updatePosition();

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", handleResize);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", handleResize);
    };
  }, [isOpen]);

  const closeAndNavigate = (to: string) => {
    setIsOpen(false);
    if (onNavigate) onNavigate();
    navigate(to);
  };

  return (
    <div ref={wrapperRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="flex h-10 max-w-[calc(100vw-160px)] items-center gap-1.5 rounded-[12px] border border-[var(--border-soft)] bg-[var(--bg-card)] px-2 text-white transition hover:border-[var(--border-yellow)] hover:bg-[var(--bg-card-soft)] sm:max-w-none sm:gap-2 sm:px-3"
        aria-haspopup="menu"
        aria-expanded={isOpen}
      >
        {/* <span className="wallet-pill max-w-[96px] truncate px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.12em] sm:max-w-none sm:px-2.5 sm:text-[11px] sm:tracking-[0.16em]">
          {formatMoneyWithSymbol(totalUsdt)}
        </span> */}
        <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full border border-[var(--border-yellow)] bg-[rgba(252,213,53,0.12)] text-xs font-semibold text-[var(--accent-yellow)]">
          {profilePhotoUrl ? (
            <img src={profilePhotoUrl} alt={displayName} className="h-full w-full object-cover" />
          ) : (
            initials || "AC"
          )}
        </span>
      </button>

      {isOpen &&
        createPortal(
          <div
            ref={dropdownRef}
            className="fixed z-[9999] w-[min(18rem,calc(100vw-24px))] origin-top-right sm:w-80 sm:max-w-[calc(100vw-24px)]"
            style={{
              top: position.top,
              right: position.right,
            }}
            role="menu"
          >
            <div className="exchange-card pointer-events-auto scale-100 rounded-[18px] bg-[linear-gradient(180deg,#181A20_0%,#14151A_100%)] p-2.5 opacity-100 sm:p-3">
              <div className="rounded-[14px] border border-[var(--border-soft)] bg-[var(--bg-card-soft)] px-3 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-white">{displayName}</div>
                    <div className="truncate text-xs text-[var(--text-muted)]">{user?.email ?? "demo@exchange.test"}</div>
                  </div>
                  {/* <span className="wallet-pill max-w-[96px] truncate px-2 py-1 text-[9px] uppercase tracking-[0.14em] sm:max-w-none sm:px-2.5 sm:text-[10px] sm:tracking-[0.18em]">
                    {formatMoneyWithSymbol(totalUsdt)}
                  </span> */}
                </div>
              </div>

              <div className="mt-3 space-y-1">
                <button type="button" className={itemCls} onClick={() => closeAndNavigate("/app/settings")} role="menuitem">
                  <span>Profile</span>
                </button>
                <button type="button" className={itemCls} onClick={() => closeAndNavigate("/app/referrals")} role="menuitem">
                  <span>Referrals</span>
                </button>
                <button type="button" className={itemCls} onClick={() => closeAndNavigate("/app/kyc")} role="menuitem">
                  <span>KYC Center</span>
                </button>
                <button
                  type="button"
                  className="flex w-full items-center justify-between rounded-[10px] border border-[rgba(246,70,93,0.22)] bg-[rgba(246,70,93,0.12)] px-3 py-2 text-sm font-semibold text-[#ffd4db] transition hover:border-[rgba(246,70,93,0.35)] hover:bg-[rgba(246,70,93,0.18)] hover:text-white"
                  onClick={() => {
                    setIsOpen(false);
                    if (onNavigate) onNavigate();
                    onLogout();
                  }}
                  role="menuitem"
                >
                  <span>Logout</span>
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
