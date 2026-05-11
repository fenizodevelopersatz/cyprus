import api from "../../../app/axios";
import { API_ROUTES } from "../../../app/apiRoutes";

type ApiEnvelope<T> = { data: T };
const unwrap = <T,>(payload: T | ApiEnvelope<T>): T => (payload && typeof payload === "object" && "data" in payload ? (payload as ApiEnvelope<T>).data : payload as T);
const asRecord = (value: unknown): Record<string, unknown> => (value && typeof value === "object" ? (value as Record<string, unknown>) : {});
const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const asStringOrNumber = (value: unknown): string | number | null => (
  typeof value === "string" || typeof value === "number" ? value : null
);

export type OrdersAuditSummary = {
  totalSignalIncome: number;
  totalDirectIncome: number;
  totalJoinedIncome: number;
  totalLevelIncome: number;
  totalCombinedIncome: number;
};

export type OrdersAuditRow = {
  id: string | number;
  txn_id: string;
  order_id?: string | null;
  incomeType: string;
  incomeTypeLabel: string;
  timestamp: string;
  sourceUser?: string | null;
  sourceUserEmail?: string | null;
  sourceUserName?: string | null;
  sourceUserLabel?: string | null;
  level?: string | null;
  reference_id?: string | number | null;
  referenceDetails?: string | null;
  orderRefId?: string | number | null;
  amount: number;
  status: string;
  signal_token?: string | null;
  batch_token?: string | null;
};

export type Paginated<T> = {
  items: T[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
};

function mapRow(rawValue: unknown): OrdersAuditRow {
  const raw = asRecord(rawValue);
  return {
    id: raw.id as string | number,
    txn_id: String(raw.txn_id ?? ""),
    order_id: raw.order_id ? String(raw.order_id) : null,
    incomeType: String(raw.incomeType ?? ""),
    incomeTypeLabel: String(raw.incomeTypeLabel ?? raw.incomeType ?? ""),
    timestamp: String(raw.timestamp ?? raw.createdAt ?? ""),
    sourceUser: raw.sourceUser ? String(raw.sourceUser) : null,
    sourceUserEmail: raw.sourceUserEmail ? String(raw.sourceUserEmail) : raw.source_user_email ? String(raw.source_user_email) : null,
    sourceUserName: raw.sourceUserName ? String(raw.sourceUserName) : raw.source_user_name ? String(raw.source_user_name) : null,
    sourceUserLabel: raw.sourceUserLabel ? String(raw.sourceUserLabel) : raw.source_user_label ? String(raw.source_user_label) : null,
    level: raw.level ? String(raw.level) : null,
    reference_id: asStringOrNumber(raw.reference_id),
    referenceDetails: raw.referenceDetails ? String(raw.referenceDetails) : null,
    orderRefId: asStringOrNumber(raw.orderRefId),
    amount: Number(raw.amount ?? 0),
    status: String(raw.status ?? "SUCCESS"),
    signal_token: raw.signal_token ? String(raw.signal_token) : null,
    batch_token: raw.batch_token ? String(raw.batch_token) : null,
  };
}

export async function fetchOrdersAuditSummary(): Promise<OrdersAuditSummary> {
  const { data } = await api.get(API_ROUTES.user.ordersAuditSummary);
  const raw = asRecord(unwrap(data));
  return {
    totalSignalIncome: Number(raw.totalSignalIncome ?? 0),
    totalDirectIncome: Number(raw.totalDirectIncome ?? 0),
    totalJoinedIncome: Number(raw.totalJoinedIncome ?? 0),
    totalLevelIncome: Number(raw.totalLevelIncome ?? 0),
    totalCombinedIncome: Number(raw.totalCombinedIncome ?? 0),
  };
}

export async function fetchOrdersAudit(params?: {
  page?: number;
  limit?: number;
  incomeType?: string;
  search?: string;
  fromDate?: string;
  toDate?: string;
}): Promise<Paginated<OrdersAuditRow>> {
  const qs = new URLSearchParams();
  if (params?.page) qs.set("page", String(params.page));
  if (params?.limit) qs.set("limit", String(params.limit));
  if (params?.incomeType) qs.set("incomeType", params.incomeType);
  if (params?.search) qs.set("search", params.search);
  if (params?.fromDate) qs.set("fromDate", params.fromDate);
  if (params?.toDate) qs.set("toDate", params.toDate);
  const { data } = await api.get(`${API_ROUTES.user.ordersAudit}${qs.toString() ? `?${qs.toString()}` : ""}`);
  const raw = asRecord(unwrap(data));
  const pagination = asRecord(raw.pagination);
  return {
    items: asArray(raw.items).map(mapRow),
    pagination: {
      page: Number(pagination.page ?? 1),
      limit: Number(pagination.limit ?? 20),
      total: Number(pagination.total ?? 0),
      totalPages: Number(pagination.totalPages ?? 0),
    },
  };
}
