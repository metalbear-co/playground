import { NextResponse } from "next/server";
import { glob } from "glob";
import path from "path";
import { promises as fs } from "fs";

const REPO_ROOT = path.resolve(process.cwd(), "..");
const GLOB_PATTERN = "**/mirrord.json";
const IGNORE_PATTERNS = ["**/node_modules/**", "visualization/**/mirrord.json", "visualization-shop/**/mirrord.json"];

type ConfigSummary = {
  path: string;
  label: string;
};

export async function GET(request: Request) {
  const url = new URL(request.url);
  const configPath = url.searchParams.get("path");

  if (configPath) {
    const safePath = sanitizePath(configPath);
    const fullPath = path.join(REPO_ROOT, safePath);
    if (!fullPath.startsWith(REPO_ROOT)) {
      return NextResponse.json(
        { error: "Invalid config path" },
        { status: 400 },
      );
    }

    try {
      const fileContent = await fs.readFile(fullPath, "utf-8");
      const parsed = JSON.parse(fileContent);
      return NextResponse.json({
        path: safePath,
        config: parsed,
      });
    } catch (error) {
      return NextResponse.json(
        {
          error:
            error instanceof Error ? error.message : "Failed to read config",
        },
        { status: 500 },
      );
    }
  }

  try {
    const matches = await glob(GLOB_PATTERN, {
      cwd: REPO_ROOT,
      ignore: IGNORE_PATTERNS,
      nodir: true,
    });

    const configs: ConfigSummary[] = matches
      .sort()
      .map((relativePath) => ({
        path: relativePath,
        label: deriveLabel(relativePath),
      }));

    return NextResponse.json({ configs });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to list mirrord configs",
      },
      { status: 500 },
    );
  }
}

function deriveLabel(relativePath: string): string {
  const parts = relativePath.split("/");
  if (parts.length >= 2) {
    return parts.slice(0, parts.length - 1).join("/");
  }
  return relativePath;
}

function sanitizePath(value: string): string {
  const normalized = path.normalize(value).replace(/^(\.\.(\/|\\))+/, "");
  return normalized;
}
