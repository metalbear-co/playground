"use client";

import Link from "next/link";
import { getCldImageUrl } from "next-cloudinary";
import { resolveCloudinaryId } from "@/lib/cloudinary";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

const TEST_IDS = [
  "team_work_makes_the_Dream_work_ljp4we",
  "MetalBear_logo_c2doft",
  "mirrord_logo_srsyxc",
];

export default function DebugCloudinaryPage() {
  const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
  const folderPrefix = process.env.NEXT_PUBLIC_CLOUDINARY_FOLDER_PREFIX;

  if (!cloudName) {
    return (
      <div className="min-h-screen bg-slate-50 p-8">
        <div className="mx-auto max-w-2xl space-y-4">
          <h1 className="text-2xl font-bold text-slate-900">Cloudinary Debug</h1>
          <p className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-800">
            <strong>NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME</strong> is not set. Add it to .env.local and restart the dev server.
          </p>
          <Link href={basePath || "/"} className="text-[#6a4ff5] hover:underline">
            ← Back
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 p-8">
      <div className="mx-auto max-w-2xl space-y-8">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Cloudinary Debug</h1>
          <p className="mt-1 text-sm text-slate-600">
            Use this page to verify URLs. Click a link to test in a new tab — if it 404s, the public_id or folder is wrong.
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-2">
          <h2 className="font-semibold text-slate-900">Config</h2>
          <dl className="text-sm">
            <dt className="text-slate-500">Cloud name</dt>
            <dd className="font-mono text-slate-900">{cloudName}</dd>
            <dt className="mt-2 text-slate-500">Folder prefix</dt>
            <dd className="font-mono text-slate-900">{folderPrefix || "(none)"}</dd>
          </dl>
        </div>

        <div className="space-y-6">
          <h2 className="font-semibold text-slate-900">Test URLs</h2>
          {TEST_IDS.map((rawId) => {
            const resolvedId = resolveCloudinaryId(rawId);
            const url = getCldImageUrl(
              { src: resolvedId, width: 400, height: 400 },
              { cloud: { cloudName } }
            );
            return (
              <div
                key={rawId}
                className="rounded-xl border border-slate-200 bg-white p-5 space-y-2"
              >
                <p className="text-sm font-medium text-slate-700">Raw ID: {rawId}</p>
                <p className="text-sm font-medium text-slate-700">
                  Resolved ID: {resolvedId}
                  {resolvedId !== rawId && (
                    <span className="ml-2 text-slate-500">(prefix applied)</span>
                  )}
                </p>
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block break-all text-sm text-[#6a4ff5] hover:underline"
                >
                  {url}
                </a>
                <p className="text-xs text-slate-500">
                  Click the URL to open in a new tab. If you see the image, the ID is correct. If 404, try copying the Public ID from Cloudinary Media Library (click asset → copy).
                </p>
                <div className="pt-2">
                  <img
                    src={url}
                    alt=""
                    className="h-24 w-24 object-contain border border-slate-200 rounded"
                    onError={(e) => {
                      (e.target as HTMLImageElement).alt = "Failed to load";
                      (e.target as HTMLImageElement).src = "";
                      (e.target as HTMLImageElement).className += " bg-red-50";
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>

        <div className="rounded-xl border border-slate-200 bg-slate-100 p-5 text-sm text-slate-700">
          <h3 className="font-semibold text-slate-900 mb-2">If images 404</h3>
          <ul className="list-disc list-inside space-y-1">
            <li>In Cloudinary Media Library, click an asset and copy the <strong>Public ID</strong> exactly.</li>
            <li>If the Public ID includes the folder (e.g. <code>Metal Mart/team_work_...</code>), set <code>NEXT_PUBLIC_CLOUDINARY_FOLDER_PREFIX</code> to empty and store the full ID in the DB.</li>
            <li>If the Public ID is just the filename, set <code>NEXT_PUBLIC_CLOUDINARY_FOLDER_PREFIX=Metal Mart</code>.</li>
            <li>Check the Cloud name matches your Cloudinary console.</li>
          </ul>
        </div>

        <Link href={basePath || "/"} className="inline-block text-[#6a4ff5] hover:underline">
          ← Back to shop
        </Link>
      </div>
    </div>
  );
}
