// src/app/routes.tsx
import { Routes, Route, Navigate } from "react-router-dom";

import Login from "../features/auth/pages/Login";
import ForgotPassword from "../features/auth/pages/ForgotPassword";
import Register from "../features/auth/pages/Register";
import TwoFactor from "../features/auth/pages/TwoFactor";
import GoogleAuthComplete from "../features/auth/pages/GoogleAuthComplete";
import InviteRedirectPage from "../features/referrals/pages/InviteRedirectPage";

import Dashboard from "../features/dashboard/pages/Dashboard";
import Exchange from "../features/exchange/pages/Exchange";
import SwapPage from "../features/swap/pages/SwapPage";
import FuturesPage from "../features/futures/pages/FuturesPage";
import P2PPage from "../features/p2p/pages/P2PPage";

import MarketsPage from "../features/markets/pages/MarketsPage";
import OrdersPage from "../features/orders/pages/OrdersPage";
import PortfolioPage from "../features/portfolio/pages/PortfolioPage";
import FundingPage from "../features/funding/pages/FundingPage";
import StakingPage from "../features/staking/pages/StakingPage";
import SipPage from "../features/sip/pages/SipPage";
import SettingsPage from "../features/settings/pages/SettingsPage";
import PaperTrade from "../features/paper/pages/PaperTrade";
import RealtimeHub from "../features/realtime/pages/RealtimeHub";
import SignalPlayground from "../features/realtime/pages/SignalPlayground";
import KycCenter from "../features/kyc/pages/KycCenter";
import ReferralsPage from "../features/referrals/pages/ReferralsPage";
import CampaignSettingsPage from "../features/referrals/pages/CampaignSettingsPage";
import SupportPage from "../features/support/pages/SupportPage";

