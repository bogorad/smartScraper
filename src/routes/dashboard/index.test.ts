import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  type DashboardSseClient,
  dashboardSseTestHooks,
} from "./index.js";

vi.mock("../../services/stats-storage.js", () => ({
  loadStats: vi.fn(),
  getTopDomains: vi.fn(),
}));

vi.mock("../../core/engine.js", () => ({
  getQueueStats: vi.fn(),
  workerEvents: {
    on: vi.fn(),
  },
}));

vi.mock("../../utils/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    warn: vi.fn(),
  },
}));

function createClient(
  desiredSize: number | null,
  enqueue = vi.fn<(chunk: Uint8Array) => void>(),
): DashboardSseClient {
  const controller = {
    get desiredSize() {
      return desiredSize;
    },
    enqueue,
    close: vi.fn<() => void>(),
  };

  return {
    controller:
      controller as unknown as DashboardSseClient["controller"],
    id: Symbol("client"),
    connectedAt: Date.now(),
    cleanup: vi.fn<() => void>(),
  };
}

describe("dashboard SSE broadcast backpressure", () => {
  afterEach(() => {
    dashboardSseTestHooks.clients.clear();
    vi.clearAllMocks();
  });

  it.each([0, -1])(
    "closes a backpressured client with desiredSize %i and still sends to healthy clients",
    (desiredSize) => {
      const slowClient = createClient(desiredSize);
      const healthyClient = createClient(1);

      dashboardSseTestHooks.clients.add(slowClient);
      dashboardSseTestHooks.clients.add(healthyClient);

      dashboardSseTestHooks.broadcast({
        active: 1,
        max: 2,
        activeUrls: ["https://example.com/article"],
      });

      const slowEnqueue = vi.mocked(
        slowClient.controller.enqueue,
      );
      const slowClose = vi.mocked(slowClient.controller.close);
      const slowCleanup = vi.mocked(slowClient.cleanup);
      const healthyEnqueue = vi.mocked(
        healthyClient.controller.enqueue,
      );
      const healthyClose = vi.mocked(
        healthyClient.controller.close,
      );

      expect(slowEnqueue).not.toHaveBeenCalled();
      expect(slowClose).toHaveBeenCalledTimes(1);
      expect(slowCleanup).toHaveBeenCalledTimes(1);
      expect(
        dashboardSseTestHooks.clients.has(slowClient),
      ).toBe(false);

      expect(healthyEnqueue).toHaveBeenCalledTimes(1);
      expect(healthyClose).not.toHaveBeenCalled();
      expect(
        dashboardSseTestHooks.clients.has(healthyClient),
      ).toBe(true);
    },
  );

  it("closes clients that throw on enqueue and continues broadcasting", () => {
    const failingClient = createClient(
      1,
      vi.fn(() => {
        throw new Error("closed stream");
      }),
    );
    const healthyClient = createClient(1);

    dashboardSseTestHooks.clients.add(failingClient);
    dashboardSseTestHooks.clients.add(healthyClient);

    dashboardSseTestHooks.broadcast({
      active: 1,
      max: 2,
      activeUrls: ["https://example.com/article"],
    });

    const failingClose = vi.mocked(
      failingClient.controller.close,
    );
    const failingCleanup = vi.mocked(failingClient.cleanup);
    const healthyEnqueue = vi.mocked(
      healthyClient.controller.enqueue,
    );

    expect(failingClose).toHaveBeenCalledTimes(1);
    expect(failingCleanup).toHaveBeenCalledTimes(1);
    expect(
      dashboardSseTestHooks.clients.has(failingClient),
    ).toBe(false);

    expect(healthyEnqueue).toHaveBeenCalledTimes(1);
    const chunk = healthyEnqueue.mock.calls[0][0];
    expect(new TextDecoder().decode(chunk)).toContain(
      "event: workers",
    );
    expect(
      dashboardSseTestHooks.clients.has(healthyClient),
    ).toBe(true);
  });
});
