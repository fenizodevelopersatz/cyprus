import { useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import Button from "../../../ui/Button";
import Input from "../../../ui/Input";
import { fetchAdminUsers, type AdminUser } from "../api/admin.api";

const cardCls = "rounded-2xl border border-white/10 bg-white/5 p-4 shadow-[0_20px_60px_-35px_rgba(0,0,0,0.55)]";

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-white/5 py-3 text-sm last:border-b-0">
      <div className="text-slate-400">{label}</div>
      <div className="max-w-[65%] break-words text-right text-white">{value || "—"}</div>
    </div>
  );
}

export default function AdminUserLookupPage() {
  const [searchInput, setSearchInput] = useState("");
  const [email, setEmail] = useState("");

  const query = useQuery({
    queryKey: ["admin", "hidden-user-lookup", email],
    queryFn: () => fetchAdminUsers({ search: email, page: 1, limit: 25 }),
    enabled: Boolean(email.trim()),
  });

  const matchedUser = (query.data?.items ?? []).find(
    (item) => String(item.email || "").trim().toLowerCase() === email.trim().toLowerCase()
  );

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    setEmail(searchInput.trim());
  };

  return (
    <div className="space-y-6">
      <div>
        <div className="text-xs uppercase tracking-[0.32em] text-slate-400">Admin Internal</div>
        <h1 className="mt-2 text-3xl font-semibold text-white">User Lookup</h1>
        <p className="mt-2 max-w-2xl text-sm text-slate-400">
          Admin-only lookup for stored user profile details. This page intentionally does not expose password hashes or any credential secrets.
        </p>
      </div>

      <form onSubmit={handleSubmit} className={`${cardCls} flex flex-col gap-3 sm:flex-row sm:items-end`}>
        <div className="flex-1">
          <label className="mb-2 block text-xs uppercase tracking-[0.2em] text-slate-400">Email</label>
          <Input
            type="email"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="user@example.com"
            className="!border-white/10"
          />
        </div>
        <Button type="submit" className="sm:min-w-[160px]">
          Find User
        </Button>
      </form>

      {query.isFetching ? (
        <div className={`${cardCls} text-sm text-slate-300`}>Loading user details...</div>
      ) : null}

      {email && !query.isFetching && !matchedUser ? (
        <div className={`${cardCls} text-sm text-amber-200`}>No user matched `{email}`.</div>
      ) : null}

      {matchedUser ? <UserDetailCard user={matchedUser} /> : null}
    </div>
  );
}

function UserDetailCard({ user }: { user: AdminUser }) {
  return (
    <section className={cardCls}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-[0.24em] text-slate-400">User Record</div>
          <div className="mt-1 text-xl font-semibold text-white">{user.displayName || user.name || user.email}</div>
        </div>
        <div className="rounded-full border border-emerald-400/20 bg-emerald-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-emerald-200">
          Admin Only
        </div>
      </div>

      <DetailRow label="User ID" value={String(user.id)} />
      <DetailRow label="Email" value={String(user.email || "")} />
      <DetailRow label="Display Name" value={String(user.displayName || user.name || "")} />
      <DetailRow label="Country" value={String(user.country || "")} />
      <DetailRow label="Status" value={String(user.status || "")} />
      <DetailRow label="Tier" value={String(user.tier || "")} />
      <DetailRow label="Roles" value={Array.isArray(user.roles) && user.roles.length ? user.roles.join(", ") : ""} />
      <DetailRow label="Has Password" value={user.hasPassword ? "Yes" : "No"} />
      <DetailRow label="Password Changed" value={String(user.passwordChangedAt || "")} />
      <DetailRow label="Google Linked" value={user.googleAuthConfigured ? "Yes" : "No"} />
      <DetailRow label="Two-Factor Enabled" value={user.twoFactorEnabled ? "Yes" : "No"} />
      <DetailRow label="KYC Verified" value={user.kycVerified ? "Yes" : "No"} />
      <DetailRow label="KYC Level" value={user.kycLevel !== null && user.kycLevel !== undefined ? String(user.kycLevel) : ""} />
      <DetailRow label="Current Level" value={String(user.currentLevelCode || "")} />
      <DetailRow label="Current Level Rank" value={user.currentLevelRank !== null && user.currentLevelRank !== undefined ? String(user.currentLevelRank) : ""} />
      <DetailRow label="Created At" value={String(user.createdAt || "")} />
      <DetailRow label="Last Active At" value={String(user.lastActiveAt || "")} />
    </section>
  );
}
