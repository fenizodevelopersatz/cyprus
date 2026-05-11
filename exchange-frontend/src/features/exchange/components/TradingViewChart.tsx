import { useEffect, useMemo, useRef } from "react";

declare global {
  interface Window {
    TradingView?: {
      widget: new (config: any) => void;
    };
  }
}

const TRADING_VIEW_SCRIPT_ID = "tradingview-widget-script";
const TRADING_VIEW_SRC = "https://s3.tradingview.com/tv.js";

type TradingViewChartProps = {
  symbol: string;
  compact?: boolean;
  interval?: string;
};

const TradingViewChart = ({ symbol, compact = false, interval = "60" }: TradingViewChartProps) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const widgetRef = useRef<any>(null);
  const containerId = useMemo(
    () => `tv_chart_${Math.random().toString(36).slice(2, 11)}`,
    []
  );

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.id = containerId;
      containerRef.current.innerHTML = "";
    }

    const tvSymbol = symbol ? `BINANCE:${symbol}` : "BINANCE:BTCUSDT";

    const createWidget = () => {
      if (!window.TradingView || !containerRef.current) return;
      widgetRef.current = new window.TradingView!.widget({
        container_id: containerId,
        autosize: true,
        symbol: tvSymbol,
        interval,
        timezone: "Etc/UTC",
        theme: "dark",
        style: "1",
        locale: "en",
        enable_publishing: false,
        hide_top_toolbar: compact,
        hide_side_toolbar: compact,
        allow_symbol_change: false,
        backgroundColor: "rgba(11,18,32,1)",
        toolbar_bg: "rgba(11,18,32,0.8)",
        studies: compact ? [] : ["Volume@tv-basicstudies"],
        hide_legend: false,
        save_image: false,
        withdateranges: !compact,
        disabled_features: compact
          ? [
              "left_toolbar",
              "header_symbol_search",
              "header_compare",
              "header_undo_redo",
              "header_screenshot",
              "header_settings",
              "header_indicators",
              "timeframes_toolbar",
              "use_localstorage_for_settings",
            ]
          : ["use_localstorage_for_settings"],
        overrides: {
          "paneProperties.background": "#0b0e11",
          "paneProperties.vertGridProperties.color": "rgba(255,255,255,0.05)",
          "paneProperties.horzGridProperties.color": "rgba(255,255,255,0.05)",
          "scalesProperties.textColor": "rgba(255,255,255,0.48)",
          "scalesProperties.fontSize": compact ? 10 : 11,
          "mainSeriesProperties.candleStyle.upColor": "#0ecb81",
          "mainSeriesProperties.candleStyle.downColor": "#f6465d",
          "mainSeriesProperties.candleStyle.borderUpColor": "#0ecb81",
          "mainSeriesProperties.candleStyle.borderDownColor": "#f6465d",
          "mainSeriesProperties.candleStyle.wickUpColor": "#0ecb81",
          "mainSeriesProperties.candleStyle.wickDownColor": "#f6465d",
          "symbolWatermarkProperties.transparency": compact ? 96 : 96,
          "symbolWatermarkProperties.color": "rgba(255,255,255,0.05)",
        },
      });
    };

    if (window.TradingView) {
      createWidget();
      return;
    }

    const existingScript = document.getElementById(TRADING_VIEW_SCRIPT_ID) as HTMLScriptElement | null;
    if (existingScript) {
      const onLoad = () => {
        createWidget();
        existingScript.removeEventListener("load", onLoad);
      };
      existingScript.addEventListener("load", onLoad);
      return () => existingScript.removeEventListener("load", onLoad);
    }

    const scriptEl = document.createElement("script");
    scriptEl.id = TRADING_VIEW_SCRIPT_ID;
    scriptEl.src = TRADING_VIEW_SRC;
    scriptEl.type = "text/javascript";
    scriptEl.async = true;
    scriptEl.onload = createWidget;
    document.body.appendChild(scriptEl);

    return () => {
      scriptEl.onload = null;
    };
    return () => {
      widgetRef.current = null;
    };
  }, [symbol, containerId, compact, interval]);

  return <div ref={containerRef} className="h-full w-full" />;
};

export default TradingViewChart;
