import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ReferralDashboard } from "../api/referrals.api";
import { withAccessToken } from "../../../app/protectedAsset";

type TreeNode = ReferralDashboard["mlm"]["tree"]["nodes"][number];

type Props = {
  tree: ReferralDashboard["mlm"]["tree"];
  mode?: "default" | "mobile";
};

type ChartNode = {
  id: number;
  pid?: number;
  name: string;
  profilePhoto?: string | null;
  levelLabel: string;
  walletLabel: string;
  metaLabel: string;
  depth: number;
  isRoot: boolean;
  children: ChartNode[];
};

type TreeLayout = "tree-map" | "top-down" | "left-right";

const toTree = (nodes: TreeNode[], rootUserId: number | null): ChartNode | null => {
  const validNodes = nodes
    .map<ChartNode | null>((node) => {
      const id = Number(node.id);
      const pid = Number(node.pid);
      if (!Number.isFinite(id) || id <= 0) return null;

      return {
        id,
        pid: Number.isFinite(pid) && pid > 0 && pid !== id ? pid : undefined,
        name: node.isRoot ? `${node.name} (You)` : node.name,
        profilePhoto: node.profilePhoto ?? null,
        levelLabel: node.levelCode ? `${node.levelCode} - ${node.status}` : `Member - ${node.status}`,
        walletLabel: `Wallet ${Number(node.walletBalance).toFixed(2)} USDT`,
        metaLabel: `${node.directCount} directs - Depth ${node.depth}`,
        depth: Number(node.depth) || 0,
        isRoot: Boolean(node.isRoot),
        children: [],
      };
    })
    .filter((node): node is ChartNode => Boolean(node));

  if (!validNodes.length) return null;

  const nodeMap = new Map(validNodes.map((node) => [node.id, node]));

  for (const node of validNodes) {
    if (node.pid && nodeMap.has(node.pid)) {
      nodeMap.get(node.pid)?.children.push(node);
    }
  }

  for (const node of validNodes) {
    node.children.sort((a, b) => a.id - b.id);
  }

  if (rootUserId && nodeMap.has(rootUserId)) return nodeMap.get(rootUserId) ?? null;

  return validNodes.find((node) => node.isRoot) ?? validNodes.find((node) => node.pid === undefined) ?? validNodes[0];
};

const getNodeInitial = (name: string) => {
  const cleaned = name.replace(/\s*\(You\)\s*/gi, "").trim();
  return (cleaned.charAt(0) || "U").toUpperCase();
};

function NodeAvatar({ node, sizeClass }: { node: ChartNode; sizeClass: string }) {
  const baseClass = `shrink-0 overflow-hidden rounded-full border ${sizeClass}`;
  const accentClass = node.isRoot
    ? "border-[rgba(255,255,255,0.12)] bg-[rgba(252,213,53,0.12)] text-[var(--accent-yellow)]"
    : "border-[rgba(255,255,255,0.12)] bg-[rgba(255,255,255,0.04)] text-white";
  const [imageFailed, setImageFailed] = useState(false);
  const signedProfilePhoto = useMemo(
    () => (node.profilePhoto ? withAccessToken(node.profilePhoto) : ""),
    [node.profilePhoto]
  );

  useEffect(() => {
    setImageFailed(false);
  }, [signedProfilePhoto]);

  if (signedProfilePhoto && !imageFailed) {
    return (
      <div className={`${baseClass} ${accentClass}`}>
        <img
          src={signedProfilePhoto}
          alt={node.name}
          className="h-full w-full object-cover"
          loading="lazy"
          onError={() => setImageFailed(true)}
        />
      </div>
    );
  }

  return (
    <div className={`${baseClass} flex items-center justify-center text-sm font-black ${accentClass}`}>
      {getNodeInitial(node.name)}
    </div>
  );
}

function TreeCard({ node }: { node: ChartNode }) {
  return (
    <div className="mx-auto w-full max-w-[260px] rounded-[22px] border border-slate-700 bg-slate-950 px-5 py-4 text-left shadow-[0_18px_45px_-30px_rgba(15,23,42,0.95)]">
      <div className="flex items-start gap-3">
        <NodeAvatar node={node} sizeClass="h-10 w-10" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[18px] font-bold text-slate-50">{node.name}</div>
          <div className="mt-2 text-[12px] font-semibold uppercase tracking-[0.12em] text-indigo-300">{node.levelLabel}</div>
        </div>
      </div>
      <div className="mt-2 text-[13px] text-slate-300">{node.walletLabel}</div>
      <div className="mt-2 text-[12px] text-slate-400">{node.metaLabel}</div>
    </div>
  );
}

