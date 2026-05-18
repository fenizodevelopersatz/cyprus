import { useMemo, useState } from "react";
import type { FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import Button from "../../../ui/Button";
import { fetchAdminUsers } from "../api/admin.api";

export default function AdminReferralUsersPage() {
  const navigate = useNavigate();
  const [searchInput, setSearchInput] = useState("");
  const [filters, setFilters] = useState({ search: "", page: 1, limit: 20 });

  const usersQuery = useQuery({
    queryKey: ["admin", "referrals", "users", filters],
    queryFn: () =>
      fetchAdminUsers({
        search: filters.search || undefined,
        page: filters.page,
        limit: filters.limit,
      }),
  });

  const items = useMemo(
    () =>
      (usersQuery.data?.items ?? []).filter((user) =>
        !(user.roles ?? []).some((role) => String(role).trim().toLowerCase() === "admin")
      ),
    [usersQuery.data?.items]
  );

  const meta = usersQuery.data?.meta;

  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    setFilters((prev) => ({ ...prev, search: searchInput.trim(), page: 1 }));
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center gap-4">
        <div>
          <div className="text-xs uppercase tracking-[0.3em] text-slate-400">Admin Referrals</div>
          <h2 className="text-2xl font-semibold text-white">Referral User Directory</h2>
          <p className="mt-2 max-w-2xl text-sm text-slate-400">
            Open any user referral hub and review their MLM level, wallet balance, member growth, income ledger, and payout history.
          </p>
        </div>
        <form onSubmit={submitSearch} className="ml-auto flex gap-2">
          <input
            className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white focus:border-emerald-400/60 focus:outline-none"
            placeholder="Search name or email"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
          />
          <Button type="submit" size="sm">
            Search
          </Button>
        </form>
      </header>

      <section className="rounded-3xl border border-white/10 bg-white/5 p-4 shadow-[0_25px_80px_-45px_rgba(37,99,235,0.28)]">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="text-sm text-slate-400">
            {usersQuery.isFetching ? "Loading users..." : `${meta?.total ?? items.length} users found`}
          </div>
          <div className="text-xs text-slate-500">
            Page {meta?.page ?? filters.page} of {meta?.totalPages ?? 1}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1180px] text-sm">
            <thead className="text-left text-xs uppercase tracking-[0.22em] text-slate-400">
              <tr>
                <th className="pb-3">User</th>
                <th className="pb-3">Email</th>
                <th className="pb-3">Wallet Balance</th>
                <th className="pb-3">Members</th>
                <th className="pb-3">Downline</th>
                <th className="pb-3">Level</th>
                <th className="pb-3">Eligible Level</th>
                <th className="pb-3">Status</th>
                <th className="pb-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {items.map((user) => (
                <tr key={String(user.id)} className="transition hover:bg-white/5">
                  <td className="py-3">
                    <div className="flex items-center gap-3">
                      {user.profilePhoto ? (
                        <img src={user.profilePhoto} alt={user.displayName || user.email} className="h-10 w-10 rounded-2xl object-cover" />
                      ) : (
                        <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-sm font-semibold text-slate-200">
                          {String(user.displayName || user.name || user.email || "U").slice(0, 1).toUpperCase()}
                        </div>
                      )}
                      <div>
                        <div className="font-medium text-white">{user.displayName || user.name || "Unnamed user"}</div>
                        <div className="text-xs text-slate-500">User #{user.id}</div>
                      </div>
                    </div>
                  </td>
                  <td className="py-3 text-slate-300">{user.email}</td>
                  <td className="py-3 text-slate-200">{formatUsd(user.mainWalletBalance ?? 0)}</td>
                  <td className="py-3 text-slate-300">{user.activeDirectCount ?? 0}</td>
                  <td className="py-3 text-slate-300">{user.activeTeamCount ?? 0}</td>
                  <td className="py-3 text-slate-300">{user.currentLevelCode || `Lv${Number(user.currentLevelRank || 0)}`}</td>
                  <td className="py-3 text-slate-300">{user.currentEligibleLevelCode || "-"}</td>
                  <td className="py-3">
                    <span className="rounded-full bg-emerald-500/15 px-3 py-1 text-xs text-emerald-200">
                      {user.status || "unknown"}
                    </span>
                  </td>
                  <td className="py-3 text-right">
                    <Button size="sm" onClick={() => navigate(`/admin/referrals/${user.id}`)}>
                      Open Referral Hub
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <Button
            size="sm"
            variant="ghost"
            disabled={filters.page <= 1}
            onClick={() => setFilters((prev) => ({ ...prev, page: Math.max(1, prev.page - 1) }))}
          >
            Previous
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={(meta?.page ?? filters.page) >= (meta?.totalPages ?? 1)}
            onClick={() => setFilters((prev) => ({ ...prev, page: prev.page + 1 }))}
          >
            Next
          </Button>
        </div>
      </section>
    </div>
  );
}

function formatUsd(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(Number(value || 0));
}
