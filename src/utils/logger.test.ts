import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { diag } from "@opentelemetry/api";
import fs from "fs";

type LoggerModule = typeof import("./logger.js");

describe("logger OTLP export", () => {
  let emitMock: ReturnType<typeof vi.fn>;
  let forceFlushMock: any;
  let shutdownMock: any;
  let exporterMock: any;
  let processorMock: any;
  let providerMock: any;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetModules();

    emitMock = vi.fn();
    forceFlushMock = vi.fn().mockResolvedValue(undefined);
    shutdownMock = vi.fn().mockResolvedValue(undefined);
    exporterMock = vi
      .fn()
      .mockImplementation((config: unknown) => ({
        config,
      }));
    processorMock = vi.fn();
    providerMock = vi.fn();

    consoleLogSpy = vi
      .spyOn(console, "log")
      .mockImplementation(() => {});
    consoleWarnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => {});
    consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    diag.disable();
    vi.doUnmock("../config.js");
    vi.doUnmock("@opentelemetry/otlp-exporter-base");
    vi.doUnmock(
      "@opentelemetry/otlp-exporter-base/node-http",
    );
    vi.doUnmock("@opentelemetry/otlp-transformer");
    vi.doUnmock("@opentelemetry/sdk-logs");
  });

  it("keeps local logging and skips OTLP setup when disabled", async () => {
    const loggerModule = await loadLogger(false);

    loggerModule.logger.warn(
      "local only",
      { visible: true },
      "TEST",
    );

    expect(consoleWarnSpy).toHaveBeenCalledWith(
      "[WARN] [TEST]",
      "local only",
      { visible: true },
    );
    expect(exporterMock).not.toHaveBeenCalled();
    expect(emitMock).not.toHaveBeenCalled();
  });

  it("filters logs below the configured level", async () => {
    const loggerModule = await loadLogger(false, "WARN");

    loggerModule.logger.info(
      "too noisy",
      undefined,
      "TEST",
    );
    loggerModule.logger.warn(
      "visible warning",
      undefined,
      "TEST",
    );

    expect(consoleLogSpy).not.toHaveBeenCalled();
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      "[WARN] [TEST]",
      "visible warning",
    );
  });

  it("does not open a log file stream when debug file logging is disabled", async () => {
    const createWriteStreamSpy = vi.spyOn(
      fs,
      "createWriteStream",
    );
    const loggerModule = await loadLogger(false, "INFO");

    loggerModule.logger.info("info", undefined, "TEST");
    loggerModule.logger.warn("warn", undefined, "TEST");
    loggerModule.logger.error("error", undefined, "TEST");

    expect(createWriteStreamSpy).not.toHaveBeenCalled();
  });

  it("opens and writes to the log file stream when debug file logging is enabled", async () => {
    const streamMock = {
      end: vi.fn(),
      on: vi.fn(),
      write: vi.fn(),
    };
    streamMock.on.mockReturnValue(streamMock);
    const createWriteStreamSpy = vi
      .spyOn(fs, "createWriteStream")
      .mockReturnValue(
        streamMock as unknown as fs.WriteStream,
      );
    const loggerModule = await loadLogger(false, "DEBUG");

    loggerModule.logger.info("info", undefined, "TEST");

    expect(createWriteStreamSpy).toHaveBeenCalledOnce();
    expect(streamMock.write).toHaveBeenCalledWith(
      expect.stringContaining('"message":"info"'),
    );

    loggerModule.logger.close();
  });

  it("exports structured logs to OTLP with redacted secret fields", async () => {
    const loggerModule = await loadLogger(true);

    loggerModule.logger.info(
      "sent to victoria",
      {
        apiToken: "secret-token",
        clientKey: "client-secret",
        nested: { password: "secret-password" },
        solution: { cookie: "datadome=secret" },
        headers: {
          "set-cookie": "session=secret",
          Authorization: "Bearer secret-token",
        },
        visible: "kept",
      },
      "TEST",
    );
    await loggerModule.logger.flush();

    expect(exporterMock).toHaveBeenCalledWith({
      options: {
        config: {
          url: "http://victorialogs:9428/insert/opentelemetry/v1/logs",
          headers: {
            Authorization: "Bearer secret-token",
            "VL-Stream-Fields":
              "service.name,deployment.environment.name",
          },
          timeoutMillis: 2500,
        },
        requiredHeaders: {
          "Content-Type": "application/x-protobuf",
        },
        signalIdentifier: "LOGS",
        signalResourcePath: "v1/logs",
      },
      serializer: "protobuf-logs-serializer",
    });
    expect(consoleErrorSpy).not.toHaveBeenCalled();
    expect(consoleLogSpy).toHaveBeenCalledWith(
      "[LOGGER]",
      "OTLP logging enabled.",
      {
        timestampUtc: expect.any(String),
        endpoint:
          "http://victorialogs:9428/insert/opentelemetry/v1/logs",
        headers: {
          Authorization: "[REDACTED]",
          "VL-Stream-Fields":
            "service.name,deployment.environment.name",
        },
        timeoutMillis: 2500,
      },
    );
    expect(processorMock).toHaveBeenCalledWith(
      expect.anything(),
      {
        scheduledDelayMillis: 1000,
        exportTimeoutMillis: 2500,
        maxQueueSize: 32,
        maxExportBatchSize: 8,
      },
    );
    expect(emitMock).toHaveBeenCalledWith(
      expect.objectContaining({
        severityText: "INFO",
        body: "sent to victoria",
        attributes: expect.objectContaining({
          module: "TEST",
          data: {
            apiToken: "[REDACTED]",
            clientKey: "[REDACTED]",
            nested: { password: "[REDACTED]" },
            solution: { cookie: "[REDACTED]" },
            headers: {
              "set-cookie": "[REDACTED]",
              Authorization: "[REDACTED]",
            },
            visible: "kept",
          },
        }),
      }),
    );
    expect(consoleLogSpy).toHaveBeenCalledWith(
      "[INFO] [TEST]",
      "sent to victoria",
      {
        apiToken: "[REDACTED]",
        clientKey: "[REDACTED]",
        nested: { password: "[REDACTED]" },
        solution: { cookie: "[REDACTED]" },
        headers: {
          "set-cookie": "[REDACTED]",
          Authorization: "[REDACTED]",
        },
        visible: "kept",
      },
    );
  });

  it("flushes and shuts down the OTLP logger provider", async () => {
    const loggerModule = await loadLogger(true);

    loggerModule.logger.info("queued", undefined, "TEST");
    await loggerModule.logger.flush();
    await loggerModule.logger.shutdown();

    expect(forceFlushMock).toHaveBeenCalledOnce();
    expect(shutdownMock).toHaveBeenCalledOnce();
  });

  it("reports OTLP flush and shutdown failures locally", async () => {
    forceFlushMock.mockRejectedValueOnce(
      new Error("flush failed"),
    );
    shutdownMock.mockRejectedValueOnce(
      new Error("shutdown failed"),
    );
    const loggerModule = await loadLogger(true);

    loggerModule.logger.info("queued", undefined, "TEST");
    await loggerModule.logger.flush();
    await loggerModule.logger.shutdown();

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "[LOGGER]",
      "Failed to flush OTLP logs:",
      {
        timestampUtc: expect.any(String),
        error: "flush failed",
      },
    );
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "[LOGGER]",
      "Failed to shutdown OTLP logger:",
      {
        timestampUtc: expect.any(String),
        error: "shutdown failed",
      },
    );
  });

  it("routes OpenTelemetry export failures to the local logger", async () => {
    const loggerModule = await loadLogger(true);

    loggerModule.logger.info("queued", undefined, "TEST");
    diag.error("export response failure (status: 400)");

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "[LOGGER]",
      "OTLP export error:",
      "export response failure (status: 400)",
    );
  });

  it("reports enabled OTLP with an empty endpoint as an error", async () => {
    const loggerModule = await loadLogger(true, "INFO", {
      endpoint: "",
    });

    loggerModule.logger.info("queued", undefined, "TEST");

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "[LOGGER]",
      "VICTORIALOGS_OTLP_ENABLED is true but VICTORIALOGS_OTLP_ENDPOINT is empty.",
      { timestampUtc: expect.any(String) },
    );
    expect(emitMock).not.toHaveBeenCalled();
  });

  it("reports OTLP exporter initialization failures locally", async () => {
    const loggerModule = await loadLogger(true, "INFO", {
      exporterFailure: new Error("exporter failed"),
    });

    loggerModule.logger.info("queued", undefined, "TEST");

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "[LOGGER]",
      "Failed to initialize OTLP logging:",
      {
        timestampUtc: expect.any(String),
        error: "exporter failed",
      },
    );
    expect(emitMock).not.toHaveBeenCalled();
  });

  it("does not add repeated exit listeners across logger module reloads", async () => {
    const before = process.listenerCount("exit");

    await loadLogger(false);
    vi.resetModules();
    await loadLogger(false);

    expect(
      process.listenerCount("exit"),
    ).toBeLessThanOrEqual(before + 1);
  });

  async function loadLogger(
    otlpEnabled: boolean,
    logLevel = "INFO",
    options: {
      endpoint?: string;
      exporterFailure?: Error;
    } = {},
  ): Promise<LoggerModule> {
    const endpoint =
      options.endpoint === undefined
        ? "http://victorialogs:9428/insert/opentelemetry/v1/logs"
        : options.endpoint;
    vi.doMock("../config.js", () => ({
      getDataDir: () => "./data",
      getLogLevel: () => logLevel,
      getNodeEnv: () => "production",
      getVictoriaLogsOtlpBatchDelayMs: () => 1000,
      getVictoriaLogsOtlpEndpoint: () => endpoint,
      getVictoriaLogsOtlpHeaders: () => ({
        Authorization: "Bearer secret-token",
        "VL-Stream-Fields":
          "service.name,deployment.environment.name",
      }),
      getVictoriaLogsOtlpMaxExportBatchSize: () => 8,
      getVictoriaLogsOtlpMaxQueueSize: () => 32,
      getVictoriaLogsOtlpTimeoutMs: () => 2500,
      isDebugMode: () => false,
      isVictoriaLogsOtlpEnabled: () => otlpEnabled,
    }));
    vi.doMock("@opentelemetry/otlp-exporter-base", () => ({
      OTLPExporterBase: class {
        constructor(delegate: unknown) {
          if (options.exporterFailure) {
            throw options.exporterFailure;
          }
          exporterMock(delegate);
        }
      },
    }));
    vi.doMock(
      "@opentelemetry/otlp-exporter-base/node-http",
      () => ({
        convertLegacyHttpOptions: (
          config: unknown,
          signalIdentifier: string,
          signalResourcePath: string,
          requiredHeaders: Record<string, string>,
        ) => ({
          config,
          requiredHeaders,
          signalIdentifier,
          signalResourcePath,
        }),
        createOtlpHttpExportDelegate: (
          options: unknown,
          serializer: unknown,
        ) => {
          return { options, serializer };
        },
      }),
    );
    vi.doMock("@opentelemetry/otlp-transformer", () => ({
      ProtobufLogsSerializer: "protobuf-logs-serializer",
    }));
    vi.doMock("@opentelemetry/sdk-logs", () => ({
      BatchLogRecordProcessor: class {
        constructor(exporter: unknown, config: unknown) {
          processorMock(exporter, config);
        }
      },
      LoggerProvider: class {
        constructor(config: unknown) {
          providerMock(config);
        }

        getLogger() {
          return { emit: emitMock };
        }

        forceFlush() {
          return forceFlushMock();
        }

        shutdown() {
          return shutdownMock();
        }
      },
    }));

    return import("./logger.js");
  }
});