function MobileTreeCard({ node }: { node: ChartNode }) {
  const accentClasses = node.isRoot
    ? "border-[rgba(255,255,255,0.12)] shadow-[0_14px_32px_rgba(252,213,53,0.08)]"
    : node.depth % 3 === 1
    ? "border-[rgba(14,203,129,0.28)] shadow-[0_10px_24px_rgba(14,203,129,0.07)]"
    : node.depth % 3 === 2
    ? "border-[rgba(246,70,93,0.24)] shadow-[0_10px_24px_rgba(246,70,93,0.06)]"
    : "border-[rgba(255,255,255,0.08)]";

  return (
    <div
      className={`rounded-[18px] border px-3.5 py-3 text-left ${
        node.isRoot
          ? "bg-[linear-gradient(180deg,#1f232b_0%,#171a20_100%)]"
          : "border-[rgba(255,255,255,0.08)] bg-[linear-gradient(180deg,#181c22_0%,#13171c_100%)]"
      } ${accentClasses}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <NodeAvatar node={node} sizeClass="h-9 w-9" />
          <div className="min-w-0">
            <div className={`truncate text-sm font-bold ${node.isRoot ? "text-[var(--accent-yellow)]" : "text-white"}`}>{node.name}</div>
            <div className="mt-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">{node.levelLabel}</div>
          </div>
        </div>
        <div className={`rounded-full px-2 py-0.5 text-[9px] font-bold uppercase ${node.isRoot ? "bg-[rgba(252,213,53,0.14)] text-[var(--accent-yellow)]" : "bg-[rgba(14,203,129,0.12)] text-[var(--success)]"}`}>
          {node.isRoot ? "Root" : "Node"}
        </div>
      </div>
      <div className="mt-3 flex items-end justify-between gap-3">
        <div className="text-[11px] text-[var(--text-secondary)]">{node.walletLabel}</div>
        <div className="text-[10px] text-[var(--text-muted)]">{node.metaLabel}</div>
      </div>
    </div>
  );
}

function MobileTreeBranch({ node }: { node: ChartNode }) {
  return (
    <div className="space-y-3">
      <MobileTreeCard node={node} />
      {node.children.length > 0 ? (
        <div className="ml-4 border-l border-[rgba(255,255,255,0.1)] pl-3">
          <div className="space-y-3">
            {node.children.map((child) => (
              <div key={child.id} className="relative">
                <div className="absolute -left-3 top-6 h-px w-3 bg-[rgba(252,213,53,0.24)]" />
                <MobileTreeBranch node={child} />
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function MobileTopDownTreeBranch({ node, isRoot = false }: { node: ChartNode; isRoot?: boolean }) {
  const hasChildren = node.children.length > 0;

  return (
    <div className={`flex flex-col items-center ${isRoot ? "min-w-full" : ""}`}>
      <div className="w-full max-w-[260px]">
        <MobileTreeCard node={node} />
      </div>

      {hasChildren ? (
        <>
          <div className="h-5 w-px bg-[rgba(252,213,53,0.28)]" />
          <div className="relative flex w-full flex-wrap items-start justify-center gap-x-3 gap-y-6 px-2 pt-5">
            {node.children.length > 1 ? (
              <div className="absolute left-[12%] right-[12%] top-0 h-px bg-[rgba(252,213,53,0.2)]" />
            ) : null}

            {node.children.map((child) => (
              <div key={child.id} className="relative flex flex-col items-center pt-5">
                <div className="absolute top-0 h-5 w-px bg-[rgba(252,213,53,0.28)]" />
                <MobileTopDownTreeBranch node={child} />
              </div>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

function LeftRightTreeBranch({ node }: { node: ChartNode }) {
  return (
    <div className="space-y-3">
      <MobileTreeCard node={node} />
      {node.children.length > 0 ? (
        <div className="ml-5 border-l border-[rgba(255,255,255,0.1)] pl-4">
          <div className="space-y-3">
            {node.children.map((child) => (
              <div key={child.id} className="relative">
                <div className="absolute -left-4 top-6 h-px w-4 bg-[rgba(252,213,53,0.24)]" />
                <LeftRightTreeBranch node={child} />
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function TreeBranch({ node, isRoot = false }: { node: ChartNode; isRoot?: boolean }) {
  const hasChildren = node.children.length > 0;

  return (
    <div className={`flex flex-col items-center ${isRoot ? "min-w-full" : ""}`}>
      <TreeCard node={node} />

      {hasChildren ? (
        <>
          <div className="h-8 w-px bg-cyan-300/35" />
          <div
            className="relative flex flex-wrap items-start justify-center gap-x-6 gap-y-10 px-4 pt-8"
            style={{ width: "max-content", maxWidth: "100%" }}
          >
            {node.children.length > 1 ? (
              <div className="absolute left-8 right-8 top-0 h-px bg-cyan-300/30" />
            ) : null}

            {node.children.map((child) => (
              <div key={child.id} className="relative flex flex-col items-center pt-8">
                <div className="absolute top-0 h-8 w-px bg-cyan-300/35" />
                <TreeBranch node={child} />
              </div>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

type TreeViewportProps = {
  rootNode: ChartNode;
  scale: number;
  offset: { x: number; y: number };
  variant?: "desktop" | "mobile-top-down";
  onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: React.PointerEvent<HTMLDivElement>) => void;
  onPointerUp: (event: React.PointerEvent<HTMLDivElement>) => void;
  onWheel: (event: React.WheelEvent<HTMLDivElement>) => void;
  className?: string;
};

function TreeViewport({
  rootNode,
  scale,
  offset,
  variant = "desktop",
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onWheel,
  className = "",
}: TreeViewportProps) {
  return (
    <div
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onWheel={onWheel}
      className={`relative overflow-hidden touch-none cursor-grab active:cursor-grabbing ${className}`.trim()}
    >
      <div
        className="min-w-max will-change-transform"
        style={{
          transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
          transformOrigin: "top center",
        }}
      >
        {variant === "mobile-top-down" ? <MobileTopDownTreeBranch node={rootNode} isRoot /> : <TreeBranch node={rootNode} isRoot />}
      </div>
    </div>
  );
}

export default function UnilevelTreeCard({ tree, mode = "default" }: Props) {
  const rootNode = useMemo(() => toTree(tree.nodes, tree.rootUserId), [tree.nodes, tree.rootUserId]);
  const dragStateRef = useRef<{ x: number; y: number; startX: number; startY: number } | null>(null);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [portalReady, setPortalReady] = useState(false);
  const [layout, setLayout] = useState<TreeLayout>(mode === "mobile" ? "top-down" : "top-down");

  useEffect(() => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
  }, [tree.rootUserId, tree.totalNodes, tree.maxDepth, tree.nodes]);

  useEffect(() => {
    setLayout(mode === "mobile" ? "top-down" : "top-down");
  }, [mode]);

  useEffect(() => {
    setPortalReady(true);
    return () => setPortalReady(false);
  }, []);

  useEffect(() => {
    if (!isFullscreen) return undefined;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isFullscreen]);

  const clampScale = (value: number) => Math.min(2.2, Math.max(0.55, Number(value.toFixed(2))));

  const zoomBy = (delta: number) => {
    setScale((current) => clampScale(current + delta));
  };

  const resetView = () => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    dragStateRef.current = {
      x: offset.x,
      y: offset.y,
      startX: event.clientX,
      startY: event.clientY,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const dragState = dragStateRef.current;
    if (!dragState) return;

    setOffset({
      x: dragState.x + (event.clientX - dragState.startX),
      y: dragState.y + (event.clientY - dragState.startY),
    });
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragStateRef.current = null;
  };

  const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    zoomBy(event.deltaY < 0 ? 0.1 : -0.1);
  };

  const layoutOptions: Array<{ value: TreeLayout; label: string }> =
    mode === "mobile"
      ? [
          { value: "top-down", label: "Top-Bottom" },
          { value: "tree-map", label: "Tree Map" },
          { value: "left-right", label: "Left-Right" },
        ]
      : [
          { value: "tree-map", label: "Tree Map" },
          { value: "top-down", label: "Top-Bottom" },
          { value: "left-right", label: "Left-Right" },
        ];

  if (mode === "mobile") {
    return (
      <section className="overflow-hidden rounded-[24px] border border-white/8 bg-[linear-gradient(180deg,#11151b_0%,#0d1015_100%)] shadow-[0_18px_42px_rgba(0,0,0,0.28)]">
        <div className="flex items-start justify-between gap-3 border-b border-[rgba(255,255,255,0.05)] px-4 py-4">
          <div className="pr-2">
            <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--text-muted)]">Binance Tree View</div>
            <div className="mt-1 text-lg font-bold text-white">Unilevel Network</div>            
          </div>
          <div className="space-y-2 text-right text-[10px]">
            <div className="rounded-full border border-white/10 bg-[rgba(252,213,53,0.1)] px-2.5 py-1 font-bold text-[var(--accent-yellow)]">
              {tree.totalNodes} members
            </div>
            <div className="rounded-full border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.04)] px-2.5 py-1 font-bold text-[var(--text-secondary)]">
              {tree.maxDepth} levels
            </div>
          </div>
        </div>
        <div className="flex gap-2 overflow-x-auto border-b border-[rgba(255,255,255,0.05)] px-4 py-3">
          {layoutOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setLayout(option.value)}
              className={`shrink-0 rounded-full px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] ${
                layout === option.value
                  ? "bg-[rgba(252,213,53,0.14)] text-[var(--accent-yellow)]"
                  : "border border-[var(--border-soft)] bg-[rgba(255,255,255,0.03)] text-[var(--text-secondary)]"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>

        {rootNode ? (
          <div className="border-t border-[rgba(255,255,255,0.04)]">
            <div className="flex items-center justify-between border-b border-[rgba(255,255,255,0.04)] px-4 py-3">
              <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--accent-yellow)]">Tree Map</div>
              <div className="text-[10px] text-[var(--text-muted)]">{layoutOptions.find((item) => item.value === layout)?.label}</div>
            </div>
            {layout === "tree-map" ? (
              <div className="max-h-[58vh] overflow-y-auto px-3 py-3">
                <MobileTreeBranch node={rootNode} />
              </div>
            ) : layout === "left-right" ? (
              <div className="max-h-[58vh] overflow-y-auto px-3 py-3">
                <LeftRightTreeBranch node={rootNode} />
              </div>
            ) : (
              <div className="border-t border-[rgba(255,255,255,0.04)]">
                <div className="flex items-center justify-between gap-2 border-b border-[rgba(255,255,255,0.04)] px-4 py-3 text-[10px] text-[var(--text-secondary)]">
                  <span>Pinch is not required here. Drag to move and use zoom buttons.</span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => zoomBy(-0.1)}
                      className="rounded-md border border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.05)] px-2 py-1 text-xs text-white"
                    >
                      -
                    </button>
                    <button
                      type="button"
                      onClick={resetView}
                      className="rounded-md border border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.05)] px-2 py-1 text-xs font-semibold text-white"
                    >
                      {Math.round(scale * 100)}%
                    </button>
                    <button
                      type="button"
                      onClick={() => zoomBy(0.1)}
                      className="rounded-md border border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.05)] px-2 py-1 text-xs text-white"
                    >
                      +
                    </button>
                  </div>
                </div>
                <TreeViewport
                  rootNode={rootNode}
                  scale={scale}
                  offset={offset}
                  variant="mobile-top-down"
                  onPointerDown={handlePointerDown}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                  onWheel={handleWheel}
                  className="max-h-[58vh] min-h-[360px] px-2 py-3"
                />
              </div>
            )}
          </div>
        ) : (
          <div className="m-4 rounded-[18px] border border-dashed border-[var(--border-soft)] bg-[rgba(255,255,255,0.03)] px-4 py-8 text-center text-sm text-[var(--text-muted)]">
            No team members found yet. Your tree will appear here after your first downline signup.
          </div>
        )}
      </section>
    );
  }

  const fullscreenPreview =
    portalReady && isFullscreen && rootNode
      ? createPortal(
          <div className="fixed inset-0 z-[80] bg-[linear-gradient(180deg,#0b0e11_0%,#11141a_100%)] text-white">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(252,213,53,0.12),transparent_28%),radial-gradient(circle_at_bottom_right,rgba(252,213,53,0.08),transparent_32%)]" />
            <div className="relative flex h-full flex-col">
              <div className="flex flex-wrap items-start justify-between gap-4 border-b border-white/10 px-5 py-4 sm:px-6">
                <div>
                  <div className="text-[11px] uppercase tracking-[0.22em] text-[var(--accent-yellow)]/80">Unilevel Tree Preview</div>
                  <div className="mt-2 text-2xl font-semibold text-white">Full hierarchy workspace</div>
                  <p className="mt-1 max-w-2xl text-sm text-slate-300/80">
                    Pan across your sponsor structure, inspect branch depth, and zoom into each direct network without leaving the referrals page.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="rounded-full border border-white/10 bg-[rgba(252,213,53,0.1)] px-3 py-1.5 text-xs text-[var(--accent-yellow)]">
                    {tree.totalNodes} members
                  </div>
                  <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-200">
                    {tree.maxDepth} levels deep
                  </div>
                  <button
                    type="button"
                    onClick={() => zoomBy(-0.1)}
                    className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-200 transition hover:bg-white/10"
                  >
                    -
                  </button>
                  <button
                    type="button"
                    onClick={resetView}
                    className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-200 transition hover:bg-white/10"
                  >
                    {Math.round(scale * 100)}%
                  </button>
                  <button
                    type="button"
                    onClick={() => zoomBy(0.1)}
                    className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-200 transition hover:bg-white/10"
                  >
                    +
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsFullscreen(false)}
                    className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-100 transition hover:bg-white/10"
                  >
                    Close
                  </button>
                </div>
              </div>
              <div className="flex items-center justify-between gap-3 border-b border-white/8 px-5 py-3 text-xs text-slate-300/70 sm:px-6">
                <span>Wheel to zoom, drag to move, and use reset to recenter the full tree.</span>
                <span className="hidden sm:inline">Root anchored from your referral account</span>
              </div>
              <TreeViewport
                rootNode={rootNode}
                scale={scale}
                offset={offset}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onWheel={handleWheel}
                className="flex-1 px-4 py-8 sm:px-6"
              />
            </div>
          </div>,
          document.body
        )
      : null;

  return (
    <>
      <section className="rounded-[28px] border border-white/10 bg-slate-950/70 p-6 shadow-[0_30px_90px_-55px_rgba(252,213,53,0.24)]">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="text-sm font-semibold text-white">Unilevel tree preview</div>
            <p className="mt-1 max-w-2xl text-sm text-slate-300/75">
              Explore your sponsor downline with a live hierarchy view built directly from your referral tree.
            </p>
          </div>
          <div className="flex flex-wrap gap-3 text-xs text-slate-300/80">
            <div className="rounded-full border border-white/10 bg-[rgba(252,213,53,0.1)] px-3 py-1.5 text-[var(--accent-yellow)]">{tree.totalNodes} members</div>
            <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5">{tree.maxDepth} levels deep</div>
            <div className="flex flex-wrap gap-2">
              {layoutOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setLayout(option.value)}
                  className={`rounded-full px-3 py-1.5 text-[11px] font-semibold ${
                    layout === option.value
                      ? "bg-[rgba(252,213,53,0.14)] text-[var(--accent-yellow)]"
                      : "border border-white/10 bg-white/5 text-slate-100"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
            {rootNode ? (
              <button
                type="button"
                onClick={() => setIsFullscreen(true)}
                className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-slate-100 transition hover:bg-white/10"
              >
                Open full preview
              </button>
            ) : null}
          </div>
        </div>

        {rootNode ? (
          <div className="mt-5 overflow-x-auto rounded-[24px] border border-white/8 bg-[radial-gradient(circle_at_top,_rgba(56,189,248,0.15),_transparent_32%),linear-gradient(180deg,_rgba(15,23,42,0.96),_rgba(2,6,23,1))]">
            <div className="flex flex-col gap-2 border-b border-white/8 px-4 py-3 text-xs text-slate-300/75 sm:flex-row sm:items-center sm:justify-between">
              <span>{layout === "left-right" ? "Left-right sponsor tree" : layout === "tree-map" ? "Tree map sponsor tree" : "Top-down sponsor tree"}</span>
              <div className="flex flex-wrap items-center gap-2">
                <span className="mr-2 hidden sm:inline">Wheel to zoom, drag to move</span>
                <button
                  type="button"
                  onClick={() => zoomBy(-0.1)}
                  className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-slate-200 transition hover:bg-white/10"
                >
                  -
                </button>
                <button
                  type="button"
                  onClick={resetView}
                  className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-slate-200 transition hover:bg-white/10"
                >
                  {Math.round(scale * 100)}%
                </button>
                <button
                  type="button"
                  onClick={() => zoomBy(0.1)}
                  className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-slate-200 transition hover:bg-white/10"
                >
                  +
                </button>
              </div>
            </div>
            {layout === "left-right" ? (
              <div className="min-h-[420px] px-6 py-8">
                <LeftRightTreeBranch node={rootNode} />
              </div>
            ) : layout === "tree-map" ? (
              <div className="min-h-[420px] px-6 py-8">
                <MobileTreeBranch node={rootNode} />
              </div>
            ) : (
              <TreeViewport
                rootNode={rootNode}
                scale={scale}
                offset={offset}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onWheel={handleWheel}
                className="min-h-[420px] px-6 py-10"
              />
            )}
          </div>
        ) : (
          <div className="mt-5 rounded-2xl border border-dashed border-white/15 bg-white/5 px-4 py-8 text-center text-sm text-slate-300/70">
            No team members found yet. Your tree will appear here after your first downline signup.
          </div>
        )}
      </section>
      {fullscreenPreview}
    </>
  );
}