import AppShell from "./AppShell";
import { Protected, PublicOnly } from "./guards";
import AdminProtected from "../features/admin/components/AdminProtected";
import { AdminAuthProvider } from "../features/admin/state/AdminAuthProvider";
import AdminShell from "../features/admin/layout/AdminShell";
import AdminLoginPage from "../features/admin/pages/AdminLoginPage";
import AdminDashboardPage from "../features/admin/pages/AdminDashboardPage";
import AdminUsersPage from "../features/admin/pages/AdminUsersPage";
import AdminWithdrawalsPage from "../features/admin/pages/AdminWithdrawalsPage";
import AdminDepositsPage from "../features/admin/pages/AdminDepositsPage";
import AdminTreasuryPage from "../features/admin/pages/AdminTreasuryPage";
import UserWalletDepositsPage from "../features/admin/pages/UserWalletDepositsPage";
import UserWalletWithdrawListPage from "../features/admin/pages/UserWalletWithdrawListPage";
import AdminWalletDepositsPage from "../features/admin/pages/AdminWalletDepositsPage";
import AdminGasFundingPage from "../features/admin/pages/AdminGasFundingPage";
import AdminWalletWithdrawQueuePage from "../features/admin/pages/AdminWalletWithdrawQueuePage";
import AdminFuturesOpsPage from "../features/admin/pages/AdminFuturesOpsPage";
import AdminMarketsPage from "../features/admin/pages/AdminMarketsPage";
import AdminAuditPage from "../features/admin/pages/AdminAuditPage";
import AdminSettingsPage from "../features/admin/pages/AdminSettingsPage";
import AdminOrdersReportPage from "../features/admin/pages/AdminOrdersReportPage";
import AdminKycPage from "../features/admin/pages/AdminKycPage";
import AdminStakingPage from "../features/admin/pages/AdminStakingPage";
import AdminSipPage from "../features/admin/pages/AdminSipPage";
import AdminAssetsPage from "../features/admin/pages/AdminAssetsPage";
import AdminSignalPackagesPage from "../features/admin/pages/AdminSignalPackagesPage";
import AdminManageSignalsPage from "../features/admin/pages/AdminManageSignalsPage";
import AdminSignalHistoryPage from "../features/admin/pages/AdminSignalHistoryPage";
import AdminCommissionHistoryPage from "../features/admin/pages/AdminCommissionHistoryPage";
import LevelManagementSettings from "../features/admin/pages/LevelManagementSettings";
import AdminMlmTestToolPage from "../features/admin/pages/AdminMlmTestToolPage";
import AdminUserLookupPage from "../features/admin/pages/AdminUserLookupPage";
import AdminReferralUsersPage from "../features/admin/pages/AdminReferralUsersPage";
import AdminReferralDetailPage from "../features/admin/pages/AdminReferralDetailPage";

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<PublicOnly />}>
        {/* Default public entry */}
        <Route path="/" element={<Navigate to="/login" replace />} />
        <Route path="/login" element={<Login />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/register" element={<Register />} />
      </Route>

      {/* Public */}
      <Route path="/invite/:code" element={<InviteRedirectPage />} />
      <Route path="/two-factor" element={<TwoFactor />} />
      <Route path="/auth/google/complete" element={<GoogleAuthComplete />} />
      <Route
        path="/admin/login"
        element={
          <AdminAuthProvider>
            <AdminLoginPage />
          </AdminAuthProvider>
        }
      />

      {/* Protected app */}
      <Route element={<Protected />}>
        <Route element={<AppShell />}>
          <Route path="/app" element={<Dashboard />} />
          <Route path="/app/markets" element={<MarketsPage />} />
          <Route path="/app/exchange" element={<Exchange />} />
          <Route path="/app/swap" element={<SwapPage />} />
          <Route path="/app/futures" element={<FuturesPage />} />
          <Route path="/app/p2p" element={<P2PPage />} />
          <Route path="/app/orders" element={<OrdersPage />} />
          <Route path="/app/orders-audit" element={<OrdersPage />} />
          <Route path="/app/portfolio" element={<PortfolioPage />} />
          <Route path="/app/funding" element={<FundingPage />} />
          <Route path="/app/staking" element={<StakingPage />} />
          <Route path="/app/sip" element={<SipPage />} />
          <Route path="/app/paper" element={<PaperTrade />} />
          <Route path="/app/realtime" element={<RealtimeHub />} />
          <Route path="/app/signal-lab" element={<SignalPlayground />} />
          <Route path="/app/kyc" element={<KycCenter />} />
          <Route path="/app/referrals" element={<ReferralsPage />} />
          <Route path="/app/referrals/settings" element={<CampaignSettingsPage />} />
          <Route path="/app/support" element={<SupportPage />} />
          <Route path="/app/settings" element={<SettingsPage />} />
        </Route>
      </Route>

      {/* Admin */}
      <Route
        element={
          <AdminAuthProvider>
            <AdminProtected />
          </AdminAuthProvider>
        }
      >
        <Route element={<AdminShell />}>
          <Route path="/admin" element={<AdminDashboardPage />} />
          <Route path="/admin/users" element={<AdminUsersPage />} />
          <Route path="/admin/deposits" element={<AdminDepositsPage />} />
          <Route path="/admin/treasury" element={<AdminTreasuryPage />} />
          <Route path="/admin/withdrawals" element={<AdminWithdrawalsPage />} />
          <Route path="/admin/wallet-management/user-wallet/deposits" element={<UserWalletDepositsPage />} />
          <Route path="/admin/wallet-management/user-wallet/withdrawals" element={<UserWalletWithdrawListPage />} />
          <Route path="/admin/wallet-management/admin-wallet/deposits" element={<AdminWalletDepositsPage />} />
          <Route path="/admin/wallet-management/admin-wallet/gas-funding" element={<AdminGasFundingPage />} />
          <Route path="/admin/wallet-management/admin-wallet/withdraw-queue" element={<AdminWalletWithdrawQueuePage />} />
          <Route path="/admin/futures" element={<AdminFuturesOpsPage />} />
          <Route path="/admin/markets" element={<AdminMarketsPage />} />
          <Route path="/admin/audit" element={<AdminAuditPage />} />
          <Route path="/admin/settings" element={<AdminSettingsPage />} />
          <Route path="/admin/orders-report" element={<AdminOrdersReportPage />} />
          <Route path="/admin/staking" element={<AdminStakingPage />} />
          <Route path="/admin/kyc" element={<AdminKycPage />} />
          <Route path="/admin/sip" element={<AdminSipPage />} />
          <Route path="/admin/assets" element={<AdminAssetsPage />} />
          <Route path="/admin/controls/level-management" element={<LevelManagementSettings />} />
          <Route path="/admin/controls/mlm-test-tool" element={<AdminMlmTestToolPage />} />
          <Route path="/admin/package-settings" element={<AdminSignalPackagesPage />} />
          <Route path="/admin/manage-signals" element={<AdminManageSignalsPage />} />
          <Route path="/admin/commission/history" element={<AdminCommissionHistoryPage />} />
          <Route path="/admin/signal-history" element={<AdminSignalHistoryPage />} />
          <Route path="/admin/referrals" element={<AdminReferralUsersPage />} />
          <Route path="/admin/referrals/:userId" element={<AdminReferralDetailPage />} />
          <Route path="/admin/internal/user-lookup" element={<AdminUserLookupPage />} />
        </Route>
      </Route>

      {/* 404 -> login */}
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}
