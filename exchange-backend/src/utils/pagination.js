export function pageParams(q) {
const limit = Math.min(1000, Math.max(1, Number(q.limit || 50)));
const offset = Math.max(0, Number(q.offset || 0));
return { limit, offset };
}