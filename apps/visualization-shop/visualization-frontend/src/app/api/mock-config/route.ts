import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({
    queueSplittingMock: process.env.QUEUE_SPLITTING_MOCK_DATA === "true",
    dbBranchMock: process.env.DB_BRANCH_MOCK_DATA === "true",
  });
}
