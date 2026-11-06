const { env, validateEnv } = require("./config/env");
const { createApp } = require("./app");
const { prisma, disconnectPrisma } = require("./config/db");

async function bootstrap() {
  validateEnv();
  await prisma.$connect();

  const app = createApp();
  // Mặc định chỉ nghe trên máy local, ra ngoài đi qua proxy /api (nginx hoặc Next.js).
  // Trong Docker đặt HOST=0.0.0.0 (cổng vẫn chỉ publish ra 127.0.0.1 của server).
  const host = env.host;
  const server = app.listen(env.port, host, function onListening() {
    console.log("[server] API sẵn sàng tại http://" + host + ":" + env.port + "/api");
  });

  server.on("error", function onError(err) {
    if (err.code === "EADDRINUSE") {
      console.error("[server] Lỗi: Cổng " + env.port + " đang bị chiếm dụng bởi tiến trình khác (EADDRINUSE).");
      console.error("[server] Để giải phóng cổng, hãy chạy: lsof -ti :" + env.port + " | xargs kill -9");
    } else {
      console.error("[server] Lỗi máy chủ:", err);
    }
    process.exit(1);
  });

  // Đóng kết nối DB sạch trước khi thoát
  async function shutdown(signal) {
    console.log("\n[server] Nhận " + signal + ", đang tắt...");
    server.close(async function onClosed() {
      await disconnectPrisma();
      process.exit(0);
    });

    // Ép buộc thoát nếu treo quá 10 giây
    setTimeout(function forceExit() {
      process.exit(1);
    }, 10000).unref();
  }

  process.on("SIGINT", function onSigint() {
    shutdown("SIGINT");
  });
  process.on("SIGTERM", function onSigterm() {
    shutdown("SIGTERM");
  });
  process.on("unhandledRejection", function onUnhandledRejection(reason) {
    console.error("[server] Promise bị từ chối mà không xử lý:", reason);
  });
}

bootstrap().catch(function onBootFailed(err) {
  console.error("[server] Không khởi động được:", err.message);
  process.exit(1);
});
