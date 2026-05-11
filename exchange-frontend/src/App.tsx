import { useEffect } from "react";
import { AppRoutes } from "./app/routes";
import { paperEngine } from "./utils/paperEngine";
import { SystemStatusGate } from "./features/systemStatus/SystemStatusGate";

export default function App() {
  useEffect(() => {
    paperEngine.start();
    return () => paperEngine.stop();
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950 text-slate-100 antialiased">
      <SystemStatusGate>
        <AppRoutes />
      </SystemStatusGate>
    </div>
  );
}
