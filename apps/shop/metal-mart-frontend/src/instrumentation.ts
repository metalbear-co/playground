export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { NodeSDK } = await import("@opentelemetry/sdk-node");
    const { getNodeAutoInstrumentations } = await import(
      "@opentelemetry/auto-instrumentations-node"
    );
    const sdk = new NodeSDK({
      instrumentations: [getNodeAutoInstrumentations()],
    });
    sdk.start();
  }
}
