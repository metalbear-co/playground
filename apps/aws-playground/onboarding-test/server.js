// A minimal HTTP service for trying mirrord against an ECS task in the AWS
// playground. It uses only Node's standard library, so there is nothing to
// install.
const http = require("http");

const port = Number(process.env.PORT || 8080);

http
  .createServer((req, res) => {
    if (req.url === "/healthz") {
      res.end("ok\n");
      return;
    }

    // `platform` is fixed when Node is built, so it tells the ECS task (linux)
    // apart from a laptop even when mirrord hands the local process the task's
    // environment, which is where `message` comes from.
    const body = {
      app: "onboarding-test",
      platform: process.platform,
      pid: process.pid,
      message: process.env.MESSAGE || "no MESSAGE set",
    };

    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(body, null, 2) + "\n");
  })
  .listen(port, () => console.log(`onboarding-test listening on ${port}`));
