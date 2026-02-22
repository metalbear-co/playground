import VisualizationPage from "./VisualizationPage";

export default function Home() {
  const useQueueSplittingMock = process.env.QUEUE_SPLITTING_MOCK_DATA === "true";
  const useDbBranchMock = process.env.DB_BRANCH_MOCK_DATA === "true";

  return (
    <VisualizationPage
      useQueueSplittingMock={useQueueSplittingMock}
      useDbBranchMock={useDbBranchMock}
    />
  );
}
