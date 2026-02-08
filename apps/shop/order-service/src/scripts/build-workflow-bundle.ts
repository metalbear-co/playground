import { bundleWorkflowCode } from "@temporalio/worker";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function bundle() {
  const workflowsPath = path.join(__dirname, "..", "workflows");
  const { code } = await bundleWorkflowCode({
    workflowsPath,
  });
  const outDir = path.join(__dirname, "..", "..", "dist");
  await mkdir(outDir, { recursive: true });
  const codePath = path.join(outDir, "workflow-bundle.js");
  await writeFile(codePath, code);
  console.log(`Workflow bundle written to ${codePath}`);
}

bundle().catch((err) => {
  console.error(err);
  process.exit(1);
});
