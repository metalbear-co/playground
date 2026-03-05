import VisualizationPage from "./VisualizationPage";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const useQueueSplittingMock = params.queue_splitting === "true";
  const useDbBranchMock = params.db_branch === "true";
  const useMultipleSessionMock = params.multiple_session === "true";

  return (
    <VisualizationPage
      useQueueSplittingMock={useQueueSplittingMock}
      useDbBranchMock={useDbBranchMock}
      useMultipleSessionMock={useMultipleSessionMock}
    />
  );
}
