import { useCallback, useEffect, useId, useState, type ChangeEvent, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import Input from "../../../ui/Input";
import Button from "../../../ui/Button";
import Dialog from "../../../ui/Dialog";
import InlineFeedback from "../../../ui/InlineFeedback";
import { useTimedFeedback } from "../../../hooks/useTimedFeedback";
import CountrySelect from "../../auth/components/CountrySelect";
import { getCountryByCode, getCountryByName } from "../../auth/data/countries";
import { useAuth } from "../../auth/state/auth.store";
import {
  changeUserPassword,
  deleteAccount,
  disableGoogleAuthenticator,
  enableGoogleAuthenticator,
  getUserProfile,
  setupGoogleAuthenticator,
  updateUserProfile,
  type TwoFactorSetupResponse,
} from "../api/account.api";
import { getLevelImageSrc, getLevelLabel } from "../../../utils/levelImages";
import {
  loadWithdrawAddressBook,
  mergeWithdrawAddressBook,
  saveWithdrawAddressBook,
  type WithdrawAddressHistoryEntry,
} from "../utils/withdrawAddressBook";
import { FundingNetworkIcon } from "../../funding/components/FundingNetworkIcon";

type PersonalInfoForm = {
  first_name: string;
  last_name: string;
  username: string;
  mobile_number: string;
  country: string;
  state: string;
  city: string;
  postal_code: string;
  date_of_birth: string;
  gender: string;
  address_line_1: string;
  address_line_2: string;
  withdraw_address_tron: string;
  withdraw_address_bsc: string;
  withdraw_address_ethereum: string;
  profile_photo: string | File | null;
};

type PasswordForm = {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
};

const defaultPersonalInfo: PersonalInfoForm = {
  first_name: "",
  last_name: "",
  username: "",
  mobile_number: "",
  country: "",
  state: "",
  city: "",
  postal_code: "",
  date_of_birth: "",
  gender: "",
  address_line_1: "",
  address_line_2: "",
  withdraw_address_tron: "",
  withdraw_address_bsc: "",
  withdraw_address_ethereum: "",
  profile_photo: null,
};

const defaultPasswordForm: PasswordForm = {
  currentPassword: "",
  newPassword: "",
  confirmPassword: "",
};

const cardBaseCls =
  "rounded-[22px] border border-[var(--border-soft)] bg-[linear-gradient(180deg,#181b21_0%,#13161b_100%)] p-4 space-y-3 shadow-[0_18px_42px_rgba(0,0,0,0.18)] sm:p-5";
const settingsFieldClass =
  "!border-white/10 !focus:border-white/80 focus:!shadow-[0_0_0_3px_rgba(255,255,255,0.08)]";
const settingsSelectClass =
  "w-full h-10 px-3 rounded-xl border border-white/10 bg-gray-900/70 text-sm text-gray-100 transition focus:border-white/80 focus:outline-none focus:ring-0";
const settingsTextareaClass =
  "w-full rounded-xl border border-white/10 bg-gray-900/70 px-3 py-2.5 text-sm text-gray-100 placeholder:text-gray-500 transition focus:border-white/80 focus:outline-none focus:ring-0";
const sectionTitleClass = "text-[13px] font-semibold text-white";
const bodyCopyClass = "text-[11px] text-[var(--text-secondary)]";

const toCamelCaseName = (value: string) =>
  value
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");

const splitRegisteredName = (value?: string | null) => {
  const normalized = toCamelCaseName(value || "");
  if (!normalized) return { firstName: "", lastName: "" };
  const parts = normalized.split(/\s+/).filter(Boolean);
  return {
    firstName: parts[0] || "",
    lastName: parts.slice(1).join(" "),
  };
};

const deriveUsernameFallback = (email?: string | null) => {
  const localPart = (email || "").split("@")[0]?.trim() || "";
  return localPart.replace(/[^a-zA-Z0-9._]/g, "");
};

const isValidTronAddress = (value: string) => /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(value.trim());
const isValidEvmAddress = (value: string) => /^0x[a-fA-F0-9]{40}$/.test(value.trim());

const mapWithdrawAddresses = (address?: string | null, network?: string | null) => {
  const next = {
    withdraw_address_tron: "",
    withdraw_address_bsc: "",
    withdraw_address_ethereum: "",
  };

  const normalizedAddress = String(address ?? "").trim();
  const normalizedNetwork = String(network ?? "").trim().toLowerCase();
  if (!normalizedAddress) return next;

  if (normalizedNetwork === "tron") next.withdraw_address_tron = normalizedAddress;
  else if (normalizedNetwork === "bsc") next.withdraw_address_bsc = normalizedAddress;
  else if (normalizedNetwork === "ethereum") next.withdraw_address_ethereum = normalizedAddress;

  return next;
};

const resolveDefaultWithdrawPayload = (personalInfo: PersonalInfoForm) => {
  if (personalInfo.withdraw_address_tron.trim()) {
    return {
      default_withdraw_wallet_address: personalInfo.withdraw_address_tron.trim(),
      default_withdraw_wallet_network: "tron",
    };
  }
  if (personalInfo.withdraw_address_bsc.trim()) {
    return {
      default_withdraw_wallet_address: personalInfo.withdraw_address_bsc.trim(),
      default_withdraw_wallet_network: "bsc",
    };
  }
  if (personalInfo.withdraw_address_ethereum.trim()) {
    return {
      default_withdraw_wallet_address: personalInfo.withdraw_address_ethereum.trim(),
      default_withdraw_wallet_network: "ethereum",
    };
  }
  return {
    default_withdraw_wallet_address: "",
    default_withdraw_wallet_network: "",
  };
};

export default function SettingsPage() {
  const navigate = useNavigate();
  const user = useAuth((state) => state.user);
  const logout = useAuth((state) => state.logout);
  const [twoFactorEnabled, setTwoFactorEnabled] = useState(false);
  const [priceAlertsEnabled, setPriceAlertsEnabled] = useState(true);
  const [darkMode, setDarkMode] = useState(true);
  const [apiKeyMask, setApiKeyMask] = useState(true);
  const [personalInfo, setPersonalInfo] = useState<PersonalInfoForm>(defaultPersonalInfo);
  const [passwordForm, setPasswordForm] = useState<PasswordForm>(defaultPasswordForm);
  const [googleAuthConfigured, setGoogleAuthConfigured] = useState(false);
  const [twoFactorSetup, setTwoFactorSetup] = useState<TwoFactorSetupResponse | null>(null);
  const [twoFactorCode, setTwoFactorCode] = useState("");
  const [twoFactorBusy, setTwoFactorBusy] = useState(false);
  const [secretCopied, setSecretCopied] = useState(false);
  const [profileLoading, setProfileLoading] = useState(true);
  const [personalSaving, setPersonalSaving] = useState(false);
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [personalErrors, setPersonalErrors] = useState<Record<string, string>>({});
  const [passwordErrors, setPasswordErrors] = useState<Record<string, string>>({});
  const [profilePhotoLoadError, setProfilePhotoLoadError] = useState(false);
  const [profilePhotoBlobUrl, setProfilePhotoBlobUrl] = useState<string | null>(null);
  const [deletePending, setDeletePending] = useState(false);
  const { feedback: personalFeedback, setFeedback: setPersonalFeedback } = useTimedFeedback();
  const { feedback: securityFeedback, setFeedback: setSecurityFeedback } = useTimedFeedback();
  const { feedback: passwordFeedback, setFeedback: setPasswordFeedback } = useTimedFeedback();
  const { feedback: deleteFeedback, setFeedback: setDeleteFeedback } = useTimedFeedback();
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [imagePreview, setImagePreview] = useState<{ src: string; title: string } | null>(null);
  const [withdrawAddressHistory, setWithdrawAddressHistory] = useState<WithdrawAddressHistoryEntry[]>([]);
  const profilePhotoPreviewSrc = profilePhotoBlobUrl;
  const selectedCountryCode = getCountryByCode(personalInfo.country)?.code ?? getCountryByName(personalInfo.country)?.code ?? "";
  const profileDisplayName = user?.name ?? "Primerica Trader";
  const profileInitial = (user?.name?.charAt(0) || user?.email?.charAt(0) || "U").toUpperCase();
  const userLevelImage = getLevelImageSrc(user?.currentLevelCode, user?.currentLevelRank);
  const userLevelLabel = getLevelLabel(user?.currentLevelCode, user?.currentLevelRank);
  useEffect(() => {
    let active = true;

    const loadProfile = async () => {
      setProfileLoading(true);
      const addressBook = loadWithdrawAddressBook();
      if (active) {
        setWithdrawAddressHistory(addressBook.history);
      }
      try {
        const profile = await getUserProfile();
        if (!active) return;
        setProfilePhotoLoadError(false);
        setTwoFactorEnabled(Boolean(profile.google_auth_enabled));
        setGoogleAuthConfigured(Boolean(profile.google_auth_configured));
        const registeredName = splitRegisteredName(user?.name);
        setPersonalInfo({
          first_name: toCamelCaseName(profile.first_name || registeredName.firstName || ""),
          last_name: profile.last_name || registeredName.lastName || "",
          username: profile.username || deriveUsernameFallback(user?.email) || "",
          mobile_number: profile.mobile_number || "",
          country: profile.country || "",
          state: profile.state || "",
          city: profile.city || "",
          postal_code: profile.postal_code || "",
          date_of_birth: profile.date_of_birth || "",
          gender: profile.gender || "",
          address_line_1: profile.address_line_1 || "",
          address_line_2: profile.address_line_2 || "",
          withdraw_address_tron:
            mapWithdrawAddresses(profile.default_withdraw_wallet_address, profile.default_withdraw_wallet_network).withdraw_address_tron ||
            addressBook.current.tron ||
            "",
          withdraw_address_bsc:
            mapWithdrawAddresses(profile.default_withdraw_wallet_address, profile.default_withdraw_wallet_network).withdraw_address_bsc ||
            addressBook.current.bsc ||
            "",
          withdraw_address_ethereum:
            mapWithdrawAddresses(profile.default_withdraw_wallet_address, profile.default_withdraw_wallet_network).withdraw_address_ethereum ||
            addressBook.current.ethereum ||
            "",
          profile_photo: profile.profile_photo || null,
        });
      } catch {
        if (!active) return;
        setTwoFactorEnabled(false);
        setGoogleAuthConfigured(false);
        const registeredName = splitRegisteredName(user?.name);
        setPersonalInfo((current) => ({
          ...current,
          first_name: registeredName.firstName,
          last_name: registeredName.lastName,
          username: deriveUsernameFallback(user?.email) || "",
          withdraw_address_tron: current.withdraw_address_tron || addressBook.current.tron || "",
          withdraw_address_bsc: current.withdraw_address_bsc || addressBook.current.bsc || "",
          withdraw_address_ethereum: current.withdraw_address_ethereum || addressBook.current.ethereum || "",
        }));
      } finally {
        if (active) setProfileLoading(false);
      }
    };

    void loadProfile();
    return () => {
      active = false;
    };
  }, [user?.email, user?.name, user?.twoFactorEnabled]);

  useEffect(() => {
    return () => {
      if (profilePhotoBlobUrl) {
        URL.revokeObjectURL(profilePhotoBlobUrl);
      }
    };
  }, [profilePhotoBlobUrl]);

  useEffect(() => {
    let active = true;
    let nextUrl: string | null = null;

    const loadPreview = async () => {
      setProfilePhotoLoadError(false);

      if (personalInfo.profile_photo instanceof File) {
        nextUrl = URL.createObjectURL(personalInfo.profile_photo);
        if (!active) {
          URL.revokeObjectURL(nextUrl);
          return;
        }
        setProfilePhotoBlobUrl(nextUrl);
        return;
      }

      if (typeof personalInfo.profile_photo === "string" && personalInfo.profile_photo) {
        if (!active) return;
        setProfilePhotoBlobUrl(personalInfo.profile_photo);
        return;
      }

      setProfilePhotoBlobUrl(null);
    };

    void loadPreview();

    return () => {
      active = false;
      if (nextUrl) {
        URL.revokeObjectURL(nextUrl);
      }
    };
  }, [personalInfo.profile_photo]);

  const onPersonalInfoChange = <K extends keyof PersonalInfoForm>(key: K, value: PersonalInfoForm[K]) => {
    setPersonalInfo((current) => ({
      ...current,
      [key]:
        key === "first_name" && typeof value === "string"
          ? toCamelCaseName(value)
          : value,
    }));
  };

  const validatePersonalInfo = () => {
    const nextErrors: Record<string, string> = {};
    if (!personalInfo.first_name.trim()) nextErrors.first_name = "First name is required";
    if (!personalInfo.last_name.trim()) nextErrors.last_name = "Last name is required";
    if (!personalInfo.mobile_number.trim()) nextErrors.mobile_number = "Mobile number is required";
    if (!personalInfo.country.trim()) nextErrors.country = "Country is required";
    if (personalInfo.mobile_number.trim() && !/^\+?[0-9()\-\s]{7,20}$/.test(personalInfo.mobile_number.trim())) {
      nextErrors.mobile_number = "Enter a valid mobile number";
    }
    if (personalInfo.withdraw_address_tron.trim() && !isValidTronAddress(personalInfo.withdraw_address_tron)) {
      nextErrors.withdraw_address_tron = "Enter a valid TRC20 address";
    }
    if (personalInfo.withdraw_address_bsc.trim() && !isValidEvmAddress(personalInfo.withdraw_address_bsc)) {
      nextErrors.withdraw_address_bsc = "Enter a valid BEP20 address";
    }
    if (personalInfo.withdraw_address_ethereum.trim() && !isValidEvmAddress(personalInfo.withdraw_address_ethereum)) {
      nextErrors.withdraw_address_ethereum = "Enter a valid ERC20 address";
    }
    setPersonalErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const handleProfilePhotoChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setPersonalErrors((current) => ({ ...current, profile_photo: "Profile photo must be an image file" }));
      return;
    }

    setProfilePhotoLoadError(false);

    setPersonalErrors((current) => {
      const next = { ...current };
      delete next.profile_photo;
      return next;
    });
    onPersonalInfoChange("profile_photo", file);
  };

  const onPasswordFormChange = <K extends keyof PasswordForm>(key: K, value: PasswordForm[K]) => {
    setPasswordForm((current) => ({
      ...current,
      [key]: value,
    }));
    setPasswordErrors((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
  };

  const handleSavePersonalInfo = async () => {
    setPersonalFeedback(null);
    if (!validatePersonalInfo()) return;

    setPersonalSaving(true);
    try {
      const defaultWithdrawPayload = resolveDefaultWithdrawPayload(personalInfo);
      await updateUserProfile({
        personalInformation: true,
        first_name: personalInfo.first_name,
        last_name: personalInfo.last_name,
        username: personalInfo.username,
        mobile_number: personalInfo.mobile_number,
        country: personalInfo.country,
        state: personalInfo.state,
        city: personalInfo.city,
        postal_code: personalInfo.postal_code,
        date_of_birth: personalInfo.date_of_birth || null,
        gender: personalInfo.gender || null,
        address_line_1: personalInfo.address_line_1,
        address_line_2: personalInfo.address_line_2,
        default_withdraw_wallet_address: defaultWithdrawPayload.default_withdraw_wallet_address,
        default_withdraw_wallet_network: defaultWithdrawPayload.default_withdraw_wallet_network,
        profile_photo: personalInfo.profile_photo,
      });
      const updatedAddressBook = mergeWithdrawAddressBook(loadWithdrawAddressBook(), {
        tron: personalInfo.withdraw_address_tron,
        bsc: personalInfo.withdraw_address_bsc,
        ethereum: personalInfo.withdraw_address_ethereum,
      });
      saveWithdrawAddressBook(updatedAddressBook);
      setWithdrawAddressHistory(updatedAddressBook.history);
      setPersonalFeedback({ tone: "success", text: "Personal information updated successfully." });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to save personal information.";
      setPersonalFeedback(
        {
          tone: "error",
          text:
            message === "USERNAME_ALREADY_EXISTS"
              ? "Username already exists."
              : message === "INVALID_MOBILE_NUMBER"
                ? "Enter a valid mobile number."
                : message,
        }
      );
    } finally {
      setPersonalSaving(false);
    }
  };

  const validatePasswordForm = () => {
    const nextErrors: Record<string, string> = {};
    if (!passwordForm.currentPassword.trim()) nextErrors.currentPassword = "Current password is required";
    if (passwordForm.newPassword.trim().length < 8) nextErrors.newPassword = "New password must be at least 8 characters";
    if (passwordForm.confirmPassword !== passwordForm.newPassword) nextErrors.confirmPassword = "Passwords do not match";
    setPasswordErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const handleChangePassword = async () => {
    setPasswordFeedback(null);
    setSecurityFeedback(null);
    if (!validatePasswordForm()) return;

    setPasswordSaving(true);
    try {
      await changeUserPassword({
        currentPassword: passwordForm.currentPassword,
        newPassword: passwordForm.newPassword,
      });
      setPasswordForm(defaultPasswordForm);
      setPasswordFeedback({ tone: "success", text: "Password updated successfully." });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to change password.";
      setPasswordFeedback(
        {
          tone: "error",
          text:
            message === "CURRENT_PASSWORD_INCORRECT"
              ? "Current password is incorrect."
              : message === "NEW_PASSWORD_TOO_SHORT"
                ? "New password must be at least 8 characters."
                : message,
        }
      );
    } finally {
      setPasswordSaving(false);
    }
  };

  const handleToggleTwoFactor = async () => {
    setSecurityFeedback(null);
    if (twoFactorEnabled) {
      setSecurityFeedback({ tone: "info", text: "Enter your current Google Authenticator code below to disable two-factor authentication." });
      return;
    }
    setTwoFactorBusy(true);
    try {
      const setup = await setupGoogleAuthenticator();
      setTwoFactorSetup(setup);
      setTwoFactorCode("");
      setSecurityFeedback({ tone: "info", text: "Scan the QR code with Google Authenticator, then enter the 6-digit code to enable it." });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to start Google Authenticator setup.";
      setSecurityFeedback({ tone: "error", text: message });
    } finally {
      setTwoFactorBusy(false);
    }
  };

  const handleEnableGoogleAuth = async () => {
    setSecurityFeedback(null);
    if (!/^\d{6}$/.test(twoFactorCode.trim())) {
      setSecurityFeedback({ tone: "error", text: "Enter the 6-digit code from Google Authenticator." });
      return;
    }

    setTwoFactorBusy(true);
    try {
      await enableGoogleAuthenticator(twoFactorCode.trim());
      setTwoFactorEnabled(true);
      setGoogleAuthConfigured(true);
      setTwoFactorSetup(null);
      setTwoFactorCode("");
      setSecurityFeedback({ tone: "success", text: "Google Authenticator enabled successfully." });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to enable Google Authenticator.";
      setSecurityFeedback({ tone: "error", text: message === "INVALID_AUTHENTICATOR_CODE" ? "Invalid authenticator code." : message });
    } finally {
      setTwoFactorBusy(false);
    }
  };

  const handleDisableGoogleAuth = async () => {
    setSecurityFeedback(null);
    if (!/^\d{6}$/.test(twoFactorCode.trim())) {
      setSecurityFeedback({ tone: "error", text: "Enter your current 6-digit authenticator code to disable two-factor authentication." });
      return;
    }

    setTwoFactorBusy(true);
    try {
      await disableGoogleAuthenticator(twoFactorCode.trim());
      setTwoFactorEnabled(false);
      setGoogleAuthConfigured(false);
      setTwoFactorSetup(null);
      setTwoFactorCode("");
      setSecurityFeedback({ tone: "success", text: "Google Authenticator disabled successfully." });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to disable Google Authenticator.";
      setSecurityFeedback({ tone: "error", text: message === "INVALID_AUTHENTICATOR_CODE" ? "Invalid authenticator code." : message });
    } finally {
      setTwoFactorBusy(false);
    }
  };

  const handleCopySecret = useCallback(async () => {
    const secret = twoFactorSetup?.secret?.trim();
    if (!secret) return;

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(secret);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = secret;
        textarea.style.position = "fixed";
        textarea.style.top = "-1000px";
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }

      setSecretCopied(true);
      window.setTimeout(() => setSecretCopied(false), 2000);
    } catch (error) {
      console.error("Failed to copy authenticator secret", error);
    }
  }, [twoFactorSetup?.secret]);

  const handleDeleteMyAccount = async () => {
    setDeletePending(true);
    setDeleteFeedback(null);
    try {
      const res = await deleteAccount();
      if (res?.deleted) {
        logout();
        navigate("/login", { replace: true });
        return;
      }
      setDeleteFeedback({ tone: "error", text: "Unable to delete account. Please try again." });
    } catch (error) {
      setDeleteFeedback({ tone: "error", text: error instanceof Error ? error.message : "Unable to delete account. Please try again." });
    } finally {
      setDeletePending(false);
      setDeleteDialogOpen(false);
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-5 px-1 text-slate-100 sm:space-y-6 sm:px-0">
      <header className="exchange-card exchange-card-strong overflow-hidden p-0">
        <div className="relative px-5 py-5">
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-[linear-gradient(90deg,transparent,rgba(252,213,53,0.18),transparent)]" />
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-4">
              <button
                type="button"
                onClick={() => setImagePreview({ src: userLevelImage, title: userLevelLabel })}
                className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-[20px] border border-[var(--border-soft)] bg-[linear-gradient(180deg,#2a2f36_0%,#1b2026_100%)] shadow-[0_0_24px_rgba(255,255,255,0.05)] transition hover:scale-[1.02]"
                aria-label={`Preview ${userLevelLabel}`}
              >
                <img src={userLevelImage} alt={userLevelLabel} className="h-full w-full object-cover" />
              </button>
              <div className="space-y-1">
                <div className="micro-label">Profile Level</div>
                <h1 className="text-[1.28rem] font-extrabold text-white sm:text-[1.55rem]">{userLevelLabel}</h1>
                <p className="max-w-2xl text-[12px] text-[var(--text-secondary)] sm:text-[13px]">
                  Rank {Number(user?.currentLevelRank ?? 0) || 0} level with your current account standing.
                </p>
              </div>
            </div>            
          </div>
        </div>
      </header>

      <section className="grid gap-4 lg:grid-cols-[minmax(0,1.45fr)_minmax(300px,0.75fr)]">
        <div className={`${cardBaseCls} border-[rgba(252,213,53,0.18)] shadow-[0_20px_60px_rgba(252,213,53,0.08)]`}>
          <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--accent-yellow)]">Account Profile</div>
          <div className="mt-2 flex items-center gap-4">
            <button
              type="button"
              onClick={() => {
                if (profilePhotoPreviewSrc && !profilePhotoLoadError) {
                  setImagePreview({ src: profilePhotoPreviewSrc, title: `${profileDisplayName} profile photo` });
                }
              }}
              disabled={!profilePhotoPreviewSrc || profilePhotoLoadError}
              className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-full border border-[rgba(252,213,53,0.22)] bg-[rgba(252,213,53,0.08)] text-lg font-black text-[var(--accent-yellow)] transition hover:scale-[1.02] disabled:cursor-default disabled:hover:scale-100"
              aria-label="Preview profile photo"
            >
              {profilePhotoPreviewSrc && !profilePhotoLoadError ? (
                <img src={profilePhotoPreviewSrc} alt={profileDisplayName} className="h-full w-full object-cover" />
              ) : (
                profileInitial
              )}
            </button>
            <div className="min-w-0">
              <div className="truncate text-[1rem] font-bold text-white">{profileDisplayName}</div>
              <div className="truncate text-[12px] text-[var(--text-secondary)]">{user?.email ?? "demo@exchange.test"}</div>
            </div>
          </div>
          <div className="grid gap-3 pt-2 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs text-[var(--text-secondary)]">Email</label>
              <Input disabled value={user?.email ?? "demo@exchange.test"} className={settingsFieldClass} />
            </div>
            <div>
              <label className="mb-1 block text-xs text-[var(--text-secondary)]">Display Name</label>
              <Input value={user?.name ?? "Primerica Trader"} disabled className={settingsFieldClass} />
            </div>
          </div>         
        </div>


      </section>

      <section className={`${cardBaseCls} shadow-[0_20px_70px_-45px_rgba(56,189,248,0.3)]`}>
        <div className={sectionTitleClass}>Personal Information</div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="First Name" error={personalErrors.first_name}>
            <Input className={settingsFieldClass} value={personalInfo.first_name} onChange={(event) => onPersonalInfoChange("first_name", event.target.value)} />
          </Field>
          <Field label="Last Name" error={personalErrors.last_name}>
            <Input className={settingsFieldClass} value={personalInfo.last_name} onChange={(event) => onPersonalInfoChange("last_name", event.target.value)} />
          </Field>
          <Field label="Username" error={personalErrors.username}>
            <Input className={settingsFieldClass} value={personalInfo.username} disabled />
          </Field>
          <Field label="Mobile Number" error={personalErrors.mobile_number}>
            <Input className={settingsFieldClass} value={personalInfo.mobile_number} onChange={(event) => onPersonalInfoChange("mobile_number", event.target.value)} />
          </Field>
          <Field label="Country" error={personalErrors.country}>
            <CountrySelect
              value={selectedCountryCode}
              onChange={(code) => onPersonalInfoChange("country", getCountryByCode(code)?.name ?? "")}
              required
              disabled={profileLoading || personalSaving}
              className={settingsFieldClass}
            />
          </Field>
          <Field label="State / Province">
            <Input className={settingsFieldClass} value={personalInfo.state} onChange={(event) => onPersonalInfoChange("state", event.target.value)} />
          </Field>
          <Field label="City">
            <Input className={settingsFieldClass} value={personalInfo.city} onChange={(event) => onPersonalInfoChange("city", event.target.value)} />
          </Field>
          <Field label="Postal Code">
            <Input className={settingsFieldClass} value={personalInfo.postal_code} onChange={(event) => onPersonalInfoChange("postal_code", event.target.value)} />
          </Field>
          <Field label="Date of Birth">
            <SettingsDateField
              value={personalInfo.date_of_birth}
              onChange={(value) => onPersonalInfoChange("date_of_birth", value)}
            />
          </Field>
          <Field label="Gender">
            <select
              value={personalInfo.gender}
              onChange={(event) => onPersonalInfoChange("gender", event.target.value)}
              className={settingsSelectClass}
            >
              <option value="">Select gender</option>
              <option value="male">Male</option>
              <option value="female">Female</option>
              <option value="other">Other</option>
              <option value="prefer_not_to_say">Prefer not to say</option>
            </select>
          </Field>
          <Field label="Address Line 1">
            <textarea
              rows={3}
              value={personalInfo.address_line_1}
              onChange={(event) => onPersonalInfoChange("address_line_1", event.target.value)}
              className={settingsTextareaClass}
            />
          </Field>
          <Field label="Address Line 2">
            <textarea
              rows={3}
              value={personalInfo.address_line_2}
              onChange={(event) => onPersonalInfoChange("address_line_2", event.target.value)}
              className={settingsTextareaClass}
            />
          </Field>
          <Field
            label={
              <span className="inline-flex items-center gap-2">
                <FundingNetworkIcon network="tron" size="xs" />
                <span>Tron Address</span>
              </span>
            }
            error={personalErrors.withdraw_address_tron}
          >
            <Input
              className={settingsFieldClass}
              value={personalInfo.withdraw_address_tron}
              onChange={(event) => onPersonalInfoChange("withdraw_address_tron", event.target.value)}
              placeholder="Tron address"
            />
          </Field>
          <Field
            label={
              <span className="inline-flex items-center gap-2">
                <FundingNetworkIcon network="bsc" size="xs" />
                <span>BSC Address</span>
              </span>
            }
            error={personalErrors.withdraw_address_bsc}
          >
            <Input
              className={settingsFieldClass}
              value={personalInfo.withdraw_address_bsc}
              onChange={(event) => onPersonalInfoChange("withdraw_address_bsc", event.target.value)}
              placeholder="BSC address"
            />
          </Field>
          <Field
            label={
              <span className="inline-flex items-center gap-2">
                <FundingNetworkIcon network="ethereum" size="xs" />
                <span>Ethereum Address</span>
              </span>
            }
            error={personalErrors.withdraw_address_ethereum}
          >
            <Input
              className={settingsFieldClass}
              value={personalInfo.withdraw_address_ethereum}
              onChange={(event) => onPersonalInfoChange("withdraw_address_ethereum", event.target.value)}
              placeholder="Ethereum address"
            />
          </Field>
          {/* <div className="sm:col-span-2 rounded-xl border border-white/10 bg-white/5 p-3">
            <div className="text-[12px] font-medium text-white">Withdraw Address History</div>
            <div className="mt-1 text-[11px] text-slate-300/80">
              Current saved addresses appear in the withdraw form by network. Older saved addresses are shown below with date and time.
            </div>
            <div className="mt-3 space-y-2">
              {withdrawAddressHistory.length ? (
                withdrawAddressHistory.slice(0, 6).map((entry, index) => (
                  <div key={`${entry.network}-${entry.address}-${entry.savedAt}-${index}`} className="rounded-lg border border-white/10 bg-black/20 px-3 py-2">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#d9cfb3]">
                        {entry.network === "tron" ? "TRC20 / Tron" : entry.network === "bsc" ? "BEP20 / BSC" : "ERC20 / Ethereum"}
                      </div>
                      <div className="text-[10px] text-slate-400">
                        {new Date(entry.savedAt).toLocaleString()}
                      </div>
                    </div>
                    <div className="mt-1 break-all text-[11px] text-white/90">{entry.address}</div>
                  </div>
                ))
              ) : (
                <div className="text-[11px] text-slate-400">No saved withdraw address history yet.</div>
              )}
            </div>
          </div> */}
          <div className="sm:col-span-2">
            <label className="text-xs text-slate-300/80 block mb-1">Profile Photo</label>
            <input
              type="file"
              accept="image/*"
              onChange={(event) => void handleProfilePhotoChange(event)}
              className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-100 file:mr-3 file:rounded-lg file:border-0 file:bg-indigo-500/20 file:px-3 file:py-2 file:text-sm file:text-white"
            />
            {personalErrors.profile_photo && <div className="mt-1 text-xs text-rose-300">{personalErrors.profile_photo}</div>}
            {profilePhotoPreviewSrc && !profilePhotoLoadError && (
              <button
                type="button"
                onClick={() => setImagePreview({ src: profilePhotoPreviewSrc, title: `${profileDisplayName} profile photo` })}
                className="mt-3 block overflow-hidden rounded-xl border border-white/10 transition hover:scale-[1.02]"
                aria-label="Open profile photo preview"
              >
                <img
                  src={profilePhotoPreviewSrc}
                  alt="Profile preview"
                  className="h-20 w-20 object-cover"
                  onError={() => setProfilePhotoLoadError(true)}
                />
              </button>
            )}
            {profilePhotoPreviewSrc && profilePhotoLoadError && (
              <div className="mt-3 rounded-xl border border-amber-400/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
                Profile photo could not be loaded. The stored path may be missing or inaccessible.
              </div>
            )}
          </div>
        </div>
        <InlineFeedback feedback={personalFeedback} className="text-[11px]" />
        <Button size="sm" className="w-fit" onClick={() => void handleSavePersonalInfo()} disabled={personalSaving || profileLoading}>
          {personalSaving ? "Saving..." : "Save Personal Information"}
        </Button>
      </section>

      <section className={`${cardBaseCls} shadow-[0_20px_70px_-45px_rgba(56,189,248,0.3)]`}>
        <div className={sectionTitleClass}>Security</div>
        <ToggleRow
          label="Two-factor authentication"
          description="Secure this account with Google Authenticator. Scan the QR code, verify the 6-digit code, and use the app during login."
          enabled={twoFactorEnabled}
          onToggle={() => void handleToggleTwoFactor()}
          disabled={twoFactorBusy}
        />
        {twoFactorSetup ? (
          <div className="rounded-xl border border-white/10 bg-white/5 p-3">
            <div className="mb-3 text-[12px] font-medium text-white">Google Authenticator Setup</div>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
              <div className="flex h-36 w-36 items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-white p-2">
                <img src={twoFactorSetup.qrCode} alt="Google Authenticator QR code" className="h-full w-full object-contain" />
              </div>
              <div className="min-w-0 flex-1 space-y-3">
                <div className="text-[11px] text-slate-300/80">
                  Scan this QR code with Google Authenticator. If scanning is unavailable, use the manual setup key below.
                </div>
                <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="text-[10px] uppercase tracking-[0.16em] text-slate-400">Manual setup key</div>
                      <div className="mt-1 break-all pr-1 text-[12px] font-semibold text-white">{twoFactorSetup.secret}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleCopySecret()}
                      className="inline-flex h-9 min-w-9 shrink-0 items-center justify-center rounded-[12px] border border-white/10 bg-white/5 text-[#d9cfb3] transition hover:border-white/20 hover:bg-white/10"
                      aria-label={secretCopied ? "Manual setup key copied" : "Copy manual setup key"}
                      title={secretCopied ? "Copied" : "Copy"}
                    >
                      <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="currentColor" aria-hidden="true">
                        <path d="M8 7a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-8a2 2 0 0 1-2-2V7Zm-4 4a2 2 0 0 1 2-2v8a4 4 0 0 0 4 4h6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-10Z" />
                      </svg>
                    </button>
                  </div>
                  <div className="mt-2 text-[10px] font-medium text-[#d9cfb3]">{secretCopied ? "Copied to clipboard" : "Tap the icon to copy"}</div>
                </div>
                <Input
                  className={settingsFieldClass}
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="Enter 6-digit code"
                  value={twoFactorCode}
                  onChange={(event) => setTwoFactorCode(event.target.value.replace(/\D/g, ""))}
                />
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" className="w-fit" onClick={() => void handleEnableGoogleAuth()} disabled={twoFactorBusy}>
                    {twoFactorBusy ? "Verifying..." : "Enable Google Authenticator"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="w-fit"
                    onClick={() => {
                      setTwoFactorSetup(null);
                      setTwoFactorCode("");
                      setSecurityFeedback(null);
                    }}
                    disabled={twoFactorBusy}
                  >
                    Cancel setup
                  </Button>
                </div>
              </div>
            </div>
          </div>
        ) : null}
        <InlineFeedback feedback={securityFeedback} className="text-[11px]" />
        {twoFactorEnabled && googleAuthConfigured ? (
          <div className="rounded-xl border border-white/10 bg-white/5 p-3">
            <div className="mb-2 text-[12px] font-medium text-white">Disable Google Authenticator</div>
            <div className="text-[11px] text-slate-300/80">
              Enter your current authenticator code to remove Google Authenticator from this account.
            </div>
            <div className="mt-3 flex flex-col gap-3 sm:flex-row">
              <Input
                className={settingsFieldClass}
                inputMode="numeric"
                maxLength={6}
                placeholder="Current 6-digit code"
                value={twoFactorCode}
                onChange={(event) => setTwoFactorCode(event.target.value.replace(/\D/g, ""))}
              />
              <Button size="sm" className="w-fit" onClick={() => void handleDisableGoogleAuth()} disabled={twoFactorBusy}>
                {twoFactorBusy ? "Disabling..." : "Disable"}
              </Button>
            </div>
          </div>
        ) : null}
        {/* <ToggleRow
          label="Mask API key values"
          description="This only hides API key text on screen so people nearby cannot read it easily. It does not change or secure the key itself."
          enabled={apiKeyMask}
          onToggle={() => setApiKeyMask((state) => !state)}
        /> */}
        {/* {securityFeedback ? <div className="text-[11px] text-slate-300/80">{securityFeedback}</div> : null}
        <Button disabled className="w-fit opacity-60" variant="secondary">
          Generate Key
        </Button> */}
        <div className="rounded-xl border border-white/10 bg-white/5 p-3">
          <div className="mb-3 text-[12px] font-medium text-white">Change Password</div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Current Password" error={passwordErrors.currentPassword}>
              <Input
                type="password"
                className={settingsFieldClass}
                value={passwordForm.currentPassword}
                onChange={(event) => onPasswordFormChange("currentPassword", event.target.value)}
              />
            </Field>
            <Field label="New Password" error={passwordErrors.newPassword}>
              <Input
                type="password"
                className={settingsFieldClass}
                value={passwordForm.newPassword}
                onChange={(event) => onPasswordFormChange("newPassword", event.target.value)}
              />
            </Field>
            <Field label="Confirm New Password" error={passwordErrors.confirmPassword}>
              <Input
                type="password"
                className={settingsFieldClass}
                value={passwordForm.confirmPassword}
                onChange={(event) => onPasswordFormChange("confirmPassword", event.target.value)}
              />
            </Field>
          </div>
          <InlineFeedback feedback={passwordFeedback} className="mt-2 text-[11px]" />
          <div className="mt-3">
            <Button size="sm" className="w-fit" onClick={() => void handleChangePassword()} disabled={passwordSaving}>
              {passwordSaving ? "Updating..." : "Reset Password"}
            </Button>
          </div>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-[12px] font-medium text-white">KYC Verification</div>
              <div className={bodyCopyClass}>Complete or review your verification details from the compliance center.</div>
            </div>
            <Link
              to="/app/kyc"
              className="inline-flex items-center justify-center rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-[12px] font-medium text-white transition hover:border-white/20 hover:bg-white/10"
            >
              Open KYC
            </Link>
          </div>
        </div>
      </section>


      <section className={`${cardBaseCls} shadow-[0_20px_70px_-45px_rgba(79,70,229,0.35)]`}>
        <div className={sectionTitleClass}>Interface</div>
        {/* <ToggleRow
          label="Dark mode"
          description="Toggle Tailwind dark styles. This demo remembers your preference locally."
          enabled={darkMode}
          onToggle={() => setDarkMode((state) => !state)}
        /> */}
        {/* <div className="grid gap-3 text-[12px] sm:grid-cols-2">
          <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-3">
            <div className="text-[11px] uppercase text-slate-300/80">Default trading pair</div>
            <div className="font-semibold text-white">BTC / USDT</div>
            <div className="mt-1 text-[11px] text-slate-300/80">
              Update this in a backend store to persist user preferences.
            </div>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-3">
            <div className="text-[11px] uppercase text-slate-300/80">Language</div>
            <div className="font-semibold text-white">English</div>
            <div className="mt-1 text-[11px] text-slate-300/80">
              Localisation scaffolding is ready—wire translations to enable other locales.
            </div>
          </div>
        </div> */}

        <section className="rounded-[22px] border border-[rgba(246,70,93,0.24)] bg-[linear-gradient(180deg,rgba(246,70,93,0.12)_0%,rgba(24,18,22,0.95)_100%)] p-4 shadow-[0_18px_50px_rgba(246,70,93,0.1)]">
          <div className="text-[11px] uppercase tracking-[0.18em] text-[rgba(255,210,218,0.78)]">Delete My Account</div>
          <div className="mt-2 text-[1rem] font-bold text-white">Danger zone</div>
          <p className="mt-2 text-[12px] leading-5 text-[rgba(255,226,230,0.82)]">
            Permanently remove your profile, balances, orders, trade history, and KYC data. This action cannot be undone.
          </p>
          <InlineFeedback feedback={deleteFeedback} className="mt-3 text-[11px]" />
          <div className="mt-4">
            <Button variant="danger" size="sm" className="w-full sm:w-auto" onClick={() => setDeleteDialogOpen(true)} disabled={deletePending}>
              {deletePending ? "Deleting..." : "Delete my account"}
            </Button>
          </div>
        </section>
      </section>

      <Dialog
        open={deleteDialogOpen}
        onClose={deletePending ? () => {} : () => setDeleteDialogOpen(false)}
        title="Delete my account"
        panelClassName="max-w-[28rem] p-5 sm:p-6"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setDeleteDialogOpen(false)} disabled={deletePending}>
              Cancel
            </Button>
            <Button variant="danger" size="sm" onClick={() => void handleDeleteMyAccount()} disabled={deletePending}>
              {deletePending ? "Deleting..." : "Confirm delete"}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="rounded-[16px] border border-[rgba(246,70,93,0.2)] bg-[rgba(246,70,93,0.1)] px-4 py-3 text-[13px] leading-6 text-[rgba(255,226,230,0.9)]">
            This will permanently remove your profile, balances, orders, trade history, and KYC data.
          </div>
          <p className="text-[13px] text-[var(--text-secondary)]">
            This action cannot be undone. If you continue, you will be signed out immediately.
          </p>
          <InlineFeedback feedback={deleteFeedback} className="text-xs" />
        </div>
      </Dialog>

      <Dialog
        open={Boolean(imagePreview)}
        onClose={() => setImagePreview(null)}
        title={imagePreview?.title ?? "Image Preview"}
        panelClassName="max-w-3xl"
      >
        {imagePreview ? (
          <div className="flex flex-col items-center gap-4">
            <div className="flex max-h-[75vh] w-full items-center justify-center overflow-auto rounded-[24px] border border-white/10 bg-black/30 p-4">
              <img src={imagePreview.src} alt={imagePreview.title} className="max-h-[68vh] w-auto max-w-full rounded-[18px] object-contain" />
            </div>
          </div>
        ) : null}
      </Dialog>
    </div>
  );
}

function Field({
  label,
  children,
  error,
}: {
  label: ReactNode;
  children: ReactNode;
  error?: string;
}) {
  return (
    <div>
      <label className="text-xs text-slate-300/80 block mb-1">{label}</label>
      {children}
      {error && <div className="mt-1 text-xs text-rose-300">{error}</div>}
    </div>
  );
}

function SettingsDateField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const inputId = useId();
  const displayValue = formatSettingsDateValue(value);

  return (
    <div className="relative min-w-0 overflow-hidden rounded-[10px] border border-[rgba(148,163,184,0.26)] bg-[var(--bg-input)] shadow-[inset_0_1px_0_rgba(255,255,255,0.02)] transition focus-within:border-[rgba(255,255,255,0.8)] focus-within:shadow-[0_0_0_3px_rgba(255,255,255,0.08)]">
      <div className={`pointer-events-none flex h-10 items-center px-3 text-sm ${displayValue ? "text-white" : "text-[var(--text-muted)]"}`}>
        {displayValue || "Select date of birth"}
      </div>
      <input
        id={inputId}
        type="date"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-label="Date of Birth"
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
      />
    </div>
  );
}

function formatSettingsDateValue(value?: string) {
  if (!value) return "";
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}

type ToggleRowProps = {
  label: string;
  description: string;
  enabled: boolean;
  onToggle: () => void;
  disabled?: boolean;
};

function ToggleRow({
  label,
  description,
  enabled,
  onToggle,
  disabled = false,
}: ToggleRowProps) {
  return (
    <div className="flex flex-col gap-2 border border-white/10 bg-white/5 rounded-xl px-3 py-2 backdrop-blur">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-[12px] font-medium text-white">{label}</div>
        <button
          type="button"
          onClick={disabled ? undefined : onToggle}
          className={`w-12 h-6 rounded-full transition ${
            enabled
              ? "bg-indigo-500"
              : "bg-white/20"
          } ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
        >
          <span
            className={`block w-5 h-5 bg-white rounded-full shadow-lg shadow-indigo-500/20 transform transition translate-y-0.5 ${
              enabled ? "translate-x-6" : "translate-x-1"
            }`}
          />
        </button>
      </div>
      <div className="text-[11px] text-slate-300/80">{description}</div>
    </div>
  );
}
