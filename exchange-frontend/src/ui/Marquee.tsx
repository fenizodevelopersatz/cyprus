import { type ReactNode, useEffect, useRef } from "react";

type MarqueeProps = {
  children: ReactNode;
  className?: string;
  speed?: number;
  direction?: "left" | "right";
  contentKey?: string | number;
};

export default function Marquee({ children, className = "", speed = 40, direction = "left", contentKey }: MarqueeProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    const content = contentRef.current;
    if (!container || !content) return;

    const animate = () => {
      const trackWidth = content.scrollWidth / 2;
      const containerWidth = container.clientWidth;
      const effectiveDistance = Math.max(trackWidth, containerWidth * 0.9);
      const duration = Math.max(2, effectiveDistance / Math.max(speed, 1));
      content.style.setProperty("--marquee-duration", `${duration}s`);
      content.style.setProperty("--marquee-distance", `-${trackWidth}px`);
    };

    animate();
    const observer = new ResizeObserver(animate);
    observer.observe(container);
    observer.observe(content);
    return () => observer.disconnect();
  }, [speed, direction, contentKey]);

  return (
    <div
      ref={containerRef}
      className={`relative overflow-hidden whitespace-nowrap ${className}`}
    >
      <div
        ref={contentRef}
        className="flex w-max items-center"
        style={{
          animationName: "marquee",
          animationDuration: "var(--marquee-duration)",
          animationTimingFunction: "linear",
          animationIterationCount: "infinite",
          animationDirection: direction === "right" ? "reverse" : "normal",
          willChange: "transform",
        }}
      >
        <div className="flex shrink-0 items-center">{children}</div>
        <div className="flex shrink-0 items-center pl-8" aria-hidden="true">
          {children}
        </div>
      </div>
    </div>
  );
}
