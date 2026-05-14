import { Suspense } from "react";

import VisualizationPage from "./VisualizationPage";

export default function Home() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[40vh] items-center justify-center text-sm text-gray-600">
          Loading visualization…
        </div>
      }
    >
      <VisualizationPage />
    </Suspense>
  );
}
